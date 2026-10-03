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
	const modeDdRoot = document.getElementById('modeDd');
	const modelDdRoot = document.getElementById('modelDd');
	const modeHint = document.getElementById('modeHint');
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
	const firstRunCard = document.getElementById('firstRunCard');
	const firstRunProvider = document.getElementById('firstRunProvider');
	const firstRunKey = document.getElementById('firstRunKey');
	const firstRunSave = document.getElementById('firstRunSave');
	const firstRunSettings = document.getElementById('firstRunSettings');
	const firstRunDismiss = document.getElementById('firstRunDismiss');
	const firstRunMsg = document.getElementById('firstRunMsg');

	let lastLoadingMessage = null;
	let chatActivityCard = null;
	let lastActivityItems = [];
	let lastActivityCaption = '';
	let activityLogExpanded = {};
	let costTickerEl = null;
	let totalCostUsd = 0;
	let totalTokensIn = 0;
	let totalTokensOut = 0;
	let currentPlan = null;
	let planCardElement = null;
	const shownEscalationKeys = {};
	let currentSuggestionId = null;
	let saveTemplateCard = null;
	let currentMode = 'chat';
	let activeSessionId = null;
	let openDdRoot = null;
	let ddKbIndex = 0;
	let ddGlobalsBound = false;
	let messagesScrollBarTimer = null;
	let replyInFlight = false;
	let atCompleteTimer = null;
	let atCompleteItems = [];
	let atCompleteIndex = 0;
	let atCompleteOpen = false;
	let atCompletePrefixStart = -1;
	let atCompleteSuppressEnter = false;
	let submitWithCtrlEnter = !!initial.submitWithCtrlEnter;

	const modelDdList = document.getElementById('modelDdList');
	const modelDdSearch = document.getElementById('modelDdSearch');
	const modelDdSearchWrap = document.getElementById('modelDdSearchWrap');

	let modelCatalog = null;
	let enabledModelIds = [];
	const selectedModelLabelCache = {};

	const modeHints = {
		'chat': 'Chat mode: Have a conversation, ask questions, get explanations',
		'ask': 'Ask mode: Answer using indexed workspace memory (.mv2). Index the workspace first if needed.',
		'plan': 'Plan mode: Generate an execution plan with cost estimation before executing',
		'execute': 'Execute mode: Directly execute tasks with real-time progress',
		'agent': 'Agent mode: Autonomous AI agent that plans and executes multi-step tasks'
	};

	const buttonLabels = {
		'chat': 'Send',
		'ask': 'Ask',
		'plan': 'Generate Plan',
		'execute': 'Execute',
		'agent': 'Run Agent'
	};

	const PROVIDER_TITLE_CASE = {
		openai: 'OpenAI',
		openrouter: 'OpenRouter',
		anthropic: 'Anthropic',
		gemini: 'Gemini'
	};

	let ddCloseTimer = null;

	function getDdMenu(root) {
		if (!root) {
			return null;
		}
		const trigger = root.querySelector('.nx-ddTrigger');
		const id = trigger && trigger.getAttribute('aria-controls');
		if (id) {
			const byId = document.getElementById(id);
			if (byId) {
				return byId;
			}
		}
		return root.querySelector('.nx-ddMenu');
	}

	function getDdOptions(menu) {
		return Array.prototype.slice.call(menu.querySelectorAll('[role="option"]'));
	}

	function findDdOptionByValue(menu, val) {
		const items = getDdOptions(menu);
		for (let i = 0; i < items.length; i++) {
			if (items[i].getAttribute('data-value') === val) {
				return items[i];
			}
		}
		return null;
	}

	function optionDisplayLabel(opt) {
		if (!opt) {
			return '';
		}
		const fromAttr = opt.getAttribute('data-label');
		if (fromAttr) {
			return fromAttr;
		}
		const labelEl = opt.querySelector('.nx-ddItemLabel');
		if (labelEl) {
			return (labelEl.textContent || '').trim();
		}
		return (opt.textContent || '').trim();
	}

	function prettifyModelId(id) {
		let s = String(id || '').trim();
		if (!s) {
			return '';
		}
		s = s.replace(/:(free|paid)$/i, '');
		const slash = s.lastIndexOf('/');
		if (slash >= 0) {
			s = s.slice(slash + 1);
		}
		s = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
		return s.split(' ').map(function (word) {
			if (!word) {
				return word;
			}
			if (/^gpt\d/i.test(word) || /^gpt$/i.test(word)) {
				return word.replace(/^gpt/i, 'GPT');
			}
			if (/^o\d/i.test(word)) {
				return word;
			}
			return word.charAt(0).toUpperCase() + word.slice(1);
		}).join(' ');
	}

	function resolveModelLabel(model) {
		const id = model && model.id ? String(model.id) : '';
		const label = model && model.label ? String(model.label).trim() : '';
		if (label && label !== id) {
			return label;
		}
		if (label && label.indexOf('/') === -1 && label.indexOf(':') === -1) {
			return label;
		}
		return prettifyModelId(id || label) || label || id;
	}

	function humanProviderLabel(provider) {
		if (!provider) {
			return '';
		}
		const id = String(provider.id || '').toLowerCase();
		if (PROVIDER_TITLE_CASE[id]) {
			return PROVIDER_TITLE_CASE[id];
		}
		const raw = String(provider.label || provider.id || '').trim();
		if (!raw) {
			return '';
		}
		if (raw === raw.toUpperCase() && raw.length > 1) {
			return raw.charAt(0) + raw.slice(1).toLowerCase();
		}
		return raw;
	}

	function ddItemHtml(value, label, opts) {
		opts = opts || {};
		const tierHtml = opts.tier === 'free'
			? '<span class="nx-ddItemTier">Free</span>'
			: '';
		return '<button type="button" class="nx-ddItem" role="option" data-value="'
			+ escapeHtml(value) + '" data-label="' + escapeHtml(label) + '">'
			+ '<span class="nx-ddItemCheck" aria-hidden="true"></span>'
			+ '<span class="nx-ddItemLabel">' + escapeHtml(label) + '</span>'
			+ tierHtml
			+ '</button>';
	}

	function portalDdMenu(menu) {
		if (!menu || menu.parentElement === document.body) {
			return;
		}
		menu._nxDdHome = {
			parent: menu.parentElement,
			next: menu.nextSibling
		};
		document.body.appendChild(menu);
	}

	function restoreDdMenu(menu) {
		if (!menu || !menu._nxDdHome || !menu._nxDdHome.parent) {
			return;
		}
		const home = menu._nxDdHome;
		if (home.next && home.next.parentNode === home.parent) {
			home.parent.insertBefore(menu, home.next);
		} else {
			home.parent.appendChild(menu);
		}
		menu._nxDdHome = null;
	}

	function syncOneDd(root) {
		const hidden = root.querySelector('input[type="hidden"]');
		const textEl = root.querySelector('.nx-ddTriggerText');
		const menu = getDdMenu(root);
		if (!hidden || !textEl || !menu) {
			return;
		}
		const val = hidden.value;
		const opt = findDdOptionByValue(menu, val);
		if (opt) {
			const label = optionDisplayLabel(opt);
			textEl.textContent = label;
			if (val) {
				selectedModelLabelCache[val] = label;
			}
		} else if (root.getAttribute('data-dd-kind') === 'model') {
			textEl.textContent = selectedModelLabelCache[val] || (val === 'auto' ? 'Auto' : prettifyModelId(val) || val);
		}
		getDdOptions(menu).forEach(function (o) {
			const on = o.getAttribute('data-value') === val;
			o.classList.toggle('nx-ddItemSelected', on);
			o.setAttribute('aria-selected', on ? 'true' : 'false');
		});
	}

	function positionDdMenu(root) {
		const trigger = root.querySelector('.nx-ddTrigger');
		const menu = getDdMenu(root);
		if (!trigger || !menu) {
			return;
		}
		const rect = trigger.getBoundingClientRect();
		const gap = 6;
		const isModel = root.getAttribute('data-dd-kind') === 'model';
		const cap = isModel ? 320 : 240;
		const minW = Math.max(rect.width, isModel ? 240 : 148);
		let left = rect.left;
		if (left + minW > window.innerWidth - 6) {
			left = window.innerWidth - 6 - minW;
		}
		const spaceAbove = Math.max(48, Math.floor(rect.top - gap - 4));
		const maxH = Math.min(cap, spaceAbove);

		menu.style.left = Math.max(4, left) + 'px';
		menu.style.right = 'auto';
		menu.style.minWidth = minW + 'px';
		menu.style.maxWidth = Math.min(360, window.innerWidth - 8) + 'px';
		menu.style.maxHeight = maxH + 'px';
		menu.style.top = 'auto';
		menu.style.bottom = Math.max(gap, Math.round(window.innerHeight - rect.top + gap)) + 'px';
	}

	function setDdKeyboardHighlight(menu, index) {
		const items = getDdOptions(menu).filter(function (el) {
			return !el.hidden && el.style.display !== 'none';
		});
		const all = getDdOptions(menu);
		all.forEach(function (el) {
			el.classList.remove('nx-ddItemKeyboard');
		});
		if (items[index]) {
			items[index].classList.add('nx-ddItemKeyboard');
		}
		ddKbIndex = index;
	}

	function clearDdMenuInline(menu) {
		menu.style.top = '';
		menu.style.bottom = '';
		menu.style.left = '';
		menu.style.right = '';
		menu.style.minWidth = '';
		menu.style.maxWidth = '';
		menu.style.maxHeight = '';
	}

	function closeDd(root, immediate) {
		if (!root) {
			return;
		}
		if (ddCloseTimer) {
			window.clearTimeout(ddCloseTimer);
			ddCloseTimer = null;
		}
		const trigger = root.querySelector('.nx-ddTrigger');
		const menu = getDdMenu(root);
		if (trigger) {
			trigger.setAttribute('aria-expanded', 'false');
		}
		root.classList.remove('nx-ddOpen');
		if (openDdRoot === root) {
			openDdRoot = null;
		}
		if (!menu) {
			return;
		}
		menu.classList.remove('nx-ddMenuOpen');
		getDdOptions(menu).forEach(function (o) {
			o.classList.remove('nx-ddItemKeyboard');
		});

		function finishClose() {
			ddCloseTimer = null;
			menu.hidden = true;
			clearDdMenuInline(menu);
			restoreDdMenu(menu);
		}

		if (immediate) {
			finishClose();
		} else {
			ddCloseTimer = window.setTimeout(finishClose, 130);
		}
	}

	function openDd(root) {
		if (ddCloseTimer) {
			window.clearTimeout(ddCloseTimer);
			ddCloseTimer = null;
		}
		if (openDdRoot && openDdRoot !== root) {
			closeDd(openDdRoot, true);
		}
		const trigger = root.querySelector('.nx-ddTrigger');
		const menu = getDdMenu(root);
		const hidden = root.querySelector('input[type="hidden"]');
		if (!trigger || !menu || !hidden) {
			return;
		}
		if (root.getAttribute('data-dd-kind') === 'model') {
			vscode.postMessage({ type: 'requestModelPicker' });
			if (modelDdSearch) {
				modelDdSearch.value = '';
				filterModelMenu('');
			}
		}
		portalDdMenu(menu);
		openDdRoot = root;
		root.classList.add('nx-ddOpen');
		trigger.setAttribute('aria-expanded', 'true');
		menu.hidden = false;
		menu.classList.remove('nx-ddMenuOpen');
		const visible = getDdOptions(menu).filter(function (el) {
			return !el.hidden && el.style.display !== 'none';
		});
		const focusItems = visible.length ? visible : getDdOptions(menu);
		const idx = Math.max(0, focusItems.findIndex(function (i) {
			return i.getAttribute('data-value') === hidden.value;
		}));
		setDdKeyboardHighlight(menu, idx);
		positionDdMenu(root);
		requestAnimationFrame(function () {
			if (openDdRoot !== root) {
				return;
			}
			positionDdMenu(root);
			menu.classList.add('nx-ddMenuOpen');
		});
		try {
			if (root.getAttribute('data-dd-kind') === 'model' && modelDdSearch && modelDdSearchWrap && !modelDdSearchWrap.hidden) {
				modelDdSearch.focus({ preventScroll: true });
			} else {
				menu.focus({ preventScroll: true });
			}
		} catch (_e) {
			menu.focus();
		}
	}

	function applyDdSelection(root, value) {
		const hidden = root.querySelector('input[type="hidden"]');
		if (!hidden) {
			return;
		}
		hidden.value = value;
		syncOneDd(root);
		closeDd(root);
		if (root.getAttribute('data-dd-kind') === 'mode') {
			updateModeUI();
		} else if (root.getAttribute('data-dd-kind') === 'model') {
			vscode.postMessage({ type: 'selectModel', modelId: value });
		}
	}

	function wireDd(root) {
		if (!root || root.dataset.nxDdWired) {
			return;
		}
		root.dataset.nxDdWired = '1';
		const trigger = root.querySelector('.nx-ddTrigger');
		const menu = getDdMenu(root);
		if (!trigger || !menu) {
			return;
		}
		menu.setAttribute('tabindex', '-1');

		trigger.addEventListener('click', function () {
			if (root.classList.contains('nx-ddOpen')) {
				closeDd(root);
			} else {
				openDd(root);
			}
		});

		trigger.addEventListener('keydown', function (e) {
			if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !root.classList.contains('nx-ddOpen')) {
				e.preventDefault();
				openDd(root);
			}
		});

		menu.addEventListener('click', function (e) {
			const opt = e.target.closest('[role="option"]');
			if (!opt || !menu.contains(opt)) {
				return;
			}
			applyDdSelection(root, opt.getAttribute('data-value'));
			trigger.focus();
		});

		menu.addEventListener('keydown', function (e) {
			const items = getDdOptions(menu).filter(function (el) {
				return !el.hidden && el.style.display !== 'none';
			});
			if (!items.length) {
				return;
			}
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				const next = Math.min(items.length - 1, ddKbIndex + 1);
				setDdKeyboardHighlight(menu, next);
				items[next].scrollIntoView({ block: 'nearest' });
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				const prev = Math.max(0, ddKbIndex - 1);
				setDdKeyboardHighlight(menu, prev);
				items[prev].scrollIntoView({ block: 'nearest' });
			} else if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				const pick = items[ddKbIndex];
				if (pick) {
					applyDdSelection(root, pick.getAttribute('data-value'));
					trigger.focus();
				}
			} else if (e.key === 'Escape') {
				e.preventDefault();
				closeDd(root);
				trigger.focus();
			}
		});
	}

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

	function filterModelMenu(query) {
		if (!modelDdList) {
			return;
		}
		const q = String(query || '').trim().toLowerCase();
		const sections = modelDdList.querySelectorAll('.nx-ddSection');
		const options = modelDdList.querySelectorAll('[role="option"]');
		options.forEach(function (opt) {
			const label = (opt.getAttribute('data-label') || optionDisplayLabel(opt) || '').toLowerCase();
			const id = (opt.getAttribute('data-value') || '').toLowerCase();
			const match = !q || label.indexOf(q) !== -1 || id.indexOf(q) !== -1;
			opt.hidden = !match;
			opt.style.display = match ? '' : 'none';
		});
		sections.forEach(function (section) {
			let el = section.nextElementSibling;
			let any = false;
			while (el && !el.classList.contains('nx-ddSection')) {
				if (el.getAttribute('role') === 'option' && !el.hidden) {
					any = true;
					break;
				}
				el = el.nextElementSibling;
			}
			section.hidden = q ? !any : false;
			section.style.display = section.hidden ? 'none' : '';
		});
		if (modelDdRoot && modelDdRoot.classList.contains('nx-ddOpen')) {
			positionDdMenu(modelDdRoot);
		}
	}

	function wireModelSearch() {
		if (!modelDdSearch || modelDdSearch.dataset.nxWired) {
			return;
		}
		modelDdSearch.dataset.nxWired = '1';
		modelDdSearch.addEventListener('input', function () {
			filterModelMenu(modelDdSearch.value);
		});
		modelDdSearch.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowDown' || e.key === 'Enter') {
				e.preventDefault();
				const menu = modelDdRoot && getDdMenu(modelDdRoot);
				if (!menu) {
					return;
				}
				const items = getDdOptions(menu).filter(function (el) {
					return !el.hidden;
				});
				if (!items.length) {
					return;
				}
				setDdKeyboardHighlight(menu, 0);
				try {
					items[0].focus();
				} catch (_e) { /* ignore */ }
			} else if (e.key === 'Escape') {
				e.preventDefault();
				closeDd(modelDdRoot);
			}
		});
		modelDdSearch.addEventListener('click', function (e) {
			e.stopPropagation();
		});
	}

	function renderModelPicker(catalog, enabledIds, selectedId) {
		modelCatalog = catalog || null;
		enabledModelIds = Array.isArray(enabledIds) ? enabledIds : [];
		const enabled = new Set(enabledModelIds);
		const list = modelDdList || document.getElementById('modelDdList');
		if (!list) {
			return;
		}

		const autoLabel = (catalog && catalog.auto && catalog.auto.label) || 'Auto';
		selectedModelLabelCache.auto = autoLabel;

		let html = ddItemHtml('auto', autoLabel);

		const providers = (catalog && Array.isArray(catalog.providers)) ? catalog.providers : [];
		let optionCount = 1;
		providers.forEach(function (provider) {
			if (!provider || !provider.configured) {
				return;
			}
			const models = Array.isArray(provider.models) ? provider.models : [];
			const visible = models.filter(function (m) {
				return m && enabled.has(m.id);
			});
			if (!visible.length) {
				return;
			}
			html += '<div class="nx-ddSection" role="presentation">'
				+ escapeHtml(humanProviderLabel(provider)) + '</div>';
			visible.forEach(function (model) {
				const label = resolveModelLabel(model);
				selectedModelLabelCache[model.id] = label;
				html += ddItemHtml(model.id, label, { tier: model.tier });
				optionCount += 1;
			});
		});

		list.innerHTML = html;

		if (modelDdSearchWrap) {
			modelDdSearchWrap.hidden = optionCount < 8;
		}

		if (modelSelect) {
			const nextId = selectedId || modelSelect.value || 'auto';
			modelSelect.value = nextId;
		}
		if (modelDdRoot) {
			syncOneDd(modelDdRoot);
			if (modelDdRoot.classList.contains('nx-ddOpen')) {
				positionDdMenu(modelDdRoot);
			}
		}
		if (modelDdSearch && modelDdSearch.value) {
			filterModelMenu(modelDdSearch.value);
		}
	}

	function wireComposerDropdowns() {
		if (modeDdRoot) {
			wireDd(modeDdRoot);
		}
		if (modelDdRoot) {
			wireDd(modelDdRoot);
		}
		wireModelSearch();
		if (ddGlobalsBound) {
			return;
		}
		ddGlobalsBound = true;
		document.addEventListener('mousedown', function (e) {
			if (!openDdRoot || !e.target || !e.target.closest) {
				return;
			}
			if (openDdRoot.contains(e.target)) {
				return;
			}
			const menu = getDdMenu(openDdRoot);
			if (menu && menu.contains(e.target)) {
				return;
			}
			closeDd(openDdRoot);
		}, true);
		document.addEventListener('keydown', function (e) {
			if (e.key !== 'Escape' || !openDdRoot) {
				return;
			}
			const tr = openDdRoot.querySelector('.nx-ddTrigger');
			closeDd(openDdRoot);
			if (tr) {
				tr.focus();
			}
		});
		window.addEventListener('resize', function () {
			if (openDdRoot) {
				positionDdMenu(openDdRoot);
			}
		});
		window.addEventListener('scroll', function () {
			if (openDdRoot) {
				positionDdMenu(openDdRoot);
			}
		}, true);
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

	function updateAuthStatus() {
		// Connector status lives in Settings, not the chat header.
	}

	function updateModeUI() {
		if (!modeSelect) {
			return;
		}
		if (modeDdRoot) {
			syncOneDd(modeDdRoot);
		}
		if (modelDdRoot) {
			syncOneDd(modelDdRoot);
		}
		currentMode = modeSelect.value;
		applySendButtonChrome();
		
		if (modeHint) {
			modeHint.setAttribute('data-mode', currentMode);
		}
		
		const hintEl = modeHint ? modeHint.querySelector('.nx-hintText') : null;
		if (hintEl) {
			hintEl.textContent = modeHints[currentMode] || '';
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
		replyInFlight = !!running;
		applySendButtonChrome();
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
		const title = lang || 'Code';
		return (
			'<div class="nx-codeHeader">' +
			'<span class="nx-codeTitle">' + title + '</span>' +
			'<button class="nx-copyBtn" data-copy-target="' + copyId + '">Copy</button>' +
			'</div>' +
			'<pre class="nx-codeBlock" id="' + copyId + '">' +
			code +
			'</pre>'
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

	function applyMarkdownLists(html) {
		html = html.replace(/(^|\n)((?:[*+-] .+(?:\n|$))+)/g, function (_match, lead, block) {
			const items = block.replace(/\n$/, '').split('\n').map(function (line) {
				return '<li>' + line.replace(/^[*+-] /, '') + '</li>';
			}).join('');
			return lead + '<ul>' + items + '</ul>';
		});
		html = html.replace(/(^|\n)((?:\d+\. .+(?:\n|$))+)/g, function (_match, lead, block) {
			const items = block.replace(/\n$/, '').split('\n').map(function (line) {
				return '<li>' + line.replace(/^\d+\. /, '') + '</li>';
			}).join('');
			return lead + '<ol>' + items + '</ol>';
		});
		return html;
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

	function formatContent(content) {
		const blocks = [];
		let html = escapeHtml(String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
		html = extractMarkdownFences(html, blocks);

		html = html.replace(/^#{1,6}\s+(.+)$/gm, '<strong class="nx-mdH">$1</strong>');
		html = html.replace(/^#{1,6}\s*/gm, '');
		html = applyMarkdownLists(html);
		html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_match, text, url) {
			const href = safeMarkdownHref(url);
			const label = applyMarkdownInline(text);
			return stashMarkdownBlock(blocks, href ? '<a href="' + href + '">' + label + '</a>' : label);
		});
		html = applyMarkdownInline(html);
		html = html.replace(/\n/g, '<br/>');

		for (let i = 0; i < blocks.length; i++) {
			html = html.split('%%NXCB' + i + '%%').join(blocks[i]);
		}
		return html;
	}

	function clearChatActivityCard() {
		if (chatActivityCard && chatActivityCard.parentNode) {
			chatActivityCard.remove();
		}
		chatActivityCard = null;
		lastActivityItems = [];
		lastActivityCaption = '';
		activityLogExpanded = {};
		if (costTickerEl && costTickerEl.parentNode) {
			costTickerEl.remove();
		}
		costTickerEl = null;
		totalCostUsd = 0;
		totalTokensIn = 0;
		totalTokensOut = 0;
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

	function foldLiveActivity(items) {
		const list = (Array.isArray(items) && items.length) ? items : lastActivityItems;
		const userEl = lastUserMessageEl();
		if (userEl && list && list.length) {
			attachActivityFold(userEl, list);
		}
		clearChatActivityCard();
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

	function updateLoadingCaption(caption) {
		if (!caption || !lastLoadingMessage) {
			return;
		}
		const body = lastLoadingMessage.querySelector('.nx-msgBody');
		if (!body || body.getAttribute('data-nx-streaming') === '1') {
			return;
		}
		body.textContent = caption;
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

		const mark = document.createElement('span');
		mark.className = 'nx-activityMark';
		if (isLive && (status === 'running' || status === 'confirming')) {
			const spinner = document.createElement('span');
			spinner.className = 'nx-activitySpinner';
			spinner.setAttribute('aria-hidden', 'true');
			mark.appendChild(spinner);
		} else if (status === 'failed' || status === 'timeout') {
			mark.textContent = 'x';
		} else if (status === 'cancelled') {
			mark.textContent = '-';
		} else {
			mark.textContent = '+';
		}

		const glyph = document.createElement('span');
		glyph.className = 'nx-activityTermGlyph';
		glyph.textContent = '$';

		const body = document.createElement('div');
		body.className = 'nx-activityTermBody';

		const head = document.createElement('div');
		head.className = 'nx-activityTermHead';
		const cmd = document.createElement('span');
		cmd.className = 'nx-activityTermCmd';
		cmd.textContent = it.label || ('$ ' + (it.command || ''));
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

	function fillActivityBody(bodyEl, list, live) {
		const isLive = live !== false;
		bodyEl.innerHTML = '';
		list.forEach(function (it) {
			if (it.kind === 'terminal') {
				bodyEl.appendChild(renderTerminalActivityRow(it, isLive));
				return;
			}
			const row = document.createElement('div');
			row.className = 'nx-activityRow' + (it.done ? ' nx-activityRowDone' : '');
			row.setAttribute('data-activity-id', it.id);
			const mark = document.createElement('span');
			mark.className = 'nx-activityMark';
			if (it.done || !isLive) {
				mark.textContent = '+';
			} else {
				const spinner = document.createElement('span');
				spinner.className = 'nx-activitySpinner';
				spinner.setAttribute('aria-hidden', 'true');
				mark.appendChild(spinner);
			}
			const fileIcon = _makeActivityFileIcon(it.label || '');
			const lab = document.createElement('span');
			lab.className = 'nx-activityLabel';
			lab.textContent = it.label || '';
			row.appendChild(mark);
			if (fileIcon) {
				row.appendChild(fileIcon);
			}
			row.appendChild(lab);
			bodyEl.appendChild(row);
		});
	}

	function renderChatActivity(items, caption) {
		if (!messages) {
			return;
		}
		const list = Array.isArray(items) ? items : [];
		lastActivityItems = list;
		if (caption) {
			lastActivityCaption = caption;
			updateLoadingCaption(caption);
		}
		if (!chatActivityCard) {
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
				const c = headerBtn.querySelector('.nx-activityChevron');
				if (c) {
					c.textContent = collapsed ? '>' : 'v';
				}
			});
			chatActivityCard = card;
		}
		const turnCounterEl = chatActivityCard.querySelector('.nx-activityTurnCounter');
		if (turnCounterEl) {
			const agentIt = list.find(function (it) { return it.id === 'agent' && it.turn !== null && it.turn !== undefined; });
			if (agentIt && agentIt.totalTurns) {
				turnCounterEl.textContent = 'Turn ' + agentIt.turn + '/' + agentIt.totalTurns;
			} else {
				turnCounterEl.textContent = '';
			}
		}
		const bodyEl = chatActivityCard.querySelector('.nx-activityCardBody');
		if (!bodyEl) {
			return;
		}
		fillActivityBody(bodyEl, list, true);
		if (lastLoadingMessage && lastLoadingMessage.parentNode === messages) {
			messages.insertBefore(chatActivityCard, lastLoadingMessage);
		} else if (!chatActivityCard.parentNode) {
			messages.appendChild(chatActivityCard);
		}
		messages.scrollTop = messages.scrollHeight;
	}

	function _makeActivityFileIcon(label) {
		const lower = label.toLowerCase();
		let iconClass = '';
		let iconText = '';
		if (lower.startsWith('write_file:') || lower.startsWith('apply_patch:') || lower.startsWith('insert_lines:')) {
			iconClass = 'nx-activityFileIcon nx-activityFileIconWrite';
			iconText = 'W';
		} else if (lower.startsWith('read_file:')) {
			iconClass = 'nx-activityFileIcon nx-activityFileIconRead';
			iconText = 'R';
		} else if (lower.startsWith('open_browser:') || lower.startsWith('browser_snapshot') || lower.startsWith('browser_click:') || lower.startsWith('browser_type:') || lower.startsWith('browser_select:') || lower.startsWith('browser_press:')) {
			iconClass = 'nx-activityFileIcon nx-activityFileIconSearch';
			iconText = 'B';
		} else if (lower.startsWith('search_codebase:') || lower.startsWith('grep:') || lower.startsWith('search_chat_history:')) {
			iconClass = 'nx-activityFileIcon nx-activityFileIconSearch';
			iconText = 'S';
		}
		if (!iconText) {
			return null;
		}
		const span = document.createElement('span');
		span.className = iconClass;
		span.textContent = iconText;
		return span;
	}

	function updateCostTicker(costUsd, tokensIn, tokensOut) {
		if (!messages) {
			return;
		}
		totalCostUsd += costUsd;
		totalTokensIn += tokensIn;
		totalTokensOut += tokensOut;
		if (!costTickerEl) {
			costTickerEl = document.createElement('div');
			costTickerEl.className = 'nx-costTicker';
		}
		const totalTokens = totalTokensIn + totalTokensOut;
		const kTokens = totalTokens >= 1000
			? (totalTokens / 1000).toFixed(1) + 'K'
			: String(totalTokens);
		costTickerEl.textContent = '$' + totalCostUsd.toFixed(4) + ' -- ' + kTokens + ' tokens';
		if (chatActivityCard && chatActivityCard.parentNode) {
			const next = chatActivityCard.nextSibling;
			if (next !== costTickerEl) {
				chatActivityCard.parentNode.insertBefore(costTickerEl, next);
			}
		} else if (!costTickerEl.parentNode) {
			messages.appendChild(costTickerEl);
		}
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

	function appendToken(content) {
		const chunk = String(content || '');
		if (!chunk) {
			return;
		}
		if (!lastLoadingMessage) {
			addMessage('assistant', chunk, true);
			return;
		}
		const body = lastLoadingMessage.querySelector('.nx-msgBody');
		if (!body) {
			return;
		}
		if (body.getAttribute('data-nx-streaming') !== '1') {
			body.textContent = chunk;
			body.setAttribute('data-nx-streaming', '1');
		} else {
			body.textContent = (body.textContent || '') + chunk;
		}
		messages.scrollTop = messages.scrollHeight;
	}

	function finishMessage() {
		if (!lastLoadingMessage) {
			setReplyInFlight(false);
			return;
		}
		const body = lastLoadingMessage.querySelector('.nx-msgBody');
		const text = body ? (body.textContent || '') : '';
		lastLoadingMessage.classList.remove('nx-msgLoading');
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

	function renderSessions(sessions, activeId) {
		if (!sessionList) {
			return;
		}
		if (activeId) {
			activeSessionId = activeId;
		}
		sessionList.innerHTML = '';
		(sessions || []).forEach(function (s) {
			const id = s && s.id ? String(s.id) : '';
			if (!id) {
				return;
			}
			const name = (s && s.name) ? String(s.name) : 'New chat';
			const row = document.createElement('div');
			row.className = 'nx-railItem' + (id === activeSessionId ? ' is-active' : '');
			row.setAttribute('role', 'listitem');
			row.setAttribute('data-session-id', id);
			if (id === activeSessionId) {
				row.setAttribute('aria-current', 'true');
			}

			const openBtn = document.createElement('button');
			openBtn.type = 'button';
			openBtn.className = 'nx-railOpen';
			openBtn.title = name;
			const openLabel = document.createElement('span');
			openLabel.className = 'nx-railOpenText';
			openLabel.textContent = name;
			openBtn.appendChild(openLabel);
			openBtn.addEventListener('click', function () {
				if (id === activeSessionId) {
					return;
				}
				vscode.postMessage({ type: 'switchSession', sessionId: id });
			});

			const delBtn = document.createElement('button');
			delBtn.type = 'button';
			delBtn.className = 'nx-railDelete';
			delBtn.title = 'Delete chat session';
			delBtn.setAttribute('aria-label', 'Delete ' + name);
			delBtn.textContent = '-';
			delBtn.addEventListener('click', function (ev) {
				ev.stopPropagation();
				vscode.postMessage({ type: 'deleteSession', sessionId: id });
			});

			row.appendChild(openBtn);
			row.appendChild(delBtn);
			sessionList.appendChild(row);
		});
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
				<span class="nx-planCost">Est. $${(plan.estimated_cost || 0).toFixed(4)}</span>
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
						<span>$${(item.estimated_cost || 0).toFixed(4)}</span>
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
			|| status === 'partially_completed' || status === 'timeout') {
			const actual = typeof plan.actual_cost === 'number'
				? plan.actual_cost
				: typeof plan.actual_total_cost === 'number'
					? plan.actual_total_cost
					: tasks.reduce((sum, t) => sum + (Number(t.actual_cost) || 0), 0);
			showPlanComplete(planId, status, tasks, actual);
		}
	}

	function showPlanExecuting(planId) {
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

	function showPlanComplete(planId, status, tasks, actualCost) {
		const actionsEl = document.getElementById('plan-actions-' + planId);
		const resolvedTasks = tasks || (currentPlan && currentPlan.plan_id === planId ? currentPlan.tasks : null);
		if (actionsEl) {
			const isSuccess = status === 'completed';
			const successCount = resolvedTasks ? resolvedTasks.filter(t => t.status === 'success').length : 0;
			const failedCount = resolvedTasks ? resolvedTasks.filter(t => t.status === 'failed').length : 0;

			actionsEl.innerHTML = `
				<div class="nx-planResult ${isSuccess ? 'nx-planSuccess' : 'nx-planFailed'}">
					<span class="nx-resultIcon">${isSuccess ? 'ok' : '!'}</span>
					<span class="nx-resultText">
						${isSuccess ? 'Completed' : 'Completed with issues'}
						${successCount > 0 ? ` • ${successCount} succeeded` : ''}
						${failedCount > 0 ? ` • ${failedCount} failed` : ''}
					</span>
					<span class="nx-resultCost">$${(actualCost || 0).toFixed(4)}</span>
				</div>
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

		currentPlan = null;
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

	function handleSend() {
		if (replyInFlight) {
			return;
		}

		const text = input.value.trim();
		if (!text) {
			return;
		}

		hideAtCompleteMenu();

		const model = modelSelect.value;
		const mode = modeSelect.value;

		addMessage('user', text, false);

		if (mode === 'chat' || mode === 'ask' || mode === 'agent') {
			setReplyInFlight(true);
			addMessage('assistant', '', true);
			renderChatActivity([{ id: 'agent', label: 'Working...', done: false }], 'Working...');
		}

		switch (mode) {
			case 'chat':
				vscode.postMessage({ type: 'sendMessage', message: text, model: model });
				break;
			case 'ask':
				vscode.postMessage({ type: 'askWorkspace', message: text, model: model });
				break;
			case 'plan':
				vscode.postMessage({ type: 'generatePlan', request: text, model: model });
				break;
			case 'execute':
				vscode.postMessage({ type: 'executeRequest', request: text, model: model });
				break;
			case 'agent':
				vscode.postMessage({ type: 'runAgent', request: text, model: model });
				break;
			default:
				vscode.postMessage({ type: 'sendMessage', message: text, model: model });
		}

		input.value = '';
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

	wireComposerDropdowns();
	wireMessagesScrollbarFlash();
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

	// Quick action buttons
	document.querySelectorAll('.nx-quickBtn').forEach(btn => {
		btn.onclick = () => {
			const action = btn.getAttribute('data-action');
			if (action === 'platforms') {
				vscode.postMessage({ type: 'browsePlatforms' });
			} else if (action === 'history') {
				vscode.postMessage({ type: 'getHistory' });
			} else if (action === 'memory') {
				vscode.postMessage({ type: 'indexWorkspace' });
			}
		};
	});

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
				updateAuthStatus(data.github, data.vercel, data.supabase, data.stripe, data.v0, data.elevenlabs, data.tavily);
				if (data.backendOffline === true) {
					updateStatus(false);
				}
				break;

			case 'showPlanApproval':
				createPlanApprovalCard(data.plan);
				break;

			case 'updateSessions':
				renderSessions(data.sessions, data.activeSessionId);
				break;

			case 'loadSession':
				loadSessionMessages(data.sessionId, data.messages);
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

			case 'planExecutionComplete':
				showPlanComplete(data.planId, data.status, data.tasks, data.actualCost);
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
				updateCostTicker(data.cost_usd, data.tokens_in, data.tokens_out);
				break;

			case 'composerSettings':
				submitWithCtrlEnter = !!data.submitWithCtrlEnter;
				applySendButtonChrome();
				break;

			case 'modelPickerState':
				renderModelPicker(data.catalog, data.enabledModelIds, data.selectedModelId);
				break;

			case 'modelSelected':
				if (modelSelect && data.modelId) {
					modelSelect.value = data.modelId;
					if (modelDdRoot) {
						syncOneDd(modelDdRoot);
					}
				}
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

	if (initial.sessions && initial.activeSessionId) {
		renderSessions(initial.sessions, initial.activeSessionId);
		loadSessionMessages(initial.activeSessionId, initial.messages || []);
	}

	function injectDdTriggerIcon(root, svgHtml) {
		if (!root) {
			return;
		}
		const trigger = root.querySelector('.nx-ddTrigger');
		if (!trigger || trigger.querySelector('.nx-ddTriggerIcon')) {
			return;
		}
		const icon = document.createElement('span');
		icon.className = 'nx-ddTriggerIcon';
		icon.setAttribute('aria-hidden', 'true');
		icon.innerHTML = svgHtml;
		const text = trigger.querySelector('.nx-ddTriggerText');
		if (text) {
			trigger.insertBefore(icon, text);
		} else {
			trigger.insertBefore(icon, trigger.firstChild);
		}
	}

	function syncComposerCompact() {
		const card = document.getElementById('composerCard');
		if (!card) {
			return;
		}
		const narrow = card.clientWidth > 0 && card.clientWidth < 280;
		card.classList.toggle('nx-composerCompact', narrow);
	}

	injectDdTriggerIcon(
		modeDdRoot,
		'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3 14.2 8.8 20 11 14.2 13.2 12 19 9.8 13.2 4 11 9.8 8.8 12 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
	);
	injectDdTriggerIcon(
		modelDdRoot,
		'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
	);

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
