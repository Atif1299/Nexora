/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The chat composer's chip row and menus: [+] [Mode] [Model . effort] [Approval], the slash
// command list and selection tags. chat.js keeps owning the text box contents, the current
// mode and model, and the send paths; it hands them over through NexoraComposer.init().
// Spec: Nexora-IDE-Backend-Architecture/docs/superpowers/specs/2026-11-01-composer-redesign-design.md
(function () {
	'use strict';

	const MODES = [
		{ value: 'chat', label: 'Chat', desc: 'Talk it through', placeholder: 'Ask anything' },
		{ value: 'ask', label: 'Ask', desc: 'Reads your code, no edits', placeholder: 'Ask about your code' },
		{ value: 'agent', label: 'Agent', desc: 'Edits files and runs commands', placeholder: 'Describe what to build' },
		{ value: 'plan', label: 'Plan', desc: 'Shows a costed plan first', placeholder: 'Describe the outcome; Nexora prices a plan first' },
		{ value: 'execute', label: 'Execute', desc: 'Runs an approved plan', placeholder: 'Describe the plan to run' }
	];
	const RUN_MODES = [
		{ value: 'ask', label: 'Ask first', desc: 'Confirm every change and command' },
		{ value: 'auto-edit', label: 'Accept edits', desc: 'Edits apply, commands ask' },
		{ value: 'allowlist', label: 'Safe commands', desc: 'Edits apply, allowlisted commands run' },
		{ value: 'run-everything', label: 'Run everything', desc: 'No questions' }
	];
	const EFFORTS = [
		{ value: 'fast', label: 'Fast' },
		{ value: 'balanced', label: 'Balanced' },
		{ value: 'thorough', label: 'Thorough' }
	];
	const SLASH = [
		{ cmd: 'new', desc: 'Start a new chat' },
		{ cmd: 'chat', desc: 'Switch to Chat', mode: 'chat' },
		{ cmd: 'ask', desc: 'Switch to Ask', mode: 'ask' },
		{ cmd: 'agent', desc: 'Switch to Agent', mode: 'agent' },
		{ cmd: 'plan', desc: 'Switch to Plan', mode: 'plan' },
		{ cmd: 'execute', desc: 'Switch to Execute', mode: 'execute' },
		{ cmd: 'model', desc: 'Choose a model' },
		{ cmd: 'reindex', desc: 'Re-index this workspace' },
		{ cmd: 'rules', desc: 'Open the rules' },
		{ cmd: 'customize', desc: 'Skills, subagents, commands and rules' },
		{ cmd: 'help', desc: 'Show commands and keys' }
	];
	// The user's command files (.nexora, .claude, .cursor), pushed by the host.
	let customCommands = [];
	const HINT = '. Type @ to add a file, / for commands';
	const MENU_SEARCH_MIN = 8;

	let host = null;
	let catalog = null;
	let enabledIds = [];
	let state = { runMode: 'auto-edit', effort: 'balanced', hasSelection: false };
	let tags = [];
	let menu = { kind: '', items: [], index: 0, anchor: null };
	let modelQuery = '';

	function $(id) {
		return document.getElementById(id);
	}

	function el(tag, cls, text) {
		const node = document.createElement(tag);
		if (cls) {
			node.className = cls;
		}
		if (text !== undefined) {
			node.textContent = text;
		}
		return node;
	}

	function modeInfo(value) {
		return MODES.find(function (m) { return m.value === value; }) || MODES[0];
	}

	function findModel(id) {
		if (!catalog || !Array.isArray(catalog.providers)) {
			return null;
		}
		for (const p of catalog.providers) {
			for (const m of (p.models || [])) {
				if (m.id === id) {
					return m;
				}
			}
		}
		return null;
	}

	function modelLabel(id) {
		if (!id || id === 'auto') {
			return (catalog && catalog.auto && catalog.auto.label) || 'Auto';
		}
		const m = findModel(id);
		return m ? m.label : id.split('/').pop();
	}

	function effortLabel(value) {
		const e = EFFORTS.find(function (x) { return x.value === value; });
		return e ? e.label : 'Balanced';
	}

	function setChipText(id, text) {
		const chip = $(id);
		const span = chip && chip.querySelector('.nx-chipText');
		if (span) {
			span.textContent = text;
		}
	}

	// --- chips ---------------------------------------------------------------

	function render() {
		if (!host) {
			return;
		}
		const mode = host.getMode();
		const info = modeInfo(mode);
		setChipText('modeChip', info.label);
		const model = modelLabel(host.getModel());
		setChipText('modelChip', state.effort === 'balanced' ? model : model + ' . ' + effortLabel(state.effort));
		const approval = $('approvalChip');
		if (approval) {
			approval.hidden = mode === 'chat' || mode === 'ask';
			const run = RUN_MODES.find(function (r) { return r.value === state.runMode; }) || RUN_MODES[1];
			setChipText('approvalChip', run.label);
		}
		if (host.input) {
			host.input.placeholder = info.placeholder + HINT;
		}
		renderTags();
	}

	function renderTags() {
		const row = $('composerTags');
		if (!row) {
			return;
		}
		row.innerHTML = '';
		row.hidden = tags.length === 0;
		tags.forEach(function (tag, i) {
			const chip = el('span', 'nx-composerTag');
			chip.appendChild(el('span', 'nx-composerTagLabel', tag.label));
			const remove = el('button', 'nx-composerTagRemove', 'x');
			remove.type = 'button';
			remove.setAttribute('aria-label', 'Remove ' + tag.label);
			remove.addEventListener('click', function () {
				tags.splice(i, 1);
				renderTags();
				host.input.focus();
			});
			chip.appendChild(remove);
			row.appendChild(chip);
		});
	}

	// --- menus ---------------------------------------------------------------

	function closeMenu() {
		const box = $('composerMenu');
		if (box) {
			box.hidden = true;
			box.innerHTML = '';
		}
		if (menu.anchor) {
			menu.anchor.setAttribute('aria-expanded', 'false');
		}
		menu = { kind: '', items: [], index: 0, anchor: null };
	}

	function isMenuOpen() {
		return !!menu.kind;
	}

	function positionMenu(box, anchor) {
		const card = $('composerCard');
		if (!card || !anchor) {
			return;
		}
		const cardRect = card.getBoundingClientRect();
		const rect = anchor.getBoundingClientRect();
		box.style.left = Math.max(0, Math.min(rect.left - cardRect.left, cardRect.width - box.offsetWidth)) + 'px';
		box.style.bottom = (cardRect.bottom - rect.top + 6) + 'px';
	}

	// items: [{ label, desc?, hint?, header?, note?, selected?, pick?() }]
	function openMenu(kind, anchor, items, extra) {
		closeMenu();
		const box = $('composerMenu');
		if (!box) {
			return;
		}
		menu = { kind: kind, items: items.filter(function (it) { return it.pick; }), index: 0, anchor: anchor };
		const selectedIndex = menu.items.findIndex(function (it) { return it.selected; });
		menu.index = selectedIndex >= 0 ? selectedIndex : 0;
		box.innerHTML = '';
		let pickNumber = 0;
		items.forEach(function (it) {
			if (it.header) {
				box.appendChild(el('div', 'nx-menuHeader', it.header));
				return;
			}
			if (it.note) {
				box.appendChild(el('div', 'nx-menuNote', it.note));
				return;
			}
			const row = el('button', 'nx-menuItem' + (it.selected ? ' nx-isSelected' : ''));
			row.type = 'button';
			row.setAttribute('role', 'option');
			const main = el('span', 'nx-menuMain');
			main.appendChild(el('span', 'nx-menuLabel', it.label));
			if (it.desc) {
				main.appendChild(el('span', 'nx-menuDesc', it.desc));
			}
			row.appendChild(main);
			pickNumber += 1;
			const hint = it.hint !== undefined ? it.hint : (kind === 'mode' || kind === 'approval' ? String(pickNumber) : '');
			if (hint) {
				row.appendChild(el('span', 'nx-menuHint', hint));
			}
			row.addEventListener('mousedown', function (e) { e.preventDefault(); });
			row.addEventListener('click', function () { pick(it); });
			box.appendChild(row);
		});
		if (extra) {
			box.appendChild(extra);
		}
		box.hidden = false;
		if (anchor) {
			anchor.setAttribute('aria-expanded', 'true');
		}
		paintActive();
		positionMenu(box, anchor);
	}

	function paintActive() {
		const rows = Array.from(document.querySelectorAll('#composerMenu .nx-menuItem'));
		rows.forEach(function (r, i) { r.classList.toggle('nx-isActive', i === menu.index); });
		const active = rows[menu.index];
		if (active && active.scrollIntoView) {
			active.scrollIntoView({ block: 'nearest' });
		}
	}

	function pick(item) {
		const keepOpen = item.keepOpen;
		if (!keepOpen) {
			closeMenu();
		}
		item.pick();
		render();
		if (!keepOpen && host && host.input) {
			host.input.focus();
		}
	}

	function openModeMenu() {
		const current = host.getMode();
		openMenu('mode', $('modeChip'), MODES.map(function (m) {
			return { label: m.label, desc: m.desc, selected: m.value === current, pick: function () { host.setMode(m.value); } };
		}));
	}

	function openApprovalMenu() {
		openMenu('approval', $('approvalChip'), RUN_MODES.map(function (r) {
			return {
				label: r.label,
				desc: r.desc,
				selected: r.value === state.runMode,
				pick: function () {
					state.runMode = r.value;
					host.post({ type: 'setRunMode', runMode: r.value });
				}
			};
		}));
	}

	function modelItems() {
		const current = host.getModel() || 'auto';
		const items = [{ label: modelLabel('auto'), hint: '', selected: current === 'auto', pick: function () { host.setModel('auto'); } }];
		if (!catalog) {
			items.push({ note: 'Models unavailable' });
			return items;
		}
		const enabled = new Set(enabledIds || []);
		const q = modelQuery.toLowerCase();
		(catalog.providers || []).forEach(function (p) {
			if (!p || !p.configured) {
				return;
			}
			// Nexora Cloud's short list is always shown; other providers show the models the user enabled.
			const models = (p.models || []).filter(function (m) {
				return (p.id === 'nexora_cloud' || enabled.has(m.id)) && (!q || m.label.toLowerCase().indexOf(q) >= 0);
			});
			if (!models.length) {
				return;
			}
			items.push({ header: p.label || p.id });
			models.forEach(function (m) {
				items.push({ label: m.label, hint: m.priceTier || '', selected: m.id === current, pick: function () { host.setModel(m.id); } });
			});
		});
		return items;
	}

	function effortFooter() {
		const foot = el('div', 'nx-menuEffort');
		foot.appendChild(el('span', 'nx-menuEffortLabel', 'Effort'));
		const group = el('span', 'nx-menuEffortGroup');
		EFFORTS.forEach(function (e) {
			const b = el('button', 'nx-effortBtn' + (e.value === state.effort ? ' nx-isSelected' : ''), e.label);
			b.type = 'button';
			b.dataset.effort = e.value;
			b.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
			b.addEventListener('click', function () {
				state.effort = e.value;
				host.post({ type: 'setEffort', effort: e.value });
				render();
				openModelMenu();
			});
			group.appendChild(b);
		});
		foot.appendChild(group);
		const selected = findModel(host.getModel());
		if (selected && !selected.reasoning) {
			foot.appendChild(el('div', 'nx-menuNote', 'No effort setting for this model'));
		}
		return foot;
	}

	function openModelMenu() {
		const items = modelItems();
		const extra = el('div', 'nx-menuFooter');
		const count = items.filter(function (it) { return it.pick; }).length;
		if (count >= MENU_SEARCH_MIN || modelQuery) {
			const search = el('input', 'nx-menuSearch');
			search.type = 'search';
			search.placeholder = 'Search models';
			search.value = modelQuery;
			search.addEventListener('input', function () {
				modelQuery = search.value;
				openModelMenu();
				const again = document.querySelector('#composerMenu .nx-menuSearch');
				if (again) {
					again.focus();
					again.setSelectionRange(again.value.length, again.value.length);
				}
			});
			extra.appendChild(search);
		}
		extra.appendChild(effortFooter());
		openMenu('model', $('modelChip'), items, extra);
	}

	function openPlusMenu() {
		const items = [
			{ label: 'Files', hint: '@', pick: function () { insertAtCaret('@'); } },
			{ label: 'Folder', pick: function () { host.post({ type: 'requestFolder' }); } }
		];
		if (state.hasSelection) {
			items.push({ label: 'Current selection', pick: function () { host.post({ type: 'requestSelection' }); } });
		}
		items.push({ label: 'Open editors', pick: function () { host.post({ type: 'requestOpenEditors' }); } });
		items.push({ label: 'Commands', hint: '/', keepOpen: true, pick: openCommandsForDraft });
		openMenu('plus', $('plusChip'), items);
	}

	function insertAtCaret(text) {
		const input = host.input;
		const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
		const before = input.value.slice(0, start);
		const lead = before && !/\s$/.test(before) ? ' ' : '';
		input.value = before + lead + text + input.value.slice(start);
		const caret = before.length + lead.length + text.length;
		input.focus();
		input.setSelectionRange(caret, caret);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}

	// --- slash commands ------------------------------------------------------

	// "+ > Commands": the list without touching the box; a mode command sends the current draft.
	function openCommandsForDraft() {
		const draft = host.input.value.trim();
		const items = SLASH.map(function (s) {
			return { label: '/' + s.cmd, desc: s.desc, hint: '', pick: function () { runSlash(s, draft, true); } };
		});
		customCommands.forEach(function (c) {
			items.push({ label: '/' + c.name, desc: c.description || 'Your command', hint: c.argument_hint || '', pick: function () { host.input.value = '/' + c.name + ' ' + draft; host.input.focus(); closeMenu(); } });
		});
		openMenu('slash', host.input, items);
	}

	function slashQuery() {
		const v = host.input.value;
		return /^\/[a-z0-9_:-]*$/i.test(v) ? v.slice(1).toLowerCase() : null;
	}

	// A command file's command: put "/name " in the box for the text that goes after it.
	function insertCustomCommand(c) {
		closeMenu();
		host.input.value = '/' + c.name + ' ';
		host.input.focus();
		host.input.setSelectionRange(host.input.value.length, host.input.value.length);
	}

	function updateSlashList() {
		const q = slashQuery();
		if (q === null) {
			if (menu.kind === 'slash') {
				closeMenu();
			}
			return;
		}
		if (q === '' && menu.kind !== 'slash') {
			host.post({ type: 'requestCustomCommands' });
		}
		const matches = SLASH.filter(function (s) { return s.cmd.indexOf(q) === 0; });
		const items = matches.map(function (s) {
			return { label: '/' + s.cmd, desc: s.desc, hint: '', pick: function () { runSlash(s, ''); } };
		});
		customCommands.filter(function (c) { return c.name.indexOf(q) === 0; }).forEach(function (c) {
			items.push({ label: '/' + c.name, desc: c.description || 'Your command', hint: c.argument_hint || '', pick: function () { insertCustomCommand(c); } });
		});
		if (!items.length) {
			items.push({ note: 'No matching command' });
		}
		openMenu('slash', host.input, items);
	}

	// keepText: the command came from "+ > Commands", so the box holds the user's draft, not "/cmd".
	function runSlash(entry, rest, keepText) {
		if (!keepText) {
			host.input.value = '';
		}
		if (entry.mode) {
			host.setMode(entry.mode);
			render();
			if (rest) {
				host.input.value = rest;
				host.send();
			}
			return;
		}
		if (entry.cmd === 'model') {
			openModelMenu();
			return;
		}
		host.post({ type: 'runSlash', command: entry.cmd, rest: rest });
	}

	// "/cmd rest" typed in full: a known command runs; anything else is ordinary text.
	function trySlashSubmit() {
		const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(host.input.value.trim());
		if (!m) {
			return false;
		}
		const entry = SLASH.find(function (s) { return s.cmd === m[1].toLowerCase(); });
		if (!entry) {
			return false;
		}
		closeMenu();
		runSlash(entry, (m[2] || '').trim());
		return true;
	}

	// --- keyboard ------------------------------------------------------------

	function moveActive(delta) {
		if (!menu.items.length) {
			return;
		}
		menu.index = (menu.index + delta + menu.items.length) % menu.items.length;
		paintActive();
	}

	function onMenuKey(e) {
		if (!isMenuOpen()) {
			return false;
		}
		if (e.key === 'Escape') {
			closeMenu();
			return true;
		}
		if (e.key === 'ArrowDown') {
			moveActive(1);
			return true;
		}
		if (e.key === 'ArrowUp') {
			moveActive(-1);
			return true;
		}
		if (e.key === 'Enter' || (e.key === 'Tab' && menu.kind === 'slash')) {
			const item = menu.items[menu.index];
			if (item) {
				pick(item);
				return true;
			}
			return false;
		}
		if (/^[1-9]$/.test(e.key) && (menu.kind === 'mode' || menu.kind === 'approval')) {
			const item = menu.items[Number(e.key) - 1];
			if (item) {
				pick(item);
			}
			return true;
		}
		return false;
	}

	function onInputKeydown(e) {
		// chat.js's @ file list owns Enter, Tab, arrows and Esc while it is open.
		if (e.isComposing || (host.isAtOpen && host.isAtOpen())) {
			return;
		}
		let handled = false;
		if (isMenuOpen() && menu.kind !== 'slash' && e.key !== 'Escape' && !/^Arrow|^Enter$|^[1-9]$/.test(e.key)) {
			closeMenu();
		}
		if (onMenuKey(e)) {
			handled = true;
		} else if (e.key === 'Escape' && host.isBusy()) {
			host.stop();
			handled = true;
		} else if (e.key === 'Tab' && e.shiftKey) {
			const i = MODES.findIndex(function (m) { return m.value === host.getMode(); });
			host.setMode(MODES[(i + 1) % MODES.length].value);
			render();
			handled = true;
		} else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
			if (trySlashSubmit()) {
				handled = true;
			} else if (!host.input.value.trim() && tags.length && !host.isBusy()) {
				host.send();
				handled = true;
			}
		}
		if (handled) {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}

	function onDocumentKeydown(e) {
		if (!isMenuOpen() || e.target === host.input || (e.target && e.target.classList && e.target.classList.contains('nx-menuSearch') && /^[1-9]$/.test(e.key))) {
			return;
		}
		if (onMenuKey(e)) {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	function toggle(kind, open) {
		return function (e) {
			if (e) {
				e.preventDefault();
			}
			if (menu.kind === kind) {
				closeMenu();
				return;
			}
			if (kind === 'model') {
				modelQuery = '';
			}
			open();
		};
	}

	// --- public API ----------------------------------------------------------

	window.NexoraComposer = {
		/** host: { input, post, getMode, setMode, getModel, setModel, isBusy, stop, send, insertMention, isAtOpen } */
		init: function (h) {
			host = h;
			h.input.addEventListener('keydown', onInputKeydown, true);
			h.input.addEventListener('input', updateSlashList);
			document.addEventListener('keydown', onDocumentKeydown, true);
			document.addEventListener('mousedown', function (e) {
				const box = $('composerMenu');
				if (isMenuOpen() && box && !box.contains(e.target) && (!menu.anchor || !menu.anchor.contains(e.target))) {
					closeMenu();
				}
			});
			$('plusChip').addEventListener('click', toggle('plus', openPlusMenu));
			$('modeChip').addEventListener('click', toggle('mode', openModeMenu));
			$('modelChip').addEventListener('click', toggle('model', openModelMenu));
			$('approvalChip').addEventListener('click', toggle('approval', openApprovalMenu));
			render();
		},
		render: render,
		closeMenu: closeMenu,
		setCustomCommands: function (list) {
			customCommands = Array.isArray(list) ? list.filter(function (c) { return c && typeof c.name === 'string'; }) : [];
			if (menu.kind === 'slash' && slashQuery() !== null) {
				updateSlashList();
			}
		},
		openModelMenu: function () { modelQuery = ''; openModelMenu(); },
		setCatalog: function (c, ids) {
			catalog = c || null;
			enabledIds = Array.isArray(ids) ? ids : [];
			render();
		},
		setComposerState: function (s) {
			state = Object.assign({}, state, s || {});
			render();
		},
		/** Selection tags stay here; file and folder tags become @mentions in the text box. */
		addTags: function (list) {
			(list || []).forEach(function (t) {
				if (t.kind === 'selection') {
					tags.push({ kind: 'selection', label: t.label, text: t.text || '' });
				} else if (t.path && host.insertMention) {
					host.insertMention(t.kind === 'folder' && !/\/$/.test(t.path) ? t.path + '/' : t.path);
				}
			});
			render();
		},
		extras: function () {
			return { effort: state.effort, context: tags.map(function (t) { return Object.assign({}, t); }) };
		},
		hasContext: function () {
			return tags.length > 0;
		},
		afterSend: function () {
			tags = [];
			closeMenu();
			renderTags();
		}
	};
})();
