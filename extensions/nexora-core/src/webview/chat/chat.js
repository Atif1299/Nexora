/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* global acquireVsCodeApi */
(function () {
	const vscode = acquireVsCodeApi();

	const initial = (window.__NEXORA_INITIAL_STATE__ || { connected: false, auth: { github: false, vercel: false } });

	const messages = document.getElementById('messages');
	let input = document.getElementById('input');
	if (input && input.tagName !== 'TEXTAREA') {
		const ta = document.createElement('textarea');
		ta.id = input.id;
		ta.className = input.className;
		ta.placeholder = input.placeholder || '';
		ta.value = input.value || '';
		ta.rows = 1;
		ta.setAttribute('wrap', 'soft');
		ta.setAttribute('spellcheck', 'true');
		ta.style.resize = 'none';
		ta.style.overflowY = 'hidden';
		ta.style.whiteSpace = 'pre-wrap';
		ta.style.overflowWrap = 'break-word';
		ta.style.wordBreak = 'break-word';
		if (input.parentNode) {
			input.parentNode.replaceChild(ta, input);
		}
		input = ta;
	}
	const sendBtn = document.getElementById('sendBtn');
	const sendBtnText = document.getElementById('sendBtnText');
	const modeSelect = document.getElementById('modeSelect');
	const modelSelect = document.getElementById('modelSelect');
	const statusDot = document.getElementById('statusDot');
	const statusText = document.getElementById('statusText');
	const welcome = document.getElementById('welcome');
	const suggestionStrip = document.getElementById('suggestionStrip');
	const suggestTitle = document.getElementById('suggestTitle');
	const suggestReason = document.getElementById('suggestReason');
	const suggestRun = document.getElementById('suggestRun');
	const suggestLater = document.getElementById('suggestLater');
	const suggestNever = document.getElementById('suggestNever');
	const sessionList = document.getElementById('sessionList');
	const newSessionBtn = document.getElementById('newSessionBtn');
	const railSearchBtn = document.getElementById('railSearchBtn');
	const railSearchRow = document.getElementById('railSearchRow');
	const railSearch = document.getElementById('railSearch');
	const railPlatformCount = document.getElementById('railPlatformCount');
	const firstRunCard = document.getElementById('firstRunCard');
	const firstRunProvider = document.getElementById('firstRunProvider');
	const firstRunKey = document.getElementById('firstRunKey');
	const firstRunSave = document.getElementById('firstRunSave');
	const firstRunSettings = document.getElementById('firstRunSettings');
	const firstRunDismiss = document.getElementById('firstRunDismiss');
	const firstRunMsg = document.getElementById('firstRunMsg');
	const firstRunCloud = document.getElementById('firstRunCloud');

	let lastLoadingMessage = null;
	// Raw text of the reply being streamed. The bubble shows it formatted, so
	// the markdown source cannot be read back from the DOM.
	let streamText = '';
	let streamFrame = 0;
	// Step groups of the run in progress, in thread order, and which group
	// each step belongs to. textSinceGroup is set when reply text has streamed
	// since the newest group was made; the next new step then starts a new group.
	let activityGroups = [];
	let activityStepGroup = {};
	let textSinceGroup = false;
	let lastActivityItems = [];
	let lastActivityCaption = '';
	let activityLogExpanded = {};
	let totalCostUsd = 0;
	let totalTokensIn = 0;
	let totalTokensOut = 0;
	let totalTokensCached = 0;
	let currentPlan = null;
	let planCardElement = null;
	const shownEscalationKeys = {};
	let currentSuggestionId = null;
	let saveTemplateCard = null;
	let currentMode = 'chat';
	let activeSessionId = null;
	let messagesScrollBarTimer = null;
	let replyInFlight = false;
	/** A Chat-mode request whose reply gets a "Run in Agent mode" button. */
	let agentOfferText = '';
	let atCompleteTimer = null;
	let atCompleteItems = [];
	let atCompleteIndex = 0;
	let atCompleteOpen = false;
	let atCompletePrefixStart = -1;
	let atCompleteSuppressEnter = false;
	let submitWithCtrlEnter = !!initial.submitWithCtrlEnter;

	const buttonLabels = {
		'chat': 'Send',
		'ask': 'Ask',
		'plan': 'Generate Plan',
		'execute': 'Execute',
		'agent': 'Run Agent'
	};

	function wireMessagesScrollbarFlash() {
		if (!messages) {
			return;
		}
		function showThumb() {
			messages.classList.add('nx-scrollShow');
			window.clearTimeout(messagesScrollBarTimer);
			messagesScrollBarTimer = window.setTimeout(function () {
				messages.classList.remove('nx-scrollShow');
			}, 900);
		}
		messages.addEventListener('scroll', showThumb, { passive: true });
		messages.addEventListener('wheel', showThumb, { passive: true });
	}

	// Follow new output (text, steps, to-do list) while the reader is at the
	// bottom. Scrolling up stops it; scrolling back to the bottom resumes it.
	let stickToBottom = true;

	function wireStickToBottom() {
		if (!messages) {
			return;
		}
		messages.addEventListener('scroll', function () {
			stickToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
		}, { passive: true });
		new MutationObserver(function () {
			if (stickToBottom) {
				messages.scrollTop = messages.scrollHeight;
			}
		}).observe(messages, { childList: true, subtree: true, characterData: true });
	}

	function ensureOfflineBanner() {
		let banner = document.getElementById('offline-banner');
		if (banner) {
			return banner;
		}
		banner = document.createElement('div');
		banner.id = 'offline-banner';
		banner.setAttribute('role', 'alert');
		banner.hidden = true;
		banner.style.cssText = 'flex:1 1 100%;width:100%;margin:0;padding:8px 10px;border-radius:4px;font-size:12px;align-items:center;gap:8px;flex-wrap:wrap;background:var(--vscode-inputValidation-warningBackground, rgba(255,190,80,0.15));border:1px solid var(--vscode-inputValidation-warningBorder, rgba(255,190,80,0.5));color:var(--vscode-foreground);';

		const text = document.createElement('span');
		text.id = 'offline-banner-text';
		banner.appendChild(text);

		const retry = document.createElement('button');
		retry.type = 'button';
		retry.id = 'offline-banner-retry';
		retry.textContent = 'Retry';
		retry.setAttribute('aria-label', 'Retry backend connection');
		retry.style.cssText = 'border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);';
		retry.addEventListener('click', () => {
			vscode.postMessage({ type: 'checkBackend' });
		});
		banner.appendChild(retry);

		const header = document.querySelector('.nx-header');
		if (header) {
			header.appendChild(banner);
		} else {
			document.body.insertBefore(banner, document.body.firstChild);
		}
		return banner;
	}

	function showOfflineBanner(show, errorText) {
		const banner = ensureOfflineBanner();
		const text = document.getElementById('offline-banner-text');
		if (show) {
			if (text) {
				text.textContent = 'Backend unreachable - chat is not current. '
					+ (errorText ? `(${errorText})` : '');
			}
			banner.hidden = false;
			banner.style.display = 'flex';
		} else {
			if (text) {
				text.textContent = '';
			}
			banner.hidden = true;
			banner.style.display = 'none';
		}
	}

	function updateStatus(connected) {
		statusDot.classList.remove('nx-dotOk', 'nx-dotBad');
		if (connected) {
			statusDot.classList.add('nx-dotOk');
			statusText.textContent = 'Backend connected';
			showOfflineBanner(false);
		} else {
			statusDot.classList.add('nx-dotBad');
			statusText.textContent = 'Backend disconnected';
			showOfflineBanner(true);
		}
	}

	/** Connected platform flags from the host; the rail's Platforms row shows how many are on. */
	function updateAuthStatus(...connected) {
		if (!railPlatformCount) {
			return;
		}
		const count = connected.filter(Boolean).length;
		railPlatformCount.textContent = String(count);
		railPlatformCount.hidden = count === 0;
		railPlatformCount.title = count + (count === 1 ? ' platform connected' : ' platforms connected');
	}

	function updateModeUI() {
		if (!modeSelect) {
			return;
		}
		currentMode = modeSelect.value;
		applySendButtonChrome();
		if (window.NexoraComposer) {
			window.NexoraComposer.render();
		}
	}

	function applySendButtonChrome() {
		if (!sendBtn) {
			return;
		}
		sendBtn.classList.toggle('nx-isStop', replyInFlight);
		if (replyInFlight) {
			if (sendBtnText) {
				sendBtnText.textContent = 'Stop';
			}
			sendBtn.title = 'Stop';
			sendBtn.setAttribute('aria-label', 'Stop generating');
			return;
		}
		const label = buttonLabels[currentMode] || 'Send';
		if (sendBtnText) {
			sendBtnText.textContent = label;
		}
		const chord = submitWithCtrlEnter ? 'Ctrl+Enter' : 'Enter';
		sendBtn.title = `${label} (${chord})`;
		sendBtn.setAttribute('aria-label', `${label}, press ${chord}`);
	}

	function setReplyInFlight(running) {
		const finished = replyInFlight && !running;
		replyInFlight = !!running;
		document.body.classList.toggle('nx-replying', replyInFlight);
		applySendButtonChrome();
		if (finished && agentOfferText) {
			offerAgentRun(agentOfferText);
			agentOfferText = '';
		}
	}

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = String(text);
		return div.innerHTML;
	}

	function parseAtMentionTokens(text) {
		const tokens = [];
		const src = String(text || '');
		const re = /(^|[\s])@(?:"([^"]+)"|'([^']+)'|([^\s@]+))/g;
		let m = re.exec(src);
		while (m) {
			const path = (m[2] || m[3] || m[4] || '').replace(/[.,;:!?)]+$/, '');
			if (path) {
				const atIndex = m.index + m[1].length;
				tokens.push({
					path: path,
					start: atIndex,
					end: atIndex + m[0].length - m[1].length
				});
			}
			m = re.exec(src);
		}
		return tokens;
	}

	function formatAtMentionHighlight(text) {
		const src = String(text || '');
		const tokens = parseAtMentionTokens(src);
		if (!tokens.length) {
			return escapeHtml(src);
		}
		let html = '';
		let cursor = 0;
		tokens.forEach(function (tok) {
			html += escapeHtml(src.slice(cursor, tok.start));
			html += '<span class="nx-atMentionToken">' + escapeHtml(src.slice(tok.start, tok.end)) + '</span>';
			cursor = tok.end;
		});
		html += escapeHtml(src.slice(cursor));
		return html;
	}

	function getAtCompletePrefix(value, caret) {
		const before = String(value || '').slice(0, caret);
		const match = before.match(/(^|[\s])@([^\s@]*)$/);
		if (!match) {
			return null;
		}
		return {
			start: before.length - match[2].length - 1,
			prefix: match[2]
		};
	}

	function ensureAtCompleteMenu() {
		let menu = document.getElementById('nxAtComplete');
		if (menu) {
			return menu;
		}
		menu = document.createElement('div');
		menu.id = 'nxAtComplete';
		menu.className = 'nx-atComplete';
		menu.setAttribute('role', 'listbox');
		menu.hidden = true;
		document.body.appendChild(menu);
		menu.addEventListener('mousedown', function (e) {
			e.preventDefault();
			const item = e.target && e.target.closest ? e.target.closest('[data-at-index]') : null;
			if (!item) {
				return;
			}
			const idx = Number(item.getAttribute('data-at-index'));
			if (!isFinite(idx)) {
				return;
			}
			applyAtCompleteSelection(idx);
		});
		return menu;
	}

	function ensureAtChipRow() {
		let chips = document.getElementById('nxAtChips');
		if (chips) {
			return chips;
		}
		chips = document.createElement('div');
		chips.id = 'nxAtChips';
		chips.className = 'nx-atChips';
		chips.hidden = true;
		const wrap = document.getElementById('nxAtInputWrap');
		if (wrap && wrap.parentNode) {
			wrap.parentNode.insertBefore(chips, wrap);
		} else if (input && input.parentNode) {
			input.parentNode.insertBefore(chips, input);
		}
		return chips;
	}

	function wireAtContextComposer() {
		if (!input || input.dataset.nxAtWired) {
			return;
		}
		input.dataset.nxAtWired = '1';
		const wrap = document.createElement('div');
		wrap.className = 'nx-atInputWrap';
		wrap.id = 'nxAtInputWrap';
		const highlight = document.createElement('div');
		highlight.className = 'nx-atHighlight';
		highlight.id = 'nxAtHighlight';
		highlight.setAttribute('aria-hidden', 'true');
		if (input.parentNode) {
			input.parentNode.insertBefore(wrap, input);
			wrap.appendChild(highlight);
			wrap.appendChild(input);
		}
		ensureAtChipRow();
		ensureAtCompleteMenu();
		input.addEventListener('input', onAtComposerInput);
		input.addEventListener('input', resizeComposer);
		// The box grows to 8 lines, then scrolls; keep the @ highlight layer aligned.
		input.addEventListener('scroll', syncAtMentionHighlight);
		input.addEventListener('click', onAtComposerInput);
		input.addEventListener('keyup', function (e) {
			if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
				onAtComposerInput();
			}
		});
		input.addEventListener('keydown', onAtComposerKeydown);
		input.addEventListener('scroll', syncAtMentionHighlight);
		input.addEventListener('blur', function () {
			window.setTimeout(function () {
				hideAtCompleteMenu();
			}, 120);
		});
		window.addEventListener('resize', function () {
			if (atCompleteOpen) {
				positionAtCompleteMenu();
			}
		});
		syncAtMentionChips();
		syncAtMentionHighlight();
	}

	function quoteAtMentionPath(relPath) {
		const p = String(relPath || '');
		if (/[\s"']/.test(p)) {
			return '@"' + p.replace(/"/g, '') + '"';
		}
		return '@' + p;
	}

	function syncAtMentionHighlight() {
		const hl = document.getElementById('nxAtHighlight');
		const wrap = document.getElementById('nxAtInputWrap');
		if (!hl || !input) {
			return;
		}
		const hasMentions = parseAtMentionTokens(input.value).length > 0;
		if (wrap) {
			wrap.classList.toggle('nx-hasAtMentions', hasMentions);
		}
		hl.innerHTML = hasMentions ? formatAtMentionHighlight(input.value) : '';
		hl.scrollLeft = input.scrollLeft;
		hl.scrollTop = input.scrollTop;
	}

	function syncAtMentionChips() {
		const chips = ensureAtChipRow();
		if (!chips || !input) {
			return;
		}
		const tokens = parseAtMentionTokens(input.value);
		const seen = {};
		const unique = [];
		tokens.forEach(function (tok) {
			if (seen[tok.path]) {
				return;
			}
			seen[tok.path] = true;
			unique.push(tok);
		});
		chips.innerHTML = '';
		if (!unique.length) {
			chips.hidden = true;
			return;
		}
		chips.hidden = false;
		unique.forEach(function (tok) {
			const chip = document.createElement('span');
			chip.className = 'nx-atChip';
			const label = document.createElement('span');
			label.className = 'nx-atChipLabel';
			label.textContent = tok.path;
			label.title = tok.path;
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'nx-atChipRemove';
			remove.setAttribute('aria-label', 'Remove ' + tok.path);
			remove.textContent = 'x';
			remove.addEventListener('click', function (ev) {
				ev.preventDefault();
				removeAtMentionPath(tok.path);
			});
			chip.appendChild(label);
			chip.appendChild(remove);
			chips.appendChild(chip);
		});
	}

	function removeAtMentionPath(relPath) {
		if (!input) {
			return;
		}
		const token = quoteAtMentionPath(relPath);
		const re = new RegExp('(^|\\s)' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)');
		input.value = input.value.replace(re, function (_m, lead) {
			return lead;
		}).replace(/\s{2,}/g, ' ').trimStart();
		syncAtMentionChips();
		syncAtMentionHighlight();
		onAtComposerInput();
		input.focus();
	}

	function hideAtCompleteMenu() {
		const menu = document.getElementById('nxAtComplete');
		if (menu) {
			menu.hidden = true;
			menu.innerHTML = '';
		}
		atCompleteOpen = false;
		atCompleteItems = [];
		atCompleteIndex = 0;
		atCompletePrefixStart = -1;
	}

	function positionAtCompleteMenu() {
		const menu = document.getElementById('nxAtComplete');
		if (!menu || !input) {
			return;
		}
		const wrap = document.getElementById('nxAtInputWrap') || input;
		const rect = wrap.getBoundingClientRect();
		const width = Math.max(rect.width, 200);
		const maxH = Math.min(240, Math.max(72, rect.top - 8));
		menu.style.width = width + 'px';
		menu.style.left = Math.max(4, rect.left) + 'px';
		menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
		menu.style.top = 'auto';
		menu.style.maxHeight = maxH + 'px';
	}

	function scheduleAtCompleteRequest(prefix, start) {
		atCompletePrefixStart = start;
		window.clearTimeout(atCompleteTimer);
		atCompleteTimer = window.setTimeout(function () {
			vscode.postMessage({ type: 'requestAtComplete', prefix: prefix });
		}, 80);
	}

	function onAtComposerInput() {
		syncAtMentionChips();
		syncAtMentionHighlight();
		if (!input) {
			return;
		}
		const caret = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
		const query = getAtCompletePrefix(input.value, caret);
		if (!query) {
			hideAtCompleteMenu();
			return;
		}
		scheduleAtCompleteRequest(query.prefix, query.start);
	}

	function onAtComposerKeydown(e) {
		if (!atCompleteOpen) {
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			atCompleteIndex = Math.min(atCompleteItems.length - 1, atCompleteIndex + 1);
			paintAtCompleteActive();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			atCompleteIndex = Math.max(0, atCompleteIndex - 1);
			paintAtCompleteActive();
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			if (atCompleteItems.length) {
				e.preventDefault();
				if (e.key === 'Enter') {
					atCompleteSuppressEnter = true;
				}
				applyAtCompleteSelection(atCompleteIndex);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			hideAtCompleteMenu();
		}
	}

	function paintAtCompleteActive() {
		const menu = document.getElementById('nxAtComplete');
		if (!menu) {
			return;
		}
		const nodes = menu.querySelectorAll('[data-at-index]');
		nodes.forEach(function (el) {
			const on = Number(el.getAttribute('data-at-index')) === atCompleteIndex;
			el.classList.toggle('nx-atCompleteActive', on);
			if (on) {
				el.scrollIntoView({ block: 'nearest' });
			}
		});
	}

	function renderAtCompleteResults(items) {
		if (!input) {
			return;
		}
		const caret = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
		if (!getAtCompletePrefix(input.value, caret)) {
			hideAtCompleteMenu();
			return;
		}
		const menu = ensureAtCompleteMenu();
		atCompleteItems = Array.isArray(items) ? items : [];
		atCompleteIndex = 0;
		menu.innerHTML = '';
		if (!atCompleteItems.length) {
			const empty = document.createElement('div');
			empty.className = 'nx-atCompleteEmpty';
			empty.textContent = 'No matching files';
			menu.appendChild(empty);
			menu.hidden = false;
			atCompleteOpen = true;
			positionAtCompleteMenu();
			return;
		}
		atCompleteItems.forEach(function (item, idx) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'nx-atCompleteItem' + (idx === 0 ? ' nx-atCompleteActive' : '');
			btn.setAttribute('role', 'option');
			btn.setAttribute('data-at-index', String(idx));
			const icon = document.createElement('span');
			icon.className = 'nx-atCompleteIcon';
			icon.textContent = item.kind === 'folder' ? 'dir' : (item.icon || 'file');
			const body = document.createElement('span');
			body.className = 'nx-atCompleteBody';
			const label = document.createElement('span');
			label.className = 'nx-atCompleteLabel';
			label.textContent = item.label || item.path || '';
			const pathEl = document.createElement('span');
			pathEl.className = 'nx-atCompletePath';
			pathEl.textContent = item.path || '';
			body.appendChild(label);
			if (item.path && item.path !== item.label) {
				body.appendChild(pathEl);
			}
			btn.appendChild(icon);
			btn.appendChild(body);
			menu.appendChild(btn);
		});
		menu.hidden = false;
		atCompleteOpen = true;
		positionAtCompleteMenu();
	}

	function applyAtCompleteSelection(index) {
		if (!input) {
			return;
		}
		const item = atCompleteItems[index];
		if (!item) {
			hideAtCompleteMenu();
			return;
		}
		const caret = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
		const query = getAtCompletePrefix(input.value, caret);
		const start = query ? query.start : atCompletePrefixStart;
		if (start < 0) {
			hideAtCompleteMenu();
			return;
		}
		const token = quoteAtMentionPath(item.path || item.label || '');
		const before = input.value.slice(0, start);
		const after = input.value.slice(caret);
		const spacer = after.charAt(0) === ' ' ? '' : ' ';
		input.value = before + token + spacer + after;
		const nextCaret = (before + token + spacer).length;
		input.setSelectionRange(nextCaret, nextCaret);
		hideAtCompleteMenu();
		syncAtMentionChips();
		syncAtMentionHighlight();
		resizeComposer();
		input.focus();
	}

	function wrapFenceHtml(code, lang) {
		const copyId = 'code-' + Math.random().toString(36).slice(2, 11);
		return (
			'<div class="nx-codeWrap">' +
			'<div class="nx-codeHeader">' +
			'<span class="nx-codeTitle">' + (lang || '') + '</span>' +
			'<button class="nx-copyBtn" data-copy-target="' + copyId + '">Copy</button>' +
			'</div>' +
			'<pre class="nx-codeBlock" id="' + copyId + '">' +
			code +
			'</pre>' +
			'</div>'
		);
	}

	function stashMarkdownBlock(blocks, html) {
		const token = '%%NXCB' + blocks.length + '%%';
		blocks.push(html);
		return token;
	}

	function extractMarkdownFences(html, blocks) {
		let out = '';
		let i = 0;
		while (i < html.length) {
			const start = html.indexOf('```', i);
			if (start < 0) {
				out += html.slice(i);
				break;
			}
			out += html.slice(i, start);
			const afterOpen = start + 3;
			const close = html.indexOf('```', afterOpen);
			const body = close < 0 ? html.slice(afterOpen) : html.slice(afterOpen, close);
			let lang = '';
			let code = body;
			const nl = body.indexOf('\n');
			if (nl >= 0) {
				const first = body.slice(0, nl).trim();
				if (/^[A-Za-z0-9_+-]*$/.test(first)) {
					lang = first;
					code = body.slice(nl + 1);
				}
			}
			out += stashMarkdownBlock(blocks, wrapFenceHtml(code.trim(), lang));
			if (close < 0) {
				break;
			}
			i = close + 3;
		}
		return out;
	}

	const MD_LIST_RE = /^(\s*)([*+-]|\d+\.)\s+(.*)$/;

	/** Inline Markdown for one piece of text: links, code, bold, italic. */
	function mdInline(text) {
		const links = [];
		let s = String(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_match, label, url) {
			const href = safeMarkdownHref(url);
			const inner = applyMarkdownInline(label);
			links.push(href ? '<a href="' + href + '">' + inner + '</a>' : inner);
			return '%%NXLK' + (links.length - 1) + '%%';
		});
		s = applyMarkdownInline(s);
		return s.replace(/%%NXLK(\d+)%%/g, function (_match, n) { return links[Number(n)]; });
	}

	/** "[x] Done thing" / "[ ] Open thing" at the start of a list item. */
	function mdTaskBox(html) {
		return html.replace(/^\[( |x|X)\]\s+/, function (_match, mark) {
			return '<span class="nx-mdTask' + (mark === ' ' ? '' : ' nx-mdTaskDone') + '" aria-hidden="true"></span>';
		});
	}

	function mdIndent(spaces) {
		return spaces.replace(/\t/g, '    ').length;
	}

	/**
	 * A list starting at lines[start], with nesting by indentation. A blank line
	 * between items keeps the same list, so "1. ... (blank) 2. ..." stays one
	 * list; a list cut by other content keeps its numbers through `start`.
	 */
	function mdList(lines, start) {
		function build(index, indent) {
			const first = MD_LIST_RE.exec(lines[index]);
			const ordered = /\d/.test(first[2]);
			const startNum = ordered ? parseInt(first[2], 10) : 1;
			let html = ordered ? '<ol' + (startNum > 1 ? ' start="' + startNum + '"' : '') + '>' : '<ul>';
			let i = index;
			let open = false;
			while (i < lines.length) {
				const line = lines[i];
				if (!line.trim()) {
					let j = i + 1;
					while (j < lines.length && !lines[j].trim()) {
						j++;
					}
					const next = j < lines.length ? MD_LIST_RE.exec(lines[j]) : null;
					if (next && mdIndent(next[1]) >= indent) {
						i = j;
						continue;
					}
					break;
				}
				const m = MD_LIST_RE.exec(line);
				if (!m) {
					// An indented line under an item continues that item.
					if (open && /^\s{2,}\S/.test(line) && !/^\s*%%NXCB\d+%%\s*$/.test(line)) {
						html += '<br/>' + mdInline(line.trim());
						i++;
						continue;
					}
					break;
				}
				const ind = mdIndent(m[1]);
				if (ind < indent) {
					break;
				}
				if (ind > indent && open) {
					const sub = build(i, ind);
					html += sub.html;
					i = sub.next;
					continue;
				}
				if (/\d/.test(m[2]) !== ordered) {
					break;
				}
				if (open) {
					html += '</li>';
				}
				html += '<li>' + mdTaskBox(mdInline(m[3]));
				open = true;
				i++;
			}
			if (open) {
				html += '</li>';
			}
			return { html: html + (ordered ? '</ol>' : '</ul>'), next: i };
		}
		return build(start, mdIndent(MD_LIST_RE.exec(lines[start])[1]));
	}

	function mdIsTableRow(line) {
		const t = line.trim();
		return t.length > 2 && t.charAt(0) === '|' && t.charAt(t.length - 1) === '|';
	}

	function mdTableCells(line) {
		return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return mdInline(c.trim()); });
	}

	function mdTable(lines, start) {
		const head = mdTableCells(lines[start]);
		let i = start + 2;
		let body = '';
		while (i < lines.length && mdIsTableRow(lines[i])) {
			body += '<tr>' + mdTableCells(lines[i]).map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
			i++;
		}
		return {
			html: '<div class="nx-mdTableWrap"><table class="nx-mdTable"><thead><tr>' +
				head.map(function (c) { return '<th>' + c + '</th>'; }).join('') +
				'</tr></thead><tbody>' + body + '</tbody></table></div>',
			next: i
		};
	}

	function applyMarkdownInline(html) {
		html = html.replace(/`([^`]+)`/g, '<code class="nx-inlineCode">$1</code>');
		html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
		html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
		html = html.replace(/\*\*/g, '');
		html = html.replace(/`/g, '');
		return html;
	}

	function safeMarkdownHref(url) {
		const href = String(url || '').trim();
		const protocol = href.replace(/&amp;/g, '&').toLowerCase();
		if (protocol.indexOf('https://') === 0 || protocol.indexOf('http://') === 0 || protocol.indexOf('mailto:') === 0) {
			return href;
		}
		return undefined;
	}

	/**
	 * Markdown to HTML built from blocks (paragraphs, headings, lists, quotes,
	 * tables, code), each with its own margins in chat.css. It used to turn
	 * every newline into <br/>, so a blank line between paragraphs became a
	 * full empty line and code blocks and lists sat between extra breaks.
	 * Text is escaped first; code blocks are cut out before anything else, so
	 * their whitespace is kept.
	 */
	function formatContent(content) {
		const blocks = [];
		let src = escapeHtml(String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
		src = extractMarkdownFences(src, blocks);
		// A code block always stands on its own line, never inside a paragraph.
		src = src.replace(/%%NXCB(\d+)%%/g, '\n%%NXCB$1%%\n');

		const lines = src.split('\n');
		const out = [];
		let para = [];
		const flush = function () {
			if (para.length) {
				out.push('<p>' + para.map(mdInline).join('<br/>') + '</p>');
				para = [];
			}
		};
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			const t = line.trim();
			let m;
			if (!t) {
				flush();
				i++;
			} else if ((m = /^%%NXCB(\d+)%%$/.exec(t))) {
				flush();
				out.push(blocks[Number(m[1])]);
				i++;
			} else if ((m = /^(#{1,6})\s+(.*)$/.exec(t))) {
				flush();
				out.push('<div class="nx-mdH nx-mdH' + Math.min(m[1].length, 3) + '">' + mdInline(m[2]) + '</div>');
				i++;
			} else if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
				flush();
				out.push('<hr class="nx-mdHr"/>');
				i++;
			} else if (/^&gt;/.test(t)) {
				flush();
				const quote = [];
				while (i < lines.length && /^&gt;/.test(lines[i].trim())) {
					quote.push(lines[i].trim().replace(/^&gt;\s?/, ''));
					i++;
				}
				out.push('<blockquote class="nx-mdQuote">' + quote.map(mdInline).join('<br/>') + '</blockquote>');
			} else if (mdIsTableRow(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[i + 1].trim())) {
				flush();
				const table = mdTable(lines, i);
				out.push(table.html);
				i = table.next;
			} else if (MD_LIST_RE.test(line)) {
				flush();
				const list = mdList(lines, i);
				out.push(list.html);
				i = list.next;
			} else {
				para.push(t);
				i++;
			}
		}
		flush();
		return out.join('');
	}

	// Ends the run's live state. When the run finished normally the total cost
	// is left under the answer; when the view is being cleared it is dropped.
	function clearChatActivityCard(showCost) {
		finishTodoCard();
		activityGroups.forEach(function (g) {
			if (g.el.parentNode) {
				g.el.remove();
			}
		});
		activityGroups = [];
		activityStepGroup = {};
		textSinceGroup = false;
		lastActivityItems = [];
		lastActivityCaption = '';
		activityLogExpanded = {};
		if (showCost) {
			showRunCost();
		}
		totalCostUsd = 0;
		totalTokensIn = 0;
		totalTokensOut = 0;
		totalTokensCached = 0;
	}

	function activityStepCount(items) {
		const list = Array.isArray(items) ? items : [];
		const tools = list.filter(function (it) { return it.id !== 'agent'; });
		return tools.length;
	}

	function activityFoldSummary(items) {
		const n = activityStepCount(items);
		if (n === 1) {
			return 'Worked · 1 step';
		}
		if (n > 1) {
			return 'Worked · ' + n + ' steps';
		}
		return 'Activity';
	}

	function lastUserMessageEl() {
		if (!messages) {
			return null;
		}
		const nodes = messages.querySelectorAll('.nx-msg.nx-user');
		return nodes.length ? nodes[nodes.length - 1] : null;
	}

	function attachActivityFold(userEl, items) {
		if (!userEl || !userEl.parentNode) {
			return;
		}
		const list = Array.isArray(items) ? items : [];
		if (!list.length) {
			return;
		}
		const next = userEl.nextElementSibling;
		if (next && next.classList && next.classList.contains('nexora-activity-fold')) {
			next.remove();
		}
		const fold = document.createElement('details');
		fold.className = 'nexora-activity-fold';
		const summary = document.createElement('summary');
		summary.textContent = activityFoldSummary(list);
		fold.appendChild(summary);
		const body = document.createElement('div');
		body.className = 'nx-activityCardBody';
		fillActivityBody(body, list, false);
		fold.appendChild(body);
		userEl.parentNode.insertBefore(fold, userEl.nextSibling);
	}

	// When a run ends each live group collapses where it is, into a
	// "Worked - N steps" line, so the thread keeps its order.
	function foldGroupsInPlace(list) {
		const byId = {};
		list.forEach(function (it) { byId[it.id] = it; });
		const groups = activityGroups;
		activityGroups = [];
		groups.forEach(function (g) {
			const steps = g.ids.map(function (id) { return byId[id]; }).filter(Boolean);
			if (!steps.length) {
				g.el.remove();
				return;
			}
			const fold = document.createElement('details');
			fold.className = 'nexora-activity-fold';
			const summary = document.createElement('summary');
			summary.textContent = activityFoldSummary(steps);
			fold.appendChild(summary);
			const body = document.createElement('div');
			body.className = 'nx-activityCardBody';
			fillActivityBody(body, steps, false);
			fold.appendChild(body);
			g.el.replaceWith(fold);
		});
	}

	function foldLiveActivity(items) {
		const list = (Array.isArray(items) && items.length) ? items : lastActivityItems;
		if (activityGroups.length) {
			foldGroupsInPlace(list || []);
		} else {
			const userEl = lastUserMessageEl();
			if (userEl && list && list.length) {
				attachActivityFold(userEl, list);
			}
		}
		clearChatActivityCard(true);
	}

	function resizeComposer() {
		if (!input) {
			return;
		}
		input.style.height = 'auto';
		const cs = window.getComputedStyle(input);
		let line = parseFloat(cs.lineHeight);
		if (!line || !isFinite(line)) {
			const fs = parseFloat(cs.fontSize);
			line = (fs && isFinite(fs) ? fs : 14) * 1.4;
		}
		const min = Math.ceil(line);
		const max = Math.ceil(line * 8);
		const next = Math.max(min, Math.min(input.scrollHeight, max));
		input.style.height = next + 'px';
		input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
	}

	function formatElapsedMs(ms) {
		const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return m + ':' + String(s).padStart(2, '0');
	}

	function terminalStatusLabel(it) {
		const status = it.status || (it.done ? 'succeeded' : 'running');
		if (status === 'confirming') {
			return 'Allow';
		}
		if (status === 'running') {
			return formatElapsedMs(it.elapsedMs);
		}
		if (status === 'succeeded') {
			return formatElapsedMs(it.elapsedMs) + ' · exit 0';
		}
		if (status === 'failed') {
			const code = it.exitCode === undefined || it.exitCode === null ? '?' : String(it.exitCode);
			return formatElapsedMs(it.elapsedMs) + ' · exit ' + code;
		}
		if (status === 'timeout') {
			return formatElapsedMs(it.elapsedMs) + ' · timed out';
		}
		if (status === 'cancelled') {
			return 'cancelled';
		}
		return formatElapsedMs(it.elapsedMs);
	}

	function renderTerminalActivityRow(it, live) {
		const isLive = live !== false;
		const status = it.status || (it.done ? 'succeeded' : 'running');
		const row = document.createElement('div');
		row.className = 'nx-activityRow nx-activityTermRow';
		row.setAttribute('data-activity-id', it.id);
		if (status === 'succeeded' || (it.done && status !== 'failed' && status !== 'timeout' && status !== 'cancelled')) {
			row.classList.add('nx-activityRowDone');
		}
		if (status === 'failed' || status === 'timeout') {
			row.classList.add('nx-activityRowFailed');
		}
		if (status === 'cancelled') {
			row.classList.add('nx-activityRowCancelled');
		}
		if (isLive && (status === 'running' || status === 'confirming')) {
			row.classList.add('nx-activityRowLive');
		}
		if (status === 'confirming') {
			row.classList.add('nx-activityRowConfirm');
		}

		let markState = 'done';
		if (isLive && (status === 'running' || status === 'confirming')) {
			markState = 'running';
		} else if (status === 'failed' || status === 'timeout') {
			markState = 'failed';
		} else if (status === 'cancelled') {
			markState = 'cancelled';
		}
		const mark = makeActivityMark(markState);

		const glyph = document.createElement('span');
		glyph.className = 'nx-activityTermGlyph';
		glyph.textContent = '$';

		const body = document.createElement('div');
		body.className = 'nx-activityTermBody';

		const head = document.createElement('div');
		head.className = 'nx-activityTermHead';
		const cmd = document.createElement('span');
		cmd.className = 'nx-activityTermCmd';
		// The "$" is drawn by the glyph beside it; the label already carries one.
		cmd.textContent = String(it.label || it.command || '').replace(/^\$\s*/, '');
		cmd.title = cmd.textContent;
		const meta = document.createElement('span');
		meta.className = 'nx-activityTermMeta';
		meta.textContent = terminalStatusLabel(it);
		head.appendChild(cmd);
		head.appendChild(meta);
		body.appendChild(head);

		const lines = String(it.preview || '').split('\n').filter(function (line, idx, arr) {
			return line.length > 0 || idx < arr.length - 1;
		});
		const expanded = isLive ? !!activityLogExpanded[it.id] : lines.length > 6;
		const visible = expanded ? lines.slice(-12) : lines.slice(-6);
		const log = document.createElement('pre');
		log.className = 'nx-activityTermLog' + (expanded ? ' nx-activityTermLogExpanded' : '');
		if (visible.length) {
			log.textContent = visible.join('\n');
		} else if (status === 'confirming') {
			log.textContent = 'Waiting for Allow...';
		} else if (status === 'running') {
			log.textContent = 'waiting for output...';
		} else {
			log.textContent = '';
		}
		if (log.textContent) {
			body.appendChild(log);
		}

		if (isLive && lines.length > 6) {
			const toggle = document.createElement('button');
			toggle.type = 'button';
			toggle.className = 'nx-activityTermToggle';
			toggle.textContent = expanded ? 'Show less' : 'Show more';
			toggle.addEventListener('click', function (ev) {
				ev.preventDefault();
				ev.stopPropagation();
				activityLogExpanded[it.id] = !expanded;
				renderChatActivity(lastActivityItems, lastActivityCaption);
			});
			body.appendChild(toggle);
		}

		row.appendChild(mark);
		row.appendChild(glyph);
		row.appendChild(body);
		return row;
	}

	// Status icon at the start of an activity row: a spinner while running,
	// otherwise a small check, cross or dash.
	const ACTIVITY_MARK_PATHS = {
		done: 'M3.5 8.5l3 3 6-6.5',
		failed: 'M4 4l8 8M12 4l-8 8',
		cancelled: 'M4 8h8'
	};

	function makeActivityMark(state) {
		const mark = document.createElement('span');
		mark.className = 'nx-activityMark';
		if (state === 'running') {
			const spinner = document.createElement('span');
			spinner.className = 'nx-activitySpinner';
			spinner.setAttribute('aria-hidden', 'true');
			mark.appendChild(spinner);
		} else {
			mark.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">'
				+ '<path d="' + (ACTIVITY_MARK_PATHS[state] || ACTIVITY_MARK_PATHS.done) + '" fill="none" stroke="currentColor" '
				+ 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
		}
		return mark;
	}

	// Past and present wording for each tool label the extension sends
	// ("read_file: src/app.ts"). Unknown "name: detail" labels, such as a
	// connected platform's tools, show the name as the verb.
	const ACTIVITY_VERBS = {
		read_file: ['Reading', 'Read'],
		write_file: ['Writing', 'Wrote'],
		apply_patch: ['Editing', 'Edited'],
		insert_lines: ['Editing', 'Edited'],
		list_files: ['Listing', 'Listed'],
		grep: ['Searching', 'Searched'],
		search_codebase: ['Searching', 'Searched'],
		search_chat_history: ['Searching history', 'Searched history'],
		open_browser: ['Opening', 'Opened'],
		browser_snapshot: ['Taking snapshot', 'Took snapshot'],
		browser_click: ['Clicking', 'Clicked'],
		browser_type: ['Typing', 'Typed'],
		browser_select: ['Selecting', 'Selected'],
		browser_press: ['Pressing', 'Pressed'],
		remember: ['Remembering', 'Remembered']
	};

	function splitActivityLabel(label, done) {
		const text = String(label || '');
		const at = text.indexOf(': ');
		const name = at > 0 ? text.slice(0, at) : text;
		const target = at > 0 ? text.slice(at + 2) : '';
		const verbs = ACTIVITY_VERBS[name];
		if (verbs) {
			return { verb: verbs[done ? 1 : 0], target: target };
		}
		return at > 0 ? { verb: name, target: target } : { verb: text, target: '' };
	}

	function fillActivityBody(bodyEl, list, live) {
		const isLive = live !== false;
		bodyEl.innerHTML = '';
		list.forEach(function (it) {
			if (it.kind === 'terminal') {
				bodyEl.appendChild(renderTerminalActivityRow(it, isLive));
				return;
			}
			const finished = !!it.done || !isLive;
			const row = document.createElement('div');
			row.className = 'nx-activityRow' + (it.done ? ' nx-activityRowDone' : '') + (finished ? '' : ' nx-activityRowRun');
			row.setAttribute('data-activity-id', it.id);
			const parts = splitActivityLabel(it.label, finished);
			const verb = document.createElement('span');
			verb.className = 'nx-activityVerb';
			verb.textContent = parts.verb;
			row.appendChild(makeActivityMark(finished ? 'done' : 'running'));
			row.appendChild(verb);
			if (parts.target) {
				const target = document.createElement('span');
				target.className = 'nx-activityTarget';
				target.textContent = parts.target;
				target.title = parts.target;
				row.appendChild(target);
			}
			bodyEl.appendChild(row);
		});
	}

	// The steps of a run are shown in groups, in the order things happened:
	// text the model wrote, then the steps it took, then the text that
	// followed. A group is one card of steps; a new one starts when text has
	// streamed since the last one.
	function createActivityGroup() {
		const card = document.createElement('div');
		card.className = 'nx-activityCard';
		const headerBtn = document.createElement('button');
		headerBtn.type = 'button';
		headerBtn.className = 'nx-activityCardHeader';
		headerBtn.setAttribute('aria-expanded', 'true');
		const chev = document.createElement('span');
		chev.className = 'nx-activityChevron';
		chev.setAttribute('aria-hidden', 'true');
		chev.textContent = 'v';
		const title = document.createElement('span');
		title.className = 'nx-activityCardTitle';
		title.textContent = 'Activity';
		const turnCounter = document.createElement('span');
		turnCounter.className = 'nx-activityTurnCounter';
		headerBtn.appendChild(chev);
		headerBtn.appendChild(title);
		headerBtn.appendChild(turnCounter);
		const body = document.createElement('div');
		body.className = 'nx-activityCardBody';
		card.appendChild(headerBtn);
		card.appendChild(body);
		headerBtn.addEventListener('click', function () {
			const collapsed = card.classList.toggle('nx-activityCardCollapsed');
			headerBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
			chev.textContent = collapsed ? '>' : 'v';
		});
		return { el: card, body: body, counter: turnCounter, ids: [] };
	}

	/** Close the bubble that is streaming so the next text starts a new one below the steps. */
	function sealStreamingBubble() {
		if (!lastLoadingMessage) {
			return;
		}
		const body = lastLoadingMessage.querySelector('.nx-msgBody');
		if (!body || body.getAttribute('data-nx-streaming') !== '1') {
			return;
		}
		if (streamFrame) {
			cancelAnimationFrame(streamFrame);
			streamFrame = 0;
		}
		lastLoadingMessage.classList.remove('nx-msgLoading', 'nx-msgStreaming');
		body.removeAttribute('data-nx-streaming');
		body.innerHTML = formatContent(streamText);
		streamText = '';
		lastLoadingMessage = null;
	}

	/** The agent's to-do list for the current request (todo_write); one card, updated in place. */
	let todoCard = null;

	/** Subagents started with delegate in the current request: one folding card each, by id. */
	let subagentCards = {};

	function renderSubagent(data) {
		if (!messages || !data || !data.id) {
			return;
		}
		let card = subagentCards[data.id];
		if (!card || !card.isConnected) {
			card = document.createElement('details');
			card.className = 'nx-subagentCard';
			card.open = true;
			card.innerHTML = '<summary class="nx-subagentHead"></summary><div class="nx-subagentTask"></div><div class="nx-subagentTools" role="list"></div><div class="nx-subagentAnswer"></div>';
			if (lastLoadingMessage && lastLoadingMessage.parentNode === messages) {
				messages.insertBefore(card, lastLoadingMessage);
			} else {
				messages.appendChild(card);
			}
			subagentCards[data.id] = card;
		}
		const state = String(data.state || 'running');
		const wasRunning = card.getAttribute('data-state') === 'running';
		card.setAttribute('data-state', state);
		card.querySelector('.nx-subagentHead').textContent = String(data.title || ('Subagent ' + data.agent));
		const task = String(data.task || '');
		const taskEl = card.querySelector('.nx-subagentTask');
		taskEl.textContent = task.length > 160 ? task.slice(0, 157) + '...' : task;
		taskEl.title = task;
		const items = Array.isArray(data.activity) ? data.activity : [];
		card.querySelector('.nx-subagentTools').innerHTML = items.map(function (a) {
			const failed = a.status === 'failed';
			const mark = failed ? 'x' : (a.done ? 'ok' : '...');
			return '<div class="nx-subagentTool' + (failed ? ' nx-subagentToolFailed' : '') + '" role="listitem"><span class="nx-subagentMark">' + mark + '</span>' + escapeHtml(String(a.label || '')) + '</div>';
		}).join('');
		const answerEl = card.querySelector('.nx-subagentAnswer');
		if (data.error) {
			answerEl.textContent = String(data.error);
			answerEl.className = 'nx-subagentAnswer nx-subagentError';
		} else if (data.answer) {
			answerEl.innerHTML = formatContent(String(data.answer));
			answerEl.className = 'nx-subagentAnswer';
		} else {
			answerEl.textContent = '';
		}
		// Open while it works; fold once when it ends, so the main answer stays in view.
		if (wasRunning && state !== 'running') {
			card.open = false;
		}
	}

	function renderTodos(todos) {
		if (!messages || !Array.isArray(todos) || todos.length === 0) {
			return;
		}
		if (!todoCard || !todoCard.isConnected) {
			todoCard = document.createElement('div');
			todoCard.className = 'nx-todoCard';
			todoCard.setAttribute('role', 'list');
			todoCard.setAttribute('aria-label', 'Agent to-do list');
			if (lastLoadingMessage && lastLoadingMessage.parentNode === messages) {
				messages.insertBefore(todoCard, lastLoadingMessage);
			} else {
				messages.appendChild(todoCard);
			}
		}
		todoItems = todos;
		paintTodoCard(false);
	}

	let todoItems = [];

	function paintTodoCard(ended) {
		if (!todoCard) {
			return;
		}
		const done = todoItems.filter(function (t) { return t.status === 'completed'; }).length;
		const open = todoItems.length - done;
		// After the run, an item still "in progress" is not running any more:
		// show it as not done, and say plainly that the agent left it open.
		const note = ended && open > 0
			? '<div class="nx-todoNote">The agent finished without marking ' + (open === 1 ? 'this item' : 'these ' + open + ' items') + ' done.</div>'
			: '';
		todoCard.classList.toggle('nx-todoEnded', !!ended);
		todoCard.innerHTML = '<div class="nx-todoHead">To-do <span class="nx-todoCount">' + done + ' of ' + todoItems.length + ' done</span></div>' +
			todoItems.map(function (t) {
				let status = t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending';
				if (ended && status === 'in_progress') {
					status = 'pending';
				}
				const label = status === 'completed' ? 'Done' : status === 'in_progress' ? 'In progress' : 'Not done';
				return '<div class="nx-todoItem nx-todo-' + status + '" role="listitem" aria-label="' + label + ': ' + escapeHtml(t.content).replace(/"/g, '&quot;') + '">' +
					'<span class="nx-todoMark" aria-hidden="true"></span>' +
					'<span class="nx-todoText" aria-hidden="true">' + escapeHtml(t.content) + '</span></div>';
			}).join('') + note;
	}

	/** The run is over: freeze the card (called when the activity card is cleared). */
	function finishTodoCard() {
		if (todoCard && todoCard.isConnected && todoItems.length) {
			paintTodoCard(true);
		}
	}

	function renderChatActivity(items, caption) {
		if (!messages) {
			return;
		}
		const list = Array.isArray(items) ? items : [];
		lastActivityItems = list;
		if (caption) {
			// The activity card already shows the caption; repeating it in the
			// placeholder reply below drew the same line twice.
			lastActivityCaption = caption;
		}
		const agentIt = list.find(function (it) { return it.id === 'agent'; });
		const steps = list.filter(function (it) { return it.id !== 'agent'; });
		const byId = {};
		steps.forEach(function (it) { byId[it.id] = it; });

		let last = activityGroups[activityGroups.length - 1];
		const fresh = steps.filter(function (it) { return !activityStepGroup[it.id]; });
		if (!last || (fresh.length && textSinceGroup)) {
			sealStreamingBubble();
			last = createActivityGroup();
			activityGroups.push(last);
			textSinceGroup = false;
			if (lastLoadingMessage && lastLoadingMessage.parentNode === messages) {
				messages.insertBefore(last.el, lastLoadingMessage);
			} else {
				messages.appendChild(last.el);
			}
		}
		fresh.forEach(function (it) {
			activityStepGroup[it.id] = last;
			last.ids.push(it.id);
		});

		activityGroups = activityGroups.filter(function (g) {
			const isLast = g === last;
			const rows = g.ids.map(function (id) { return byId[id]; }).filter(Boolean);
			// A group left empty because its steps moved on is dropped.
			if (!rows.length && !isLast) {
				g.el.remove();
				return false;
			}
			// What the agent is doing right now is the last line of the newest group.
			const showAgent = isLast && agentIt && !agentIt.done;
			const shown = showAgent ? rows.concat([agentIt]) : rows;
			g.el.hidden = shown.length === 0;
			g.counter.textContent = (isLast && agentIt && agentIt.turn !== null && agentIt.turn !== undefined && agentIt.totalTurns)
				? 'Turn ' + agentIt.turn + '/' + agentIt.totalTurns
				: '';
			fillActivityBody(g.body, shown, true);
			return true;
		});
	}

	function formatTokens(count) {
		return count >= 1000 ? (count / 1000).toFixed(1) + 'K' : String(count);
	}

	// Cost is added up while the run goes and shown once, under the answer,
	// when the run ends (see showRunCost).
	function updateCostTicker(costUsd, tokensIn, tokensOut, tokensCached) {
		totalCostUsd += costUsd || 0;
		totalTokensIn += tokensIn || 0;
		totalTokensOut += tokensOut || 0;
		totalTokensCached += tokensCached || 0;
	}

	function showRunCost() {
		if (!messages || totalTokensIn + totalTokensOut <= 0) {
			return;
		}
		// Cached tokens are part of the input count, billed at the cache rate.
		const cached = totalTokensCached > 0 ? ' (' + formatTokens(totalTokensCached) + ' cached)' : '';
		const cost = totalCostUsd > 0 ? '$' + totalCostUsd.toFixed(4) + ' - ' : '';
		const el = document.createElement('div');
		el.className = 'nx-costTicker';
		el.textContent = cost + formatTokens(totalTokensIn + totalTokensOut) + ' tokens' + cached;
		messages.appendChild(el);
	}

	function addMessage(role, content, isLoading, stopped, activity) {
		if (welcome) {
			welcome.style.display = 'none';
		}

		if (isLoading && lastLoadingMessage) {
			lastLoadingMessage.remove();
		}

		const div = document.createElement('div');
		div.className = 'nx-msg ' + (role === 'user' ? 'nx-user' : 'nx-assistant') + (isLoading ? ' nx-msgLoading' : '') + (stopped || (!isLoading && content === 'Stopped.') ? ' nx-msgStopped' : '');

		const body = document.createElement('div');
		body.className = 'nx-msgBody';

		if (isLoading) {
			body.textContent = content;
		} else if (role === 'user') {
			body.innerHTML = formatAtMentionHighlight(content);
		} else {
			body.innerHTML = formatContent(content);
		}

		div.appendChild(body);
		if (role === 'user' && !isLoading) {
			attachUserActions(div, content);
		}

		messages.appendChild(div);
		if (role === 'user' && !isLoading && activity && activity.length) {
			attachActivityFold(div, activity);
		}
		messages.scrollTop = messages.scrollHeight;

		if (isLoading) {
			lastLoadingMessage = div;
		} else if (lastLoadingMessage) {
			lastLoadingMessage.remove();
			lastLoadingMessage = null;
			setReplyInFlight(false);
		} else if (stopped) {
			setReplyInFlight(false);
		}
	}

	// ---------- Copy, edit and retry on your own messages ----------

	const ICONS = {
		copy: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 4V2.5A1.5 1.5 0 0 1 5.5 1h7A1.5 1.5 0 0 1 14 2.5v7a1.5 1.5 0 0 1-1.5 1.5H11v1.5A1.5 1.5 0 0 1 9.5 14h-7A1.5 1.5 0 0 1 1 12.5v-7A1.5 1.5 0 0 1 2.5 4H4zm1 0h4.5A1.5 1.5 0 0 1 11 5.5V10h1.5a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-7a.5.5 0 0 0-.5.5V4zM2.5 5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-7z"/></svg>',
		check: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.3 11.3 2.7 7.7l.7-.7 2.9 2.9 6.3-6.3.7.7z"/></svg>',
		edit: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M13.2 1.8a1.9 1.9 0 0 0-2.7 0L2.9 9.4 2 14l4.6-.9 7.6-7.6a1.9 1.9 0 0 0 0-2.7l-1-1zM3.3 12.7l.4-2.2 1.8 1.8-2.2.4zm3-.9L4.2 9.7 9.5 4.4l2.1 2.1-5.3 5.3zm7.2-7.2-1.2 1.2-2.1-2.1 1.2-1.2a.9.9 0 0 1 1.3 0l.8.8a.9.9 0 0 1 0 1.3z"/></svg>',
		retry: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3.5 8a4.5 4.5 0 0 1 8-2.8V3h1v4h-4V6h2.3A3.5 3.5 0 1 0 11.5 8h1A4.5 4.5 0 1 1 3.5 8z"/></svg>'
	};

	function userOrdinal(div) {
		return Array.prototype.indexOf.call(messages.querySelectorAll('.nx-msg.nx-user'), div);
	}

	/** Go back to just before this message and send `text` instead (the extension confirms file restores). */
	function rewindTo(div, text) {
		const trimmed = (text || '').trim();
		if (!trimmed || replyInFlight) {
			return;
		}
		vscode.postMessage({ type: 'rewindTo', ordinal: userOrdinal(div), text: trimmed });
	}

	function actionButton(icon, label, onClick) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'nx-userAction';
		button.title = label;
		button.setAttribute('aria-label', label);
		button.innerHTML = ICONS[icon];
		button.addEventListener('click', function (event) {
			event.stopPropagation();
			onClick(button);
		});
		return button;
	}

	function attachUserActions(div, content) {
		const bar = document.createElement('div');
		bar.className = 'nx-userActions';
		bar.appendChild(actionButton('copy', 'Copy', function (button) {
			void navigator.clipboard.writeText(content).then(function () {
				button.innerHTML = ICONS.check;
				setTimeout(function () { button.innerHTML = ICONS.copy; }, 1200);
			});
		}));
		bar.appendChild(actionButton('edit', 'Edit and resend', function () { startEdit(div, content); }));
		bar.appendChild(actionButton('retry', 'Retry from here', function () { rewindTo(div, content); }));
		div.appendChild(bar);
	}

	/** Edit in place: the bubble becomes a text box with the same look; Enter resends, Esc cancels. */
	function startEdit(div, content) {
		if (replyInFlight || div.classList.contains('nx-editing')) {
			return;
		}
		const body = div.querySelector('.nx-msgBody');
		const saved = body.innerHTML;
		const editor = document.createElement('textarea');
		editor.className = 'nx-editInput';
		editor.value = content;
		editor.rows = 1;
		const fit = function () {
			editor.style.height = 'auto';
			editor.style.height = Math.min(editor.scrollHeight, 320) + 'px';
		};
		const hint = document.createElement('div');
		hint.className = 'nx-editBar';
		hint.innerHTML = '<span>Resending removes this message and everything after it.</span>';
		const cancel = document.createElement('button');
		cancel.type = 'button';
		cancel.className = 'nx-editCancel';
		cancel.textContent = 'Cancel';
		const send = document.createElement('button');
		send.type = 'button';
		send.className = 'nx-editSend';
		send.textContent = 'Send';
		hint.appendChild(cancel);
		hint.appendChild(send);

		const finish = function () {
			div.classList.remove('nx-editing');
			body.innerHTML = saved;
		};
		cancel.addEventListener('click', finish);
		send.addEventListener('click', function () { rewindTo(div, editor.value); });
		editor.addEventListener('input', fit);
		editor.addEventListener('keydown', function (event) {
			if (event.key === 'Escape') {
				event.preventDefault();
				finish();
			} else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				rewindTo(div, editor.value);
			}
		});

		div.classList.add('nx-editing');
		body.replaceChildren(editor, hint);
		fit();
		editor.focus();
		editor.setSelectionRange(editor.value.length, editor.value.length);
	}

	/** The Agent message just sent owns this checkpoint. */
	function tagLatestUserMessage(id) {
		if (!messages || !id) {
			return;
		}
		const users = messages.querySelectorAll('.nx-msg.nx-user:not([data-checkpoint])');
		const latest = users[users.length - 1];
		if (latest) {
			latest.setAttribute('data-checkpoint', id);
		}
	}

	/**
	 * Restore appears on a message when the agent changed files at or after it.
	 * Restoring puts those files back as they were before the message.
	 */
	function showRestoreButtons(restorable) {
		if (!messages) {
			return;
		}
		const allowed = new Set(restorable);
		messages.querySelectorAll('.nx-msg.nx-user[data-checkpoint]').forEach(function (div) {
			const id = div.getAttribute('data-checkpoint');
			let button = div.querySelector('.nx-restoreBtn');
			if (!allowed.has(id)) {
				if (button) {
					button.remove();
				}
				return;
			}
			if (!button) {
				button = document.createElement('button');
				button.type = 'button';
				button.className = 'nx-restoreBtn';
				button.textContent = 'Restore files';
				button.title = 'Put the files the agent changed back to how they were before this message';
				button.addEventListener('click', function () {
					vscode.postMessage({ type: 'restoreCheckpoint', id: id });
				});
				div.appendChild(button);
			}
		});
	}

	/**
	 * A "remember ..." message saved a project fact. Show it inline with a way
	 * to review it -- memory written silently is memory the user cannot trust.
	 */
	function addMemoryNote(value) {
		const text = String(value || '').trim();
		if (!text || !messages) {
			return;
		}
		if (welcome) {
			welcome.style.display = 'none';
		}
		const row = document.createElement('div');
		row.className = 'nx-memoryNote';
		row.innerHTML = '<span class="nx-memoryNoteIcon" aria-hidden="true"></span>'
			+ '<span class="nx-memoryNoteText">Remembered: ' + escapeHtml(text) + '</span>'
			+ '<button type="button" class="nx-memoryNoteLink">Manage</button>';
		row.querySelector('.nx-memoryNoteLink').addEventListener('click', function () {
			vscode.postMessage({ type: 'openSettings', section: 'memory' });
		});
		// Sit above the in-flight reply bubble so the reply stays last.
		if (lastLoadingMessage && lastLoadingMessage.parentNode === messages) {
			messages.insertBefore(row, lastLoadingMessage);
		} else {
			messages.appendChild(row);
		}
		messages.scrollTop = messages.scrollHeight;
	}

	function appendToken(content) {
		const chunk = String(content || '');
		if (!chunk) {
			return;
		}
		textSinceGroup = true;
		if (!lastLoadingMessage) {
			addMessage('assistant', '', true);
		}
		const body = lastLoadingMessage.querySelector('.nx-msgBody');
		if (!body) {
			return;
		}
		if (body.getAttribute('data-nx-streaming') !== '1') {
			streamText = chunk;
			body.setAttribute('data-nx-streaming', '1');
			lastLoadingMessage.classList.add('nx-msgStreaming');
		} else {
			streamText += chunk;
		}
		// Format the text as it arrives, at most once per frame, so bold, lists
		// and code blocks look right while streaming instead of jumping at the end.
		if (!streamFrame) {
			streamFrame = requestAnimationFrame(renderStream);
		}
	}

	function renderStream() {
		streamFrame = 0;
		if (!lastLoadingMessage) {
			return;
		}
		const body = lastLoadingMessage.querySelector('.nx-msgBody');
		if (!body || body.getAttribute('data-nx-streaming') !== '1') {
			return;
		}
		body.innerHTML = formatContent(streamText);
	}

	function finishMessage() {
		if (!lastLoadingMessage) {
			setReplyInFlight(false);
			return;
		}
		if (streamFrame) {
			cancelAnimationFrame(streamFrame);
			streamFrame = 0;
		}
		const body = lastLoadingMessage.querySelector('.nx-msgBody');
		const streaming = !!body && body.getAttribute('data-nx-streaming') === '1';
		const text = streaming ? streamText : (body ? (body.textContent || '') : '');
		lastLoadingMessage.classList.remove('nx-msgLoading', 'nx-msgStreaming');
		streamText = '';
		if (body) {
			body.removeAttribute('data-nx-streaming');
			body.innerHTML = formatContent(text);
		}
		lastLoadingMessage = null;
		setReplyInFlight(false);
		messages.scrollTop = messages.scrollHeight;
	}

	function clearMessagesUi() {
		if (!messages) {
			return;
		}
		// Clear everything except the welcome block (so it can be shown for empty sessions)
		Array.from(messages.children).forEach((child) => {
			if (welcome && child === welcome) {
				return;
			}
			child.remove();
		});
		lastLoadingMessage = null;
		clearChatActivityCard();
		currentPlan = null;
		planCardElement = null;
		setReplyInFlight(false);
	}

	// Chat list rail: chats grouped by last activity, filtered by the search box, renamed in place.
	const RAIL_GROUPS = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'Older'];
	const RAIL_NAME_MAX = 80;
	let railSessions = [];
	let railQuery = '';
	let renamingSessionId = '';
	let renameDraft = '';
	let railDrawing = false;

	function sessionTime(s) {
		const t = Number(s.updatedAt || s.createdAt);
		return isFinite(t) ? t : 0;
	}

	/** Index into RAIL_GROUPS, by calendar day in local time. */
	function railGroupIndex(time, now) {
		const d = new Date(now);
		const dayStart = function (back) {
			return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
		};
		if (time >= dayStart(0)) {
			return 0;
		}
		if (time >= dayStart(1)) {
			return 1;
		}
		if (time >= dayStart(7)) {
			return 2;
		}
		return time >= dayStart(30) ? 3 : 4;
	}

	function relativeAge(time, now) {
		const min = Math.floor(Math.max(0, now - time) / 60000);
		if (min < 1) {
			return 'now';
		}
		if (min < 60) {
			return min + 'm';
		}
		const hours = Math.floor(min / 60);
		if (hours < 24) {
			return hours + 'h';
		}
		const days = Math.floor(hours / 24);
		if (days < 7) {
			return days + 'd';
		}
		if (days < 30) {
			return Math.floor(days / 7) + 'w';
		}
		return days < 365 ? Math.floor(days / 30) + 'mo' : Math.floor(days / 365) + 'y';
	}

	function railIconButton(icon, label, onClick) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'nx-railAction';
		btn.title = label;
		btn.setAttribute('aria-label', label);
		const i = document.createElement('i');
		i.className = 'codicon codicon-' + icon;
		i.setAttribute('aria-hidden', 'true');
		btn.appendChild(i);
		btn.addEventListener('click', function (ev) {
			ev.stopPropagation();
			onClick();
		});
		return btn;
	}

	function startRename(id, name) {
		renamingSessionId = id;
		renameDraft = name;
		drawRail();
	}

	function endRename(id, save) {
		if (renamingSessionId !== id) {
			return;
		}
		const name = renameDraft.replace(/\s+/g, ' ').trim().slice(0, RAIL_NAME_MAX);
		renamingSessionId = '';
		const session = railSessions.find(function (s) { return s.id === id; });
		if (save && name && session && name !== session.name) {
			session.name = name;
			vscode.postMessage({ type: 'renameSession', sessionId: id, name: name });
		}
		drawRail();
	}

	function railRow(s, now) {
		const id = s.id;
		const name = s.name || 'New chat';
		const row = document.createElement('div');
		row.className = 'nx-railItem' + (id === activeSessionId ? ' is-active' : '');
		row.setAttribute('data-session-id', id);

		if (id === renamingSessionId) {
			const field = document.createElement('input');
			field.type = 'text';
			field.className = 'nx-railRename';
			field.maxLength = RAIL_NAME_MAX;
			field.value = renameDraft;
			field.setAttribute('aria-label', 'Chat name');
			field.addEventListener('input', function () {
				renameDraft = field.value;
			});
			field.addEventListener('keydown', function (ev) {
				if (ev.key === 'Enter') {
					ev.preventDefault();
					endRename(id, true);
				} else if (ev.key === 'Escape') {
					ev.preventDefault();
					endRename(id, false);
				}
			});
			field.addEventListener('blur', function () {
				// Clicking elsewhere keeps the name, as in the Explorer. A redraw (which removes the
				// focused field) or the window losing focus is not the user leaving, so the edit stays open.
				if (!railDrawing && document.hasFocus()) {
					endRename(id, true);
				}
			});
			row.appendChild(field);
			return row;
		}

		const openBtn = document.createElement('button');
		openBtn.type = 'button';
		openBtn.className = 'nx-railOpen';
		openBtn.title = name;
		if (id === activeSessionId) {
			openBtn.setAttribute('aria-current', 'true');
		}
		const label = document.createElement('span');
		label.className = 'nx-railOpenText';
		label.textContent = name;
		const age = document.createElement('span');
		age.className = 'nx-railAge';
		age.textContent = relativeAge(sessionTime(s), now);
		openBtn.appendChild(label);
		openBtn.appendChild(age);
		openBtn.addEventListener('click', function () {
			if (id !== activeSessionId) {
				vscode.postMessage({ type: 'switchSession', sessionId: id });
			}
		});
		openBtn.addEventListener('dblclick', function () {
			startRename(id, name);
		});

		const actions = document.createElement('div');
		actions.className = 'nx-railActions';
		actions.appendChild(railIconButton('edit', 'Rename ' + name, function () {
			startRename(id, name);
		}));
		actions.appendChild(railIconButton('trash', 'Delete ' + name, function () {
			vscode.postMessage({ type: 'deleteSession', sessionId: id });
		}));

		row.appendChild(openBtn);
		row.appendChild(actions);
		return row;
	}

	function drawRail() {
		if (!sessionList) {
			return;
		}
		const now = Date.now();
		const query = railQuery.trim().toLowerCase();
		const shown = railSessions
			.filter(function (s) { return !query || (s.name || '').toLowerCase().indexOf(query) >= 0; })
			.sort(function (a, b) { return sessionTime(b) - sessionTime(a); });
		railDrawing = true;
		sessionList.innerHTML = '';
		railDrawing = false;
		if (!shown.length && query) {
			const empty = document.createElement('div');
			empty.className = 'nx-railEmpty';
			empty.textContent = 'No chats match';
			sessionList.appendChild(empty);
			return;
		}
		let group = -1;
		shown.forEach(function (s) {
			const g = railGroupIndex(sessionTime(s), now);
			if (g !== group) {
				group = g;
				const head = document.createElement('div');
				head.className = 'nx-railGroup';
				head.textContent = RAIL_GROUPS[g];
				sessionList.appendChild(head);
			}
			sessionList.appendChild(railRow(s, now));
		});
		const field = sessionList.querySelector('.nx-railRename');
		if (field) {
			field.focus();
			field.setSelectionRange(field.value.length, field.value.length);
		}
	}

	function renderSessions(sessions, activeId) {
		if (activeId) {
			activeSessionId = activeId;
		}
		railSessions = (sessions || [])
			.filter(function (s) { return s && s.id; })
			.map(function (s) {
				return { id: String(s.id), name: String(s.name || ''), createdAt: s.createdAt, updatedAt: s.updatedAt };
			});
		if (renamingSessionId && !railSessions.some(function (s) { return s.id === renamingSessionId; })) {
			renamingSessionId = '';
		}
		drawRail();
	}

	function setRailHidden(hidden) {
		const rail = document.getElementById('sessionRail');
		if (rail) {
			rail.classList.toggle('is-hidden', !!hidden);
		}
	}

	function closeRailSearch() {
		railQuery = '';
		if (railSearch) {
			railSearch.value = '';
		}
		if (railSearchRow) {
			railSearchRow.hidden = true;
		}
		drawRail();
	}

	function loadSessionMessages(sessionId, msgs) {
		activeSessionId = sessionId;
		clearMessagesUi();
		const arr = (msgs || []);
		if (welcome) {
			welcome.style.display = arr.length === 0 ? 'flex' : 'none';
		}
		arr.forEach(function (m) {
			addMessage(m.role, m.content, false, false, m.activity);
			if (m.role === 'user' && m.checkpointId) {
				// The activity fold may follow the message, so find it by class, not position.
				const users = messages.querySelectorAll('.nx-msg.nx-user');
				users[users.length - 1].setAttribute('data-checkpoint', m.checkpointId);
			}
		});
	}

	function planTaskStatusMark(status) {
		const s = (status || 'pending').toLowerCase();
		if (s === 'success') {
			return '+';
		}
		if (s === 'failed' || s === 'cancelled') {
			return 'x';
		}
		if (s === 'running' || s === 'retrying') {
			return '>';
		}
		if (s === 'skipped') {
			return '-';
		}
		if (s === 'queued') {
			return 'q';
		}
		return 'o';
	}

	// --- capability step details (spec section 8) ---------------------------------

	const EFFECT_LABELS = { read: 'reads', write: 'changes', destructive: 'destructive' };

	/** "GitHub via MCP", "github API", "IDE agent": which route the step will take. */
	const LOCAL_AGENT_NAMES = { 'claude-code': 'Claude Code', cursor: 'Cursor', cline: 'Cline' };

	/** Who runs an agent step (Phase 5), or '' for any other capability. */
	function planAgentLabel(capability) {
		const id = String(capability || '');
		const name = id.split('.').slice(2).join('.');
		if (id.indexOf('agent.local.') === 0) {
			return (LOCAL_AGENT_NAMES[name] || name) + ' (local agent)';
		}
		if (id.indexOf('agent.sub.') === 0) {
			return 'subagent ' + name;
		}
		if (id.indexOf('agent.a2a.') === 0) {
			return 'remote agent ' + name;
		}
		return '';
	}

	/** "4 of 5 past runs worked, about 40 s" from what past runs taught the router. */
	function planLearnedLabel(learned) {
		if (!learned || !learned.runs) {
			return '';
		}
		const seconds = Math.round(Number(learned.avg_ms || 0) / 1000);
		const took = seconds >= 120 ? 'about ' + Math.round(seconds / 60) + ' min' : 'about ' + seconds + ' s';
		return learned.ok + ' of ' + learned.runs + ' past runs worked, ' + took;
	}

	function planRouteLabel(route, capability) {
		if (!route || !route.kind) {
			return '';
		}
		const agent = planAgentLabel(capability);
		if (agent) {
			return agent;
		}
		const provider = String(route.target || '').split('/')[0];
		if (route.kind === 'mcp') {
			return provider + ' via MCP';
		}
		if (route.kind === 'rest') {
			return provider + ' API';
		}
		if (route.kind === 'ide') {
			return 'IDE agent';
		}
		if (route.kind === 'engine') {
			return 'Nexora engine';
		}
		return String(route.target || route.kind) + ' (terminal)';
	}

	/** Button text for a readiness fix such as "connect:github". */
	function planFixLabel(fix) {
		const at = fix.indexOf(':');
		const kind = at < 0 ? fix : fix.slice(0, at);
		const name = at < 0 ? '' : fix.slice(at + 1);
		if (kind === 'connect') {
			return 'Connect ' + name;
		}
		if (kind === 'oauth') {
			return 'Sign in to ' + name;
		}
		if (kind === 'settings') {
			return 'Add ' + name + ' key';
		}
		if (kind === 'install') {
			return 'Install ' + name;
		}
		if (kind === 'open-folder') {
			return 'Open a folder';
		}
		return fix;
	}

	/** One editable field for a needs_input step: string, number, boolean or enum; else JSON. */
	function planInputField(name, schema, value, required) {
		const id = 'nx-in-' + Math.random().toString(36).slice(2);
		const label = `<label class="nx-stepInputLabel" for="${id}">${escapeHtml(name)}${required ? ' *' : ''}</label>`;
		const attrs = `id="${id}" class="nx-stepInput" data-input="${escapeHtml(name)}"`;
		const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type;
		if (Array.isArray(schema.enum)) {
			const options = schema.enum.map(v =>
				`<option value="${escapeHtml(String(v))}"${v === value ? ' selected' : ''}>${escapeHtml(String(v))}</option>`).join('');
			return label + `<select ${attrs} data-kind="enum">${options}</select>`;
		}
		if (type === 'boolean') {
			return `<label class="nx-stepInputLabel"><input type="checkbox" ${attrs} data-kind="boolean"${value === true ? ' checked' : ''}> ${escapeHtml(name)}</label>`;
		}
		if (type === 'number' || type === 'integer') {
			const shown = typeof value === 'number' ? String(value) : '';
			return label + `<input type="number" ${attrs} data-kind="${type}" value="${escapeHtml(shown)}">`;
		}
		if (type === 'string') {
			const shown = typeof value === 'string' ? value : '';
			return label + `<input type="text" ${attrs} data-kind="string" value="${escapeHtml(shown)}">`;
		}
		const shown = value === undefined ? '' : JSON.stringify(value, null, 2);
		return label + `<textarea ${attrs} data-kind="json" rows="3">${escapeHtml(shown)}</textarea>`;
	}

	/** The input form for a step that cannot run until its inputs are fixed. */
	function planNeedsInput(planId, task) {
		const problems = (task.needs_input || []).map(p => `<div class="nx-needsMsg">${escapeHtml(p)}</div>`).join('');
		const schema = task.input_schema || {};
		const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
		const required = Array.isArray(schema.required) ? schema.required : [];
		const names = Object.keys(properties).sort((a, b) => (required.includes(b) ? 1 : 0) - (required.includes(a) ? 1 : 0));
		const inputs = task.inputs || {};
		const fields = names.map(name =>
			`<div class="nx-stepField">${planInputField(name, properties[name] || {}, inputs[name], required.includes(name))}</div>`).join('');
		const save = fields
			? `<button type="button" class="nx-saveInputsBtn" data-plan-id="${escapeHtml(planId)}" data-task-id="${escapeHtml(task.task_id)}">Save inputs</button>`
			: '';
		return `<div class="nx-stepNeeds">${problems}${fields}${save}<div class="nx-stepInputError" hidden></div></div>`;
	}

	/** Capability, route, effects, undo, cost, readiness fixes and inputs for one step. */
	function planStepDetails(planId, task) {
		if (!task.capability) {
			return '';
		}
		const meta = [`<span class="nx-stepCap">${escapeHtml(task.capability)}</span>`];
		const route = planRouteLabel(task.route, task.capability);
		if (route) {
			meta.push(`<span class="nx-stepRoute">${escapeHtml(route)}</span>`);
		}
		const kind = task.effects && task.effects.kind;
		if (kind) {
			meta.push(`<span class="nx-stepBadge nx-effect-${escapeHtml(kind)}">${EFFECT_LABELS[kind] || escapeHtml(kind)}</span>`);
		}
		if (task.undo_available) {
			meta.push(`<span class="nx-stepUndo">undo: ${escapeHtml(task.undo_title || 'available')}</span>`);
		} else if (kind && kind !== 'read') {
			meta.push(`<span class="nx-stepBadge nx-noUndo" title="${escapeHtml(task.undo_reason || '')}">can't be undone</span>`);
		}
		meta.push(`<span class="nx-stepCost">${task.cost_known === false ? 'cost ?' : '$' + Number(task.estimated_cost || 0).toFixed(4)}</span>`);
		if (Array.isArray(task.skills) && task.skills.length) {
			meta.push(`<span class="nx-stepSkills" title="Skills this step's agent loads">skills: ${task.skills.map(escapeHtml).join(', ')}</span>`);
		}
		const learned = planLearnedLabel(task.learned);
		if (learned) {
			meta.push(`<span class="nx-stepLearned" title="Nexora orders routes and agents by what worked before">${escapeHtml(learned)}</span>`);
		}

		let readiness = '';
		const fixes = task.readiness && !task.readiness.ready && Array.isArray(task.readiness.fixes) ? task.readiness.fixes : [];
		if (task.readiness && !task.readiness.ready) {
			readiness = '<div class="nx-stepFixes"><span class="nx-stepNotReady">Not ready</span>' +
				fixes.map(f => `<button type="button" class="nx-fixBtn" data-fix="${escapeHtml(f)}">${escapeHtml(planFixLabel(f))}</button>`).join('') +
				'</div>';
		}
		const needsInput = Array.isArray(task.needs_input) && task.needs_input.length > 0;
		const needs = needsInput ? planNeedsInput(planId, task) : '';
		// a step the plan should not have, or that cannot run, can be dropped before approving
		const pending = !task.status || String(task.status).toLowerCase() === 'pending';
		const remove = pending && (needsInput || (task.readiness && !task.readiness.ready))
			? `<button type="button" class="nx-removeStepBtn" data-plan-id="${escapeHtml(planId)}" data-task-id="${escapeHtml(task.task_id)}">Remove step</button>`
			: '';
		return `<div class="nx-stepMeta">${meta.join('')}</div>${readiness}${needs}${remove}`;
	}

	/** The inputs typed into a step's form, or an error naming the field that is not valid. */
	function readStepInputs(taskEl) {
		const inputs = {};
		for (const el of taskEl.querySelectorAll('.nx-stepInput')) {
			const name = el.getAttribute('data-input');
			const kind = el.getAttribute('data-kind');
			if (kind === 'boolean') {
				inputs[name] = el.checked;
				continue;
			}
			const raw = String(el.value || '').trim();
			if (!raw) {
				continue;
			}
			if (kind === 'number' || kind === 'integer') {
				const n = Number(raw);
				if (!Number.isFinite(n) || (kind === 'integer' && !Number.isInteger(n))) {
					return { error: name + ' must be a ' + (kind === 'integer' ? 'whole number' : 'number') };
				}
				inputs[name] = n;
			} else if (kind === 'json') {
				try {
					inputs[name] = JSON.parse(raw);
				} catch {
					return { error: name + ' is not valid JSON' };
				}
			} else {
				inputs[name] = raw;
			}
		}
		return { inputs: inputs };
	}

	function createPlanApprovalCard(plan) {
		if (welcome) {
			welcome.style.display = 'none';
		}

		if (planCardElement) {
			planCardElement.remove();
		}

		currentPlan = plan;

		const card = document.createElement('div');
		card.className = 'nx-planCard';
		card.id = 'plan-card-' + plan.plan_id;

		const header = document.createElement('div');
		header.className = 'nx-planHeader';
		header.innerHTML = `
			<div class="nx-planTitle">Execution Plan</div>
			<div class="nx-planMeta">
				<span class="nx-planId">${plan.plan_id}</span>
				<span class="nx-planCost" title="${plan.estimated_cost_range ? 'Code steps run the agent for several turns, so their cost is a range' : ''}">Est. $${(plan.estimated_cost || 0).toFixed(4)}${costRangeText(plan.estimated_cost_range)}</span>
			</div>
		`;
		card.appendChild(header);

		if (Array.isArray(plan.cost_breakdown) && plan.cost_breakdown.length) {
			const breakdown = document.createElement('div');
			breakdown.className = 'nx-costBreakdown';
			breakdown.innerHTML = '<div class="nx-costBreakdownTitle">Cost breakdown</div>' +
				plan.cost_breakdown.map(item => `
					<div class="nx-costRow">
						<span>${escapeHtml(item.task || item.platform || 'task')} · ${escapeHtml(item.platform || '')}</span>
						<span>$${(item.estimated_cost || 0).toFixed(4)}${costRangeText(item.estimated_cost_range)}</span>
					</div>
				`).join('');
			card.appendChild(breakdown);
		}

		const taskList = document.createElement('div');
		taskList.className = 'nx-planTasks';
		taskList.id = 'plan-tasks-' + plan.plan_id;

		(plan.tasks || []).forEach((task) => {
			const initialStatus = (task.status || 'pending').toLowerCase();
			const taskEl = document.createElement('div');
			taskEl.className = 'nx-planTask';
			taskEl.id = 'task-' + task.task_id;
			taskEl.setAttribute('data-status', initialStatus);
			taskEl.innerHTML = `
				<div class="nx-taskStatus">
					<span class="nx-taskMark">${planTaskStatusMark(initialStatus)}</span>
				</div>
				<div class="nx-taskInfo">
					<div class="nx-taskName">${escapeHtml(task.name || task.task_id)}</div>
					${planStepDetails(plan.plan_id, task)}
				</div>
			`;
			taskList.appendChild(taskEl);
		});
		card.appendChild(taskList);

		const actions = document.createElement('div');
		actions.className = 'nx-planActions';
		actions.id = 'plan-actions-' + plan.plan_id;
		actions.innerHTML = `
			<button class="nx-cancelBtn" data-plan-id="${plan.plan_id}">Cancel</button>
			<button class="nx-approveBtn" data-plan-id="${plan.plan_id}">Approve & Execute</button>
		`;
		card.appendChild(actions);

		messages.appendChild(card);
		messages.scrollTop = messages.scrollHeight;

		planCardElement = card;

		if (lastLoadingMessage) {
			lastLoadingMessage.remove();
			lastLoadingMessage = null;
		}
	}

	/** " ($low to $high)" for a code step's agent loop; empty for single-call steps. */
	function costRangeText(range) {
		if (!Array.isArray(range) || range.length !== 2 || range[0] === range[1]) {
			return '';
		}
		return ` ($${Number(range[0]).toFixed(4)}\u2013$${Number(range[1]).toFixed(4)})`;
	}

	function updateTaskStatus(taskId, status, error, cost) {
		const normalized = (status || 'pending').toLowerCase();
		const taskEl = document.getElementById('task-' + taskId);
		if (!taskEl) {
			return;
		}

		taskEl.setAttribute('data-status', normalized);

		const markEl = taskEl.querySelector('.nx-taskMark');
		if (markEl) {
			markEl.textContent = planTaskStatusMark(normalized);
		}

		if (currentPlan && currentPlan.tasks) {
			const task = currentPlan.tasks.find(function (t) {
				return t.task_id === taskId;
			});
			if (task) {
				task.status = normalized;
				if (error !== undefined) {
					task.error = error;
				}
				if (cost !== undefined && cost !== null) {
					task.actual_cost = cost;
				}
			}
		}
	}

	function showTaskRetry(taskId, taskName, attempt, maxAttempts, platform) {
		const taskEl = document.getElementById('task-' + taskId);
		if (!taskEl) {
			return;
		}

		taskEl.setAttribute('data-status', 'retrying');

		let retryEl = taskEl.querySelector('.nx-taskRetry');
		if (!retryEl) {
			retryEl = document.createElement('div');
			retryEl.className = 'nx-taskRetry';
			taskEl.querySelector('.nx-taskInfo').appendChild(retryEl);
		}
		retryEl.textContent = `Retry ${attempt}/${maxAttempts} on ${platform}...`;
	}

	function showUserEscalation(data) {
		const taskKey = (data.planId || '') + ':' + (data.taskId || data.taskName || 'task');
		if (shownEscalationKeys[taskKey]) {
			return;
		}
		shownEscalationKeys[taskKey] = true;

		const platformsTried = data.platformsTried || [data.platform];
		const platformList = (platformsTried || []).join(', ');

		if (welcome) {
			welcome.style.display = 'none';
		}

		const div = document.createElement('div');
		div.className = 'nx-msg nx-assistant';
		div.setAttribute('data-escalation-key', taskKey);

		const header = document.createElement('div');
		header.className = 'nx-msgHeader';
		header.textContent = 'Nexora';

		const body = document.createElement('div');
		body.className = 'nx-msgBody';
		body.innerHTML = `
			<div class="nx-escalation">
				<div class="nx-escalationHeader">
					<span class="nx-escalationIcon">!</span>
					<strong>Task failed</strong>
				</div>
				<div class="nx-escalationBody">
					<div class="nx-escalationTask">
						<strong>${escapeHtml(data.taskName || data.taskId)}</strong>
						<span class="nx-escalationOp">${escapeHtml(data.operation || 'unknown')}</span>
					</div>
					<div class="nx-escalationDetails">
						<div><span class="nx-escalationLabel">Platform:</span> ${escapeHtml(platformList)}</div>
						<div class="nx-escalationError"><span class="nx-escalationLabel">Error:</span> ${escapeHtml(data.error || 'Unknown error')}</div>
					</div>
					<div class="nx-escalationMessage">
						${escapeHtml(data.message || 'This step failed. Engine logs are in the Nexora Engine output channel.')}
					</div>
					<div class="nx-escalationActions">
						<button type="button" class="nx-openEngineOutput">Open Nexora Output</button>
					</div>
				</div>
			</div>
		`;

		div.appendChild(header);
		div.appendChild(body);
		messages.appendChild(div);
		messages.scrollTop = messages.scrollHeight;
	}

	function applyPlanSnapshot(plan) {
		if (!plan || !plan.plan_id) {
			return;
		}
		const planId = plan.plan_id;
		if (!document.getElementById('plan-card-' + planId)) {
			createPlanApprovalCard(plan);
		}
		const tasks = plan.tasks || [];
		tasks.forEach(task => {
			const st = (task.status || 'pending').toLowerCase();
			updateTaskStatus(task.task_id, st, task.error, task.actual_cost);
		});
		const status = (plan.status || '').toLowerCase();
		if (status === 'executing' || status === 'approved') {
			showPlanExecuting(planId);
		} else if (status === 'completed' || status === 'failed' || status === 'cancelled'
			|| status === 'partially_completed' || status === 'timeout' || status === 'skipped') {
			const actual = typeof plan.actual_cost === 'number'
				? plan.actual_cost
				: typeof plan.actual_total_cost === 'number'
					? plan.actual_total_cost
					: tasks.reduce((sum, t) => sum + (Number(t.actual_cost) || 0), 0);
			showPlanComplete(planId, status, tasks, actual, {
				repo_url: plan.repo_url,
				deployment_url: plan.deployment_url
			});
		}
	}

	function showPlanExecuting(planId) {
		clearStepRetryButtons(planId);
		Object.keys(shownEscalationKeys).forEach(function (key) {
			if (key.indexOf(planId + ':') === 0) {
				delete shownEscalationKeys[key];
			}
		});
		const actionsEl = document.getElementById('plan-actions-' + planId);
		if (actionsEl) {
			actionsEl.innerHTML = `
				<div class="nx-planExecuting">
					<span class="nx-spinner"></span>
					<span>Executing tasks...</span>
				</div>
			`;
		}
	}

	/** Approve was refused or failed: stop the spinner, show why, and offer Cancel again. */
	function showPlanApproveFailed(planId, message) {
		const actionsEl = document.getElementById('plan-actions-' + planId);
		if (!actionsEl) {
			return;
		}
		actionsEl.innerHTML = `
			<div class="nx-planResult nx-planFailed nx-planApproveError">
				<span class="nx-resultIcon">!</span>
				<span class="nx-resultText">${escapeHtml(message || 'The plan could not start.')}</span>
			</div>
			<button class="nx-cancelBtn" data-plan-id="${escapeHtml(planId)}">Cancel</button>
		`;
	}

	/** Links to what the run produced. The engine reads these off the task results. */
	function planArtifactLinks(artifacts) {
		if (!artifacts) {
			return '';
		}
		const rows = [
			{ label: 'Repository', url: artifacts.repo_url },
			{ label: 'Live URL', url: artifacts.deployment_url }
		].filter(row => typeof row.url === 'string' && /^https?:\/\//i.test(row.url));
		if (!rows.length) {
			return '';
		}
		return '<div class="nx-planArtifacts">' + rows.map(row =>
			`<a class="nx-planArtifactLink" href="${escapeHtml(row.url)}" title="${escapeHtml(row.url)}">`
			+ `${escapeHtml(row.label)}</a>`
		).join('') + '</div>';
	}

	function showPlanComplete(planId, status, tasks, actualCost, artifacts) {
		const actionsEl = document.getElementById('plan-actions-' + planId);
		const resolvedTasks = tasks || (currentPlan && currentPlan.plan_id === planId ? currentPlan.tasks : null);
		if (actionsEl) {
			const isSuccess = status === 'completed';
			// every step was skipped (nothing connected): say so instead of "completed"
			const isSkipped = status === 'skipped';
			const successCount = resolvedTasks ? resolvedTasks.filter(t => t.status === 'success').length : 0;
			const failedCount = resolvedTasks ? resolvedTasks.filter(t => t.status === 'failed').length : 0;

			actionsEl.innerHTML = `
				<div class="nx-planResult ${isSuccess ? 'nx-planSuccess' : 'nx-planFailed'}">
					<span class="nx-resultIcon">${isSuccess ? 'ok' : '!'}</span>
					<span class="nx-resultText">
						${isSuccess ? 'Completed' : isSkipped ? 'Nothing ran: connect what the steps need, then retry them' : 'Completed with issues'}
						${successCount > 0 ? ` • ${successCount} succeeded` : ''}
						${failedCount > 0 ? ` • ${failedCount} failed` : ''}
					</span>
					<span class="nx-resultCost">$${(actualCost || 0).toFixed(4)}</span>
				</div>
				${planArtifactLinks(artifacts)}
			`;
		}

		// Clear leftover "Running the plan..." loading bubble once the plan finishes.
		if (lastLoadingMessage) {
			const body = lastLoadingMessage.querySelector('.nx-msgBody');
			const text = (body && body.textContent) ? body.textContent.trim() : '';
			if (!text || text === 'Running the plan...') {
				lastLoadingMessage.remove();
				lastLoadingMessage = null;
			}
		}
		if (messages) {
			messages.querySelectorAll('.nx-msg.nx-assistant').forEach(function (el) {
				const body = el.querySelector('.nx-msgBody');
				if (body && body.textContent && body.textContent.trim() === 'Running the plan...') {
					el.remove();
				}
			});
		}

		if (resolvedTasks) {
			resolvedTasks.forEach(task => {
				updateTaskStatus(task.task_id, task.status, task.error, task.actual_cost);
			});
		}
		showStepRetryButtons(planId);

		currentPlan = null;
	}

	const RETRYABLE_STEP_STATUSES = ['failed', 'timeout', 'skipped'];

	/**
	 * Retry on each failed, timed-out or skipped step of a finished plan. The rows
	 * keep their live status, so this works after a retry finishes too. A skipped
	 * step is often one that needed a connection the user has since made.
	 */
	function showStepRetryButtons(planId) {
		const list = document.getElementById('plan-tasks-' + planId);
		if (!list) {
			return;
		}
		list.querySelectorAll('.nx-planTask').forEach(function (taskEl) {
			const status = (taskEl.getAttribute('data-status') || '').toLowerCase();
			let button = taskEl.querySelector('.nx-stepRetryBtn');
			if (RETRYABLE_STEP_STATUSES.indexOf(status) === -1) {
				if (button) {
					button.remove();
				}
				return;
			}
			if (button) {
				return;
			}
			const taskId = taskEl.id.replace(/^task-/, '');
			button = document.createElement('button');
			button.type = 'button';
			button.className = 'nx-stepRetryBtn';
			button.textContent = 'Retry';
			button.title = 'Run this step again, and the steps after it that did not run';
			button.addEventListener('click', function () {
				clearStepRetryButtons(planId);
				vscode.postMessage({ type: 'retryPlanTask', planId: planId, taskId: taskId });
			});
			taskEl.appendChild(button);
		});
	}

	function clearStepRetryButtons(planId) {
		const list = document.getElementById('plan-tasks-' + planId);
		if (list) {
			list.querySelectorAll('.nx-stepRetryBtn').forEach(function (button) {
				button.remove();
			});
		}
	}

	function showSuggestion(suggestion) {
		if (!suggestionStrip) {
			return;
		}
		if (!suggestion || !suggestion.id) {
			currentSuggestionId = null;
			suggestionStrip.hidden = true;
			return;
		}
		currentSuggestionId = suggestion.id;
		if (suggestTitle) {
			suggestTitle.textContent = suggestion.title || 'Suggested next step';
		}
		if (suggestReason) {
			suggestReason.textContent = suggestion.reason || '';
		}
		suggestionStrip.hidden = false;
	}

	function hideSuggestion() {
		currentSuggestionId = null;
		if (suggestionStrip) {
			suggestionStrip.hidden = true;
		}
	}

	function showSaveTemplateForm(planId, parameters) {
		if (welcome) {
			welcome.style.display = 'none';
		}
		if (saveTemplateCard) {
			saveTemplateCard.remove();
		}

		const card = document.createElement('div');
		card.className = 'nx-saveCard';
		card.id = 'save-template-' + planId;

		const params = Array.isArray(parameters) ? parameters : [];
		const rows = params.map((param, index) => {
			const included = param.suggest_only ? '' : ' checked';
			return `
				<div class="nx-saveParam" data-index="${index}">
					<label><input type="checkbox" data-include${included} /> include</label>
					<input type="text" data-name value="${escapeHtml(param.name || '')}" placeholder="name" />
					<input type="text" data-value value="${escapeHtml(param.source_value || '')}" placeholder="value" />
				</div>
			`;
		}).join('');

		card.innerHTML = `
			<div class="nx-saveTitle">Save as template</div>
			<div class="nx-saveField">
				<label for="saveTplName">Name</label>
				<input id="saveTplName" type="text" value="Saved workflow" />
			</div>
			<div class="nx-saveField">
				<label for="saveTplDesc">Description</label>
				<input id="saveTplDesc" type="text" value="" />
			</div>
			<div class="nx-saveField">
				<label for="saveTplCat">Category</label>
				<input id="saveTplCat" type="text" value="custom" />
			</div>
			${rows}
			<div class="nx-saveActions">
				<button type="button" class="nx-saveConfirm" id="saveTplConfirm" data-plan-id="${escapeHtml(planId)}">Save template</button>
				<button type="button" class="nx-saveCancel" id="saveTplCancel">Cancel</button>
			</div>
		`;

		messages.appendChild(card);
		messages.scrollTop = messages.scrollHeight;
		saveTemplateCard = card;
	}

	function handleStop() {
		if (!replyInFlight) {
			return;
		}
		vscode.postMessage({ type: 'stopGeneration' });
	}

	/**
	 * Chat mode has no tools. Under its reply, one click sends the same request
	 * again in Agent mode, which can actually create, edit and run things.
	 */
	function offerAgentRun(text) {
		const replies = messages.querySelectorAll('.nx-msg.nx-assistant');
		const last = replies[replies.length - 1];
		if (!last || last.classList.contains('nx-msgStopped') || last.querySelector('.nx-agentOffer')) {
			return;
		}
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'nx-agentOffer';
		button.textContent = 'Run in Agent mode';
		button.title = 'Send this request again in Agent mode, which can edit files and run commands';
		button.addEventListener('click', function () {
			if (replyInFlight || !modeSelect) {
				return;
			}
			button.remove();
			modeSelect.value = 'agent';
			updateModeUI();
			input.value = text;
			handleSend();
		});
		last.appendChild(button);
	}

	/** resend: a rewound message replays with its own context tags, not the ones queued for the next message. */
	function handleSend(resend) {
		if (replyInFlight) {
			return;
		}

		const composer = window.NexoraComposer;
		const text = input.value.trim() || (composer && composer.hasContext() ? 'Use the attached context' : '');
		if (!text) {
			return;
		}

		hideAtCompleteMenu();

		const model = modelSelect.value;
		const mode = modeSelect.value;
		const extras = composer ? composer.extras() : { effort: undefined, context: [] };
		const effort = extras.effort;
		const context = resend ? (resend.context || []) : extras.context;

		addMessage('user', text, false);
		agentOfferText = mode === 'chat' ? text : '';
		todoCard = null;
		todoItems = [];
		subagentCards = {};

		if (mode === 'chat' || mode === 'ask' || mode === 'agent') {
			setReplyInFlight(true);
			addMessage('assistant', '', true);
			renderChatActivity([{ id: 'agent', label: 'Working...', done: false }], 'Working...');
		}

		switch (mode) {
			case 'chat':
				vscode.postMessage({ type: 'sendMessage', message: text, model: model, effort: effort, context: context });
				break;
			case 'ask':
				vscode.postMessage({ type: 'askWorkspace', message: text, model: model, effort: effort, context: context });
				break;
			case 'plan':
				vscode.postMessage({ type: 'generatePlan', request: text, model: model, effort: effort, context: context });
				break;
			case 'execute':
				vscode.postMessage({ type: 'executeRequest', request: text, model: model, effort: effort, context: context });
				break;
			case 'agent':
				vscode.postMessage({ type: 'runAgent', request: text, model: model, effort: effort, context: context });
				break;
			default:
				vscode.postMessage({ type: 'sendMessage', message: text, model: model, effort: effort, context: context });
		}

		input.value = '';
		if (composer && !resend) {
			composer.afterSend();
		}
		syncAtMentionChips();
		syncAtMentionHighlight();
		resizeComposer();
	}

	// Event listeners
	sendBtn.onclick = function () {
		if (replyInFlight) {
			handleStop();
			return;
		}
		handleSend();
	};

	window.NexoraComposer.init({
		input: input,
		post: function (msg) { vscode.postMessage(msg); },
		getMode: function () { return modeSelect.value; },
		setMode: function (mode) {
			modeSelect.value = mode;
			updateModeUI();
		},
		getModel: function () { return modelSelect.value; },
		setModel: function (id) {
			modelSelect.value = id;
			vscode.postMessage({ type: 'selectModel', modelId: id });
		},
		isBusy: function () { return replyInFlight; },
		isAtOpen: function () { return atCompleteOpen; },
		stop: handleStop,
		send: function () { handleSend(); },
		insertMention: function (relPath) {
			const sep = input.value && !/\s$/.test(input.value) ? ' ' : '';
			input.value += sep + quoteAtMentionPath(relPath) + ' ';
			syncAtMentionChips();
			syncAtMentionHighlight();
			resizeComposer();
			input.focus();
		}
	});
	wireMessagesScrollbarFlash();
	wireStickToBottom();
	wireAtContextComposer();
	input.addEventListener('keydown', function (e) {
		if (e.key !== 'Enter') {
			return;
		}
		if (atCompleteSuppressEnter || atCompleteOpen) {
			atCompleteSuppressEnter = false;
			return;
		}
		const send = submitWithCtrlEnter
			? (e.ctrlKey || e.metaKey)
			: (!e.shiftKey && !e.ctrlKey && !e.metaKey);
		if (!send) {
			return;
		}
		e.preventDefault();
		if (replyInFlight) {
			return;
		}
		handleSend();
	});
	if (newSessionBtn) {
		newSessionBtn.onclick = () => vscode.postMessage({ type: 'newSession' });
	}

	(function setupSessionRailResize() {
		const rail = document.getElementById('sessionRail');
		const handle = document.getElementById('railResize');
		const root = document.querySelector('.nx-root');
		if (!rail || !handle || !root) {
			return;
		}

		const RAIL_MIN = 140;
		const RAIL_MAX = 360;
		const RAIL_DEFAULT = 196;

		function railMaxWidth() {
			const half = Math.floor(root.getBoundingClientRect().width * 0.5);
			return Math.max(RAIL_MIN, Math.min(RAIL_MAX, half));
		}

		function clampRailWidth(value) {
			const n = Math.round(Number(value));
			if (!isFinite(n)) {
				return RAIL_DEFAULT;
			}
			const max = railMaxWidth();
			if (n < RAIL_MIN) {
				return RAIL_MIN;
			}
			if (n > max) {
				return max;
			}
			return n;
		}

		function persistWebviewRailWidth(width) {
			const prev = vscode.getState();
			const next = prev && typeof prev === 'object' ? Object.assign({}, prev) : {};
			next.sessionRailWidth = width;
			vscode.setState(next);
		}

		function applyRailWidth(value, persistHost) {
			const width = clampRailWidth(value);
			rail.style.setProperty('--nx-rail-width', width + 'px');
			persistWebviewRailWidth(width);
			if (persistHost) {
				vscode.postMessage({ type: 'persistSessionRailWidth', width: width });
			}
			return width;
		}

		let dragging = false;
		let dragPointerId = 0;
		let startX = 0;
		let startWidth = 0;

		handle.addEventListener('pointerdown', function (ev) {
			if (ev.button !== 0) {
				return;
			}
			dragging = true;
			dragPointerId = ev.pointerId;
			startX = ev.clientX;
			startWidth = rail.getBoundingClientRect().width;
			handle.setPointerCapture(ev.pointerId);
			root.classList.add('is-railResizing');
			ev.preventDefault();
		});

		handle.addEventListener('pointermove', function (ev) {
			if (!dragging || ev.pointerId !== dragPointerId) {
				return;
			}
			applyRailWidth(startWidth + (startX - ev.clientX), false);
		});

		function endRailDrag(ev) {
			if (!dragging) {
				return;
			}
			if (ev && ev.pointerId !== dragPointerId) {
				return;
			}
			dragging = false;
			root.classList.remove('is-railResizing');
			applyRailWidth(rail.getBoundingClientRect().width, true);
		}

		handle.addEventListener('pointerup', endRailDrag);
		handle.addEventListener('pointercancel', endRailDrag);

		const vsState = vscode.getState();
		const fromHost = initial.sessionRailWidth;
		const fromWeb = vsState && typeof vsState.sessionRailWidth === 'number' ? vsState.sessionRailWidth : undefined;
		const start = typeof fromHost === 'number' ? fromHost : (typeof fromWeb === 'number' ? fromWeb : RAIL_DEFAULT);
		applyRailWidth(start, false);
	})();

	window.addEventListener('click', (e) => {
		const node = e.target;
		if (!node || !node.closest) {
			return;
		}
		const anchor = node.closest('a[href]');
		if (!anchor) {
			return;
		}
		const href = anchor.getAttribute('href') || '';
		if (/^https?:\/\//i.test(href)) {
			e.preventDefault();
			vscode.postMessage({ type: 'openUrl', url: href });
		}
	}, true);

	// Rail nav rows and welcome cards: pages open through the host's fixed page map.
	document.querySelectorAll('[data-page]').forEach(btn => {
		btn.addEventListener('click', () => vscode.postMessage({ type: 'openPage', page: btn.getAttribute('data-page') }));
	});
	document.querySelectorAll('[data-action="indexWorkspace"]').forEach(btn => {
		btn.addEventListener('click', () => vscode.postMessage({ type: 'indexWorkspace' }));
	});

	if (railSearchBtn && railSearchRow && railSearch) {
		railSearchBtn.addEventListener('click', () => {
			railSearchRow.hidden = false;
			railSearch.focus();
			railSearch.select();
		});
		railSearch.addEventListener('input', () => {
			railQuery = railSearch.value;
			drawRail();
		});
		railSearch.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				closeRailSearch();
				railSearchBtn.focus();
			}
		});
	}

	// Click handlers for plan approval/cancel
	window.addEventListener('click', (e) => {
		const target = e.target;
		if (!target || !target.classList) {
			return;
		}

		if (target.classList.contains('nx-copyBtn')) {
			const id = target.getAttribute('data-copy-target');
			if (!id) {
				return;
			}
			const el = document.getElementById(id);
			if (!el) {
				return;
			}
			navigator.clipboard.writeText(el.textContent || '');
			const old = target.textContent;
			target.textContent = 'Copied';
			setTimeout(() => (target.textContent = old), 800);
		}

		if (target.closest && target.closest('.nx-openEngineOutput')) {
			vscode.postMessage({ type: 'showEngineOutput' });
		}

		if (target.classList.contains('nx-approveBtn')) {
			const planId = target.getAttribute('data-plan-id');
			if (planId) {
				vscode.postMessage({ type: 'approvePlan', planId: planId });
			}
		}

		if (target.classList.contains('nx-removeStepBtn')) {
			const planId = target.getAttribute('data-plan-id');
			const taskId = target.getAttribute('data-task-id');
			if (planId && taskId) {
				// the engine answers with the plan without this step, which redraws the card
				target.disabled = true;
				vscode.postMessage({ type: 'modifyPlan', planId: planId, modification: { remove_tasks: [taskId] } });
			}
		}

		if (target.classList.contains('nx-fixBtn')) {
			const fix = target.getAttribute('data-fix');
			if (fix) {
				vscode.postMessage({ type: 'runFix', fix: fix });
			}
		}

		if (target.classList.contains('nx-saveInputsBtn')) {
			const taskEl = target.closest('.nx-planTask');
			const planId = target.getAttribute('data-plan-id');
			const taskId = target.getAttribute('data-task-id');
			if (!taskEl || !planId || !taskId) {
				return;
			}
			const read = readStepInputs(taskEl);
			const errorEl = taskEl.querySelector('.nx-stepInputError');
			if (read.error) {
				if (errorEl) {
					errorEl.textContent = read.error;
					errorEl.hidden = false;
				}
				return;
			}
			if (errorEl) {
				errorEl.hidden = true;
			}
			// the engine answers with the whole plan, which redraws this card
			target.disabled = true;
			target.textContent = 'Saving...';
			vscode.postMessage({ type: 'updateStepInputs', planId: planId, taskId: taskId, inputs: read.inputs });
		}

		if (target.id === 'saveTplConfirm') {
			const planId = target.getAttribute('data-plan-id');
			const card = document.getElementById('save-template-' + planId);
			if (!card || !planId) {
				return;
			}
			const name = (card.querySelector('#saveTplName') || {}).value || 'Saved workflow';
			const description = (card.querySelector('#saveTplDesc') || {}).value || '';
			const category = (card.querySelector('#saveTplCat') || {}).value || 'custom';
			const parameters = [];
			card.querySelectorAll('.nx-saveParam').forEach(row => {
				const include = row.querySelector('[data-include]');
				if (include && !include.checked) {
					return;
				}
				parameters.push({
					name: (row.querySelector('[data-name]') || {}).value || '',
					source_value: (row.querySelector('[data-value]') || {}).value || '',
					type: 'string',
					required: true
				});
			});
			vscode.postMessage({
				type: 'confirmSaveTemplate',
				planId: planId,
				name: name,
				description: description,
				category: category,
				parameters: parameters
			});
			card.remove();
			saveTemplateCard = null;
			return;
		}

		if (target.id === 'saveTplCancel') {
			if (saveTemplateCard) {
				saveTemplateCard.remove();
				saveTemplateCard = null;
			}
			vscode.postMessage({ type: 'cancelSaveTemplate' });
			return;
		}

		if (target.classList.contains('nx-cancelBtn')) {
			const planId = target.getAttribute('data-plan-id');
			if (planId) {
				vscode.postMessage({ type: 'cancelPlan', planId: planId });
				const card = document.getElementById('plan-card-' + planId);
				if (card) {
					card.remove();
				}
				addMessage('assistant', 'Plan cancelled.', false);
				currentPlan = null;
				planCardElement = null;
			}
		}
	});

	if (suggestRun) {
		suggestRun.addEventListener('click', () => {
			if (!currentSuggestionId) {
				return;
			}
			vscode.postMessage({ type: 'acceptSuggestion', id: currentSuggestionId });
			hideSuggestion();
		});
	}
	if (suggestLater) {
		suggestLater.addEventListener('click', () => {
			if (!currentSuggestionId) {
				return;
			}
			vscode.postMessage({ type: 'dismissSuggestion', id: currentSuggestionId, permanent: false });
			hideSuggestion();
		});
	}
	if (suggestNever) {
		suggestNever.addEventListener('click', () => {
			if (!currentSuggestionId) {
				return;
			}
			vscode.postMessage({ type: 'dismissSuggestion', id: currentSuggestionId, permanent: true });
			hideSuggestion();
		});
	}

	function setFirstRunMsg(text, cls) {
		if (!firstRunMsg) {
			return;
		}
		firstRunMsg.className = 'nx-firstRunMsg' + (cls ? ' ' + cls : '');
		firstRunMsg.textContent = text || '';
	}

	function showFirstRunCard(show) {
		if (!firstRunCard) {
			return;
		}
		if (show) {
			firstRunCard.hidden = false;
		} else {
			firstRunCard.hidden = true;
			setFirstRunMsg('', '');
		}
	}

	if (firstRunSave) {
		firstRunSave.addEventListener('click', () => {
			const provider = firstRunProvider ? firstRunProvider.value : 'openrouter';
			const key = firstRunKey ? firstRunKey.value.trim() : '';
			if (!key) {
				setFirstRunMsg('Paste a key to save', 'err');
				return;
			}
			setFirstRunMsg('Saving...', '');
			vscode.postMessage({ type: 'saveFirstRunKey', provider: provider, key: key });
		});
	}
	if (firstRunCloud) {
		firstRunCloud.addEventListener('click', () => {
			// The card hides by itself once the browser sign-in returns to Nexora.
			setFirstRunMsg('Finish signing in in your browser, then come back here.', '');
			vscode.postMessage({ type: 'cloudSignIn' });
		});
	}
	if (firstRunSettings) {
		firstRunSettings.addEventListener('click', () => {
			vscode.postMessage({ type: 'openSettings' });
		});
	}
	if (firstRunDismiss) {
		firstRunDismiss.addEventListener('click', () => {
			showFirstRunCard(false);
			vscode.postMessage({ type: 'dismissFirstRunCard' });
		});
	}

	// Message handler from extension
	window.addEventListener('message', (e) => {
		if (!e || !e.data) {
			return;
		}
		const data = e.data;

		switch (data.type) {
			case 'addMessage':
				addMessage(data.role, data.content, data.isLoading, data.stopped);
				break;

			case 'appendToken':
				appendToken(data.content);
				break;

			case 'finishMessage':
				finishMessage();
				break;

			case 'todoUpdate':
				renderTodos(data.todos);
				break;

			case 'subagentUpdate':
				renderSubagent(data);
				break;

			case 'generationRunning':
				setReplyInFlight(!!data.running);
				break;

			case 'chatActivity':
				renderChatActivity(data.items, data.caption);
				break;

			case 'chatActivityFold':
				foldLiveActivity(data.items);
				break;

			case 'chatActivityClear':
				foldLiveActivity(lastActivityItems);
				break;

			case 'backendStatus':
				updateStatus(data.connected);
				break;

			case 'planSnapshot':
				applyPlanSnapshot(data.plan);
				break;

			case 'authStatus':
				if (data.backendOffline === true) {
					// Unknown, not zero: hide the count until the engine answers.
					updateAuthStatus();
					updateStatus(false);
				} else {
					updateAuthStatus(data.github, data.vercel, data.supabase, data.stripe, data.v0, data.elevenlabs, data.tavily);
				}
				break;

			case 'showPlanApproval':
				createPlanApprovalCard(data.plan);
				break;

			case 'updateSessions':
				renderSessions(data.sessions, data.activeSessionId);
				break;

			case 'sessionRail':
				setRailHidden(data.hidden);
				break;

			case 'loadSession':
				loadSessionMessages(data.sessionId, data.messages);
				break;

			case 'resend':
				// After a rewind: send again in the message's own mode, as if typed now.
				if (data.mode && ['chat', 'ask', 'agent', 'plan', 'execute'].indexOf(data.mode) >= 0) {
					modeSelect.value = data.mode;
					updateModeUI();
				}
				input.value = data.text || '';
				handleSend({ context: Array.isArray(data.context) ? data.context : [] });
				break;

			case 'taskUpdate':
				updateTaskStatus(data.taskId, data.status, data.error, data.cost);
				break;

			case 'taskRetry':
				showTaskRetry(data.taskId, data.taskName, data.attempt, data.maxAttempts, data.platform);
				break;

			case 'userEscalation':
				showUserEscalation(data);
				break;

			case 'planExecutionStarted':
				showPlanExecuting(data.planId);
				break;

			case 'planApproveFailed':
				showPlanApproveFailed(data.planId, data.message);
				break;

			case 'planExecutionComplete':
				showPlanComplete(data.planId, data.status, data.tasks, data.actualCost, data.artifacts);
				break;

			case 'planCompleted':
				showPlanComplete(data.planId, data.status, null, data.actualCost);
				break;

			case 'showSaveTemplate':
				showSaveTemplateForm(data.planId, data.parameters);
				break;

			case 'showSuggestion':
				showSuggestion(data.suggestion);
				break;

			case 'firstRunKeyCard':
				showFirstRunCard(!!data.show);
				break;

			case 'firstRunKeyResult':
				setFirstRunMsg(data.success ? 'Key saved.' : (data.error || 'Save failed'), data.success ? 'ok' : 'err');
				if (data.success && firstRunKey) {
					firstRunKey.value = '';
				}
				break;

			case 'atCompleteResults':
				renderAtCompleteResults(data.items);
				break;

			case 'costUpdate':
				updateCostTicker(data.cost_usd, data.tokens_in, data.tokens_out, data.tokens_cached);
				break;

			case 'checkpointStarted':
				tagLatestUserMessage(data.id);
				break;

			case 'checkpoints':
				showRestoreButtons(data.restorable || []);
				break;

			case 'memoryNote':
				addMemoryNote(data.value);
				break;

			case 'composerSettings':
				submitWithCtrlEnter = !!data.submitWithCtrlEnter;
				applySendButtonChrome();
				break;

			case 'modelPickerState':
				modelSelect.value = data.selectedModelId || modelSelect.value || 'auto';
				window.NexoraComposer.setCatalog(data.catalog, data.enabledModelIds);
				break;

			case 'modelSelected':
				if (modelSelect && data.modelId) {
					modelSelect.value = data.modelId;
					window.NexoraComposer.render();
				}
				break;

			case 'prefillInput':
				if (data.mode && modeSelect.value !== data.mode) {
					modeSelect.value = data.mode;
					updateModeUI();
				}
				input.value = String(data.text || '');
				input.focus();
				input.setSelectionRange(input.value.length, input.value.length);
				input.dispatchEvent(new Event('input', { bubbles: true }));
				break;

			case 'customCommands':
				window.NexoraComposer.setCustomCommands(data.commands);
				break;

			case 'composerState':
				window.NexoraComposer.setComposerState({ runMode: data.runMode, effort: data.effort, hasSelection: data.hasSelection });
				break;

			case 'contextTags':
				window.NexoraComposer.addTags(data.tags);
				break;

			case 'openModelMenu':
				window.NexoraComposer.openModelMenu();
				break;
		}
	});

	// Initialize
	if (modelSelect && initial.selectedModelId) {
		modelSelect.value = initial.selectedModelId;
	}
	updateModeUI();
	updateStatus(!!initial.connected);
	updateAuthStatus(!!initial.auth.github, !!initial.auth.vercel, !!initial.auth.supabase, !!initial.auth.stripe, !!initial.auth.v0, !!initial.auth.elevenlabs, !!initial.auth.tavily);

	setRailHidden(initial.sessionRailHidden);
	// Ages and date groups move with the clock, not only when the list changes.
	setInterval(function () {
		if (!renamingSessionId) {
			drawRail();
		}
	}, 60000);
	if (initial.sessions && initial.activeSessionId) {
		renderSessions(initial.sessions, initial.activeSessionId);
		loadSessionMessages(initial.activeSessionId, initial.messages || []);
	}


	function syncComposerCompact() {
		const card = document.getElementById('composerCard');
		if (!card) {
			return;
		}
		const narrow = card.clientWidth > 0 && card.clientWidth < 280;
		card.classList.toggle('nx-composerCompact', narrow);
	}


	const composerCardEl = document.getElementById('composerCard');
	if (composerCardEl && typeof ResizeObserver !== 'undefined') {
		const ro = new ResizeObserver(function () {
			syncComposerCompact();
		});
		ro.observe(composerCardEl);
	}
	window.addEventListener('resize', syncComposerCompact);
	syncComposerCompact();

	vscode.postMessage({ type: 'checkBackend' });
	vscode.postMessage({ type: 'checkAuthStatus' });
	vscode.postMessage({ type: 'chatWebviewReady' });
	resizeComposer();
}());
