/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Customize tab (Phase 3): skills, subagents, commands, rules and a link to Platforms.
(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const M = window.NexoraCustomizeModel;
	const CHIPS = [
		{ id: 'all', label: 'All' },
		{ id: 'user', label: 'You' },
		{ id: 'project', label: 'This project' },
		{ id: 'claude', label: 'From Claude Code' },
		{ id: 'cursor', label: 'From Cursor' }
	];
	const KIND_OF = { skills: 'skill', agents: 'agent', commands: 'command' };

	const ui = {
		section: 'skills',
		query: '',
		chip: 'all',
		detail: null,
		detailText: null,
		newForm: false,
		error: '',
		data: null
	};

	function $(id) {
		return document.getElementById(id);
	}

	function esc(value) {
		return String(value === undefined || value === null ? '' : value)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	function post(message) {
		vscode.postMessage(message);
	}

	function section() {
		return M.SECTIONS.find(function (s) { return s.id === ui.section; }) || M.SECTIONS[0];
	}

	function items(id) {
		return (ui.data && Array.isArray(ui.data[id])) ? ui.data[id] : [];
	}

	function activeCount(id) {
		if (id === 'rules') {
			const rules = ui.data && ui.data.rules;
			return rules && Array.isArray(rules.files) ? rules.files.length : 0;
		}
		if (id === 'platforms') {
			return -1;
		}
		return items(id).filter(function (i) { return !i.shadowed_by; }).length;
	}

	// --- navigation ---------------------------------------------------------

	function renderNav() {
		$('cz-nav').innerHTML = '<div class="cz-navTitle">Customize</div>' + M.SECTIONS.map(function (s) {
			const n = activeCount(s.id);
			return '<button type="button" class="cz-navItem' + (s.id === ui.section ? ' cz-navActive' : '') + '" data-section="' + s.id + '"' +
				(s.id === ui.section ? ' aria-current="page"' : '') + '>' +
				'<span>' + esc(s.title) + '</span>' + (n >= 0 ? '<span class="cz-navCount">' + n + '</span>' : '') + '</button>';
		}).join('');
	}

	// --- shared pieces -------------------------------------------------------

	function header(s, withTools) {
		const engine = ui.data && ui.data.engine;
		let html = '<header class="cz-head"><div><h1>' + esc(s.title) + '</h1><p class="nx-hint">' + esc(s.blurb) + '</p></div>';
		if (withTools && engine) {
			html += '<div class="cz-headActions"><button type="button" class="nx-btn nx-btn-secondary" data-act="examples">Examples</button>' +
				'<button type="button" class="nx-btn" data-act="new">+ New ' + esc(s.singular) + '</button></div>';
		}
		html += '</header>';
		if (ui.error) {
			html += '<div class="nx-banner cz-error" role="alert">' + esc(ui.error) + '</div>';
		}
		return html;
	}

	function tooOld() {
		return '<div class="nx-empty"><div class="nx-empty-title">This engine is too old for Customize.</div>' +
			'<p class="nx-hint">Restart Nexora after updating, and skills, subagents and commands appear here.</p></div>';
	}

	function originChip(item) {
		return '<span class="cz-chip cz-origin-' + esc(item.origin) + '">' + esc(M.originLabel(item.origin)) + '</span>';
	}

	// --- New form --------------------------------------------------------------

	function newForm(s) {
		const hasWs = !!(ui.data && ui.data.hasWorkspace);
		const isRule = s.id === 'rules';
		return '<form class="nx-card cz-newForm" id="cz-newForm" autocomplete="off">' +
			'<div class="cz-formTitle">New ' + esc(s.singular) + '</div>' +
			'<label class="cz-field"><span>Name</span><input class="nx-input" id="cz-newName" placeholder="' + (isRule ? 'testing' : s.id === 'agents' ? 'code-reviewer' : s.id === 'commands' ? 'review' : 'write-tests') + '" maxlength="64" required></label>' +
			(isRule ? '' : '<label class="cz-field"><span>Description</span><input class="nx-input" id="cz-newDesc" placeholder="' + (s.id === 'commands' ? 'What the command does' : 'When the agent should use it') + '"></label>') +
			(isRule ? '<p class="nx-hint">Creates .nexora/rules/&lt;name&gt;.md in this project.</p>' :
				'<fieldset class="cz-scope"><legend>Where</legend>' +
				'<label><input type="radio" name="cz-scope" value="user" checked> You (all projects)</label>' +
				'<label' + (hasWs ? '' : ' class="cz-disabled" title="Open a folder first"') + '><input type="radio" name="cz-scope" value="project"' + (hasWs ? '' : ' disabled') + '> This project (.nexora, shared through git)</label>' +
				'</fieldset>') +
			'<div class="cz-formError" id="cz-newError" role="alert"></div>' +
			'<div class="nx-row"><button type="submit" class="nx-btn">Create and open</button><button type="button" class="nx-btn nx-btn-ghost" data-act="cancelNew">Cancel</button></div>' +
			'</form>';
	}

	function submitNew(e) {
		e.preventDefault();
		const s = section();
		const name = $('cz-newName').value.trim();
		const problem = M.validateNewName(name);
		if (problem) {
			$('cz-newError').textContent = problem;
			$('cz-newName').focus();
			return;
		}
		if (s.id === 'rules') {
			post({ type: 'newRule', name: name });
		} else {
			const checked = document.querySelector('input[name="cz-scope"]:checked');
			post({ type: 'newItem', kind: s.id, name: name, scope: checked ? checked.value : 'user', description: ($('cz-newDesc').value || '').trim() });
		}
		ui.newForm = false;
		ui.error = '';
	}

	// --- item lists --------------------------------------------------------------

	function row(item) {
		const hidden = !!item.shadowed_by;
		const problems = (item.problems || []).map(function (p) { return '<div class="cz-problem">' + esc(p) + '</div>'; }).join('');
		return '<div class="cz-row' + (hidden ? ' cz-hidden' : '') + '" role="listitem">' +
			'<button type="button" class="cz-rowMain" data-open-detail="' + esc(item.name) + '" data-path="' + esc(item.path) + '">' +
			'<span class="cz-rowTop"><span class="cz-name">' + esc(item.kind === 'command' ? '/' + item.name : item.name) + '</span>' + originChip(item) +
			(item.usage ? '<span class="cz-usage">' + esc(M.usageLabel(item.usage)) + '</span>' : '') + '</span>' +
			'<span class="cz-desc">' + (item.description ? esc(item.description) : '<em>No description</em>') + '</span>' +
			(hidden ? '<span class="cz-hiddenBy">Hidden by ' + esc(item.shadowed_by) + '</span>' : '') +
			problems + '</button>' +
			'<span class="cz-rowActions">' +
			(hidden ? '' : '<button type="button" class="nx-btn nx-btn-ghost" data-try="' + esc(item.name) + '" title="Put it in the chat">Try</button>') +
			'<button type="button" class="nx-btn nx-btn-ghost" data-open-file="' + esc(item.path) + '">Open</button></span></div>';
	}

	function group(title, list) {
		if (!list.length) {
			return '';
		}
		return '<div class="cz-group"><div class="cz-groupTitle">' + esc(title) + ' <span class="nx-hint">' + list.length + '</span></div>' +
			'<div class="cz-list" role="list">' + list.map(row).join('') + '</div></div>';
	}

	function renderItems(s) {
		let html = header(s, true);
		if (!ui.data.engine) {
			return html + tooOld();
		}
		if (ui.newForm) {
			html += newForm(s);
		}
		const all = items(s.id);
		if (!all.length) {
			return html + '<div class="nx-empty cz-emptyState"><div class="nx-empty-title">No ' + esc(s.title.toLowerCase()) + ' yet</div>' +
				'<p class="nx-hint">' + esc(s.blurb) + '</p><p class="nx-hint">Nexora also reads them from .claude and .cursor folders, so the ones you already have appear here by themselves.</p>' +
				'<div class="nx-row"><button type="button" class="nx-btn" data-act="new">+ New ' + esc(s.singular) + '</button>' +
				'<button type="button" class="nx-btn nx-btn-secondary" data-act="examples">Install an example</button></div></div>';
		}
		html += '<div class="cz-toolbar"><input class="nx-input cz-search" id="cz-search" type="search" placeholder="Search ' + esc(s.title.toLowerCase()) + '" value="' + esc(ui.query) + '" aria-label="Search">' +
			'<div class="cz-chips" role="group" aria-label="Filter">' + CHIPS.map(function (c) {
				return '<button type="button" class="cz-filter' + (ui.chip === c.id ? ' cz-filterOn' : '') + '" data-chip="' + c.id + '" aria-pressed="' + (ui.chip === c.id) + '">' + esc(c.label) + '</button>';
			}).join('') + '</div></div>';
		const shown = M.filterItems(all, ui.query, ui.chip);
		if (!shown.length) {
			return html + '<p class="nx-hint cz-none">Nothing matches.</p>';
		}
		const g = M.groupByScope(shown);
		return html + group(ui.data.workspaceName ? 'This project (' + ui.data.workspaceName + ')' : 'This project', g.project) + group('You', g.user);
	}

	// --- detail view ---------------------------------------------------------------

	function metaRow(label, value) {
		return value ? '<div class="cz-metaRow"><span class="cz-metaLabel">' + esc(label) + '</span><span>' + value + '</span></div>' : '';
	}

	function renderDetail(s, item) {
		const kind = item.kind;
		let tools = '';
		if (kind === 'agent') {
			tools = item.tools === null || item.tools === undefined
				? 'All tools of the mode it runs in'
				: (item.tools.length ? item.tools.map(function (t) { return '<code>' + esc(t) + '</code>'; }).join(' ') : 'None');
			if ((item.unknown_tools || []).length) {
				tools += ' <span class="cz-warn">Left out: ' + item.unknown_tools.map(esc).join(', ') + '</span>';
			}
		}
		const preview = ui.detailText === null ? '<div class="nx-hint">Loading...</div>' : '<pre class="cz-preview">' + esc(ui.detailText || '(empty)') + '</pre>';
		return '<div class="cz-detail">' +
			'<button type="button" class="nx-btn nx-btn-ghost cz-back" data-act="back">&lt; ' + esc(s.title) + '</button>' +
			'<header class="cz-head"><div><h1>' + esc(kind === 'command' ? '/' + item.name : item.name) + ' ' + originChip(item) + '</h1>' +
			'<p>' + (item.description ? esc(item.description) : '<em>No description</em>') + '</p></div>' +
			'<div class="cz-headActions">' +
			(item.shadowed_by ? '' : '<button type="button" class="nx-btn" data-try="' + esc(item.name) + '">Try in chat</button>') +
			'<button type="button" class="nx-btn nx-btn-secondary" data-open-file="' + esc(item.path) + '">Open file</button>' +
			(item.editable ? '<button type="button" class="nx-btn nx-btn-danger" data-delete="' + esc(item.name) + '" data-path="' + esc(item.path) + '">Delete</button>'
				: '<button type="button" class="nx-btn nx-btn-secondary" data-copy="' + esc(item.name) + '" title="Make an editable Nexora copy; the original is not changed">Copy to Nexora</button>') +
			'</div></header>' +
			(item.problems || []).map(function (p) { return '<div class="cz-problem">' + esc(p) + '</div>'; }).join('') +
			'<div class="nx-card cz-meta">' +
			metaRow('Source', esc(M.originLabel(item.origin) + (item.scope === 'project' ? ', this project' : ', you'))) +
			metaRow('File', '<code>' + esc(item.path) + '</code>') +
			metaRow('Use in', esc(M.useInLabel(kind))) +
			metaRow('Usage', esc(M.usageLabel(item.usage))) +
			(kind === 'command' ? metaRow('Arguments', item.argument_hint ? esc(item.argument_hint) : 'Text after the command fills $ARGUMENTS') : '') +
			(kind === 'agent' ? metaRow('Tools', tools) + metaRow('Model', esc(item.model && item.model !== 'inherit' ? item.model : 'Same as the main agent')) : '') +
			(item.shadowed_by ? metaRow('Hidden by', '<code>' + esc(item.shadowed_by) + '</code>') : '') +
			'</div>' +
			'<div class="cz-previewTitle">File</div>' + preview + '</div>';
	}

	// --- rules and platforms -------------------------------------------------------------

	function renderRules(s) {
		let html = header(s, false);
		const rules = ui.data.rules;
		if (!rules) {
			return html + '<p class="nx-hint">The engine is not reachable, so the rules could not be read.</p>';
		}
		const files = Array.isArray(rules.files) ? rules.files : [];
		const personal = files.find(function (f) { return f.personal; });
		const project = files.filter(function (f) { return !f.personal; });
		const size = function (f) { return Number(f.chars).toLocaleString() + ' chars' + (f.truncated ? ', cut to fit' : ''); };
		html += '<div class="nx-card"><div class="cz-groupTitle">Personal rules (all projects)</div>' +
			(personal ? '<div class="cz-ruleRow"><code>' + esc(rules.personal_path) + '</code><span class="nx-hint">' + size(personal) + '</span></div>'
				: '<p class="nx-hint">Your own rules for every project. None yet.</p>') +
			'<div class="nx-row"><button type="button" class="nx-btn nx-btn-secondary" data-act="personalRules">' + (personal ? 'Edit personal rules' : 'Create personal rules') + '</button></div></div>';
		html += '<div class="nx-card"><div class="cz-groupTitle cz-groupHead"><span>Project rules</span>' +
			(ui.data.hasWorkspace ? '<button type="button" class="nx-btn nx-btn-secondary" data-act="new">+ New rule</button>' : '') + '</div>';
		if (ui.newForm && ui.data.hasWorkspace) {
			html += newForm(s);
		}
		if (!ui.data.hasWorkspace) {
			html += '<p class="nx-hint">Open a folder to add project rules.</p>';
		} else if (!project.length) {
			html += '<p class="nx-hint">Add AGENTS.md, CLAUDE.md or files in .nexora/rules/ and the agent follows them on every message.</p>';
		} else {
			html += '<div class="cz-list">' + project.map(function (f) {
				return '<button type="button" class="cz-ruleRow cz-ruleLink" data-rule="' + esc(f.path) + '"><code>' + esc(f.path) + '</code><span class="nx-hint">' + size(f) + '</span></button>';
			}).join('') + '</div>';
		}
		html += '</div>';
		if (files.length) {
			html += '<p class="nx-hint">Sent with every Chat, Ask and Agent message: ' + Number(rules.total_chars).toLocaleString() + ' of ' + Number(rules.max_chars).toLocaleString() + ' characters. Project rules win where they disagree with personal ones.</p>';
		}
		if ((rules.omitted || []).length) {
			html += '<p class="cz-warn">Over the budget, not sent: ' + rules.omitted.map(esc).join(', ') + '</p>';
		}
		if (ui.data.rulesEnabled === false) {
			html += '<p class="cz-warn">Turned off by the setting nexora.agent.projectRules; these files are not sent.</p>';
		}
		return html;
	}

	function renderPlatforms(s) {
		return header(s, false) + '<div class="nx-card"><p>Connect platforms such as GitHub, Vercel or Supabase, add your own MCP servers, or import the ones you use in Cursor, Claude Code or VS Code.</p>' +
			'<div class="nx-row"><button type="button" class="nx-btn" data-act="platforms">Open Platforms</button></div></div>';
	}

	// --- examples dialog ------------------------------------------------------------------

	function openExamples() {
		const examples = (ui.data && ui.data.examples) || [];
		const hasWs = !!(ui.data && ui.data.hasWorkspace);
		const kinds = [['agent', 'Subagents'], ['skill', 'Skills'], ['command', 'Commands']];
		const current = KIND_OF[ui.section];
		kinds.sort(function (a, b) { return (b[0] === current) - (a[0] === current); });
		const box = $('cz-dialog');
		box.innerHTML = '<div class="cz-dialogBox"><header class="cz-dialogHead"><h2>Examples</h2><button type="button" class="nx-btn nx-btn-ghost" data-act="closeDialog" aria-label="Close">Close</button></header>' +
			'<p class="nx-hint">Ready-made items you can install and then edit. Each one is a normal file in Nexora\'s folder.</p>' +
			'<label class="cz-field cz-inline"><span>Install for</span><select class="nx-select" id="cz-exScope"><option value="user">You (all projects)</option>' +
			(hasWs ? '<option value="project">This project</option>' : '') + '</select></label>' +
			kinds.map(function (k) {
				const list = examples.filter(function (e) { return e.kind === k[0]; });
				if (!list.length) {
					return '';
				}
				return '<div class="cz-groupTitle">' + k[1] + '</div>' + list.map(function (e) {
					const done = [e.installed && e.installed.user ? 'you' : '', e.installed && e.installed.project ? 'this project' : ''].filter(Boolean);
					return '<div class="cz-exRow"><div><div class="cz-name">' + esc(k[0] === 'command' ? '/' + e.name : e.name) + '</div><div class="cz-desc">' + esc(e.description) + '</div>' +
						(done.length ? '<div class="nx-hint">Installed for ' + esc(done.join(' and ')) + '</div>' : '') + '</div>' +
						'<button type="button" class="nx-btn nx-btn-secondary" data-install="' + esc(e.id) + '">Install</button></div>';
				}).join('');
			}).join('') + '</div>';
		box.hidden = false;
		const first = box.querySelector('[data-install]');
		if (first) {
			first.focus();
		}
	}

	function closeDialog() {
		$('cz-dialog').hidden = true;
		$('cz-dialog').innerHTML = '';
	}

	// --- render ---------------------------------------------------------------------------

	function render() {
		renderNav();
		const main = $('cz-main');
		if (!ui.data) {
			main.innerHTML = '<div class="nx-hint">Loading...</div>';
			return;
		}
		const s = section();
		if (s.id === 'rules') {
			main.innerHTML = renderRules(s);
		} else if (s.id === 'platforms') {
			main.innerHTML = renderPlatforms(s);
		} else if (ui.detail) {
			const item = items(s.id).find(function (i) { return i.name === ui.detail.name && i.path === ui.detail.path; });
			if (item) {
				main.innerHTML = renderDetail(s, item);
			} else {
				ui.detail = null;
				main.innerHTML = renderItems(s);
			}
		} else {
			main.innerHTML = renderItems(s);
		}
		const form = $('cz-newForm');
		if (form) {
			form.addEventListener('submit', submitNew);
			$('cz-newName').focus();
		}
		const search = $('cz-search');
		if (search) {
			search.addEventListener('input', function () {
				ui.query = search.value;
				const pos = search.selectionStart;
				render();
				const again = $('cz-search');
				again.focus();
				again.setSelectionRange(pos, pos);
			});
		}
	}

	function setSection(id) {
		ui.section = id;
		ui.detail = null;
		ui.newForm = false;
		ui.query = '';
		ui.chip = 'all';
		ui.error = '';
		render();
	}

	function itemByName(name) {
		return items(section().id).find(function (i) { return i.name === name && !i.shadowed_by; })
			|| items(section().id).find(function (i) { return i.name === name; });
	}

	document.addEventListener('click', function (e) {
		const t = e.target.closest('button, [data-act]');
		if (!t) {
			return;
		}
		const d = t.dataset;
		if (d.section) {
			setSection(d.section);
		} else if (d.chip) {
			ui.chip = d.chip;
			render();
		} else if (d.openDetail !== undefined) {
			ui.detail = { name: d.openDetail, path: d.path };
			ui.detailText = null;
			post({ type: 'detailRequest', path: d.path });
			render();
		} else if (d.openFile) {
			post({ type: 'openFile', path: d.openFile });
		} else if (d.rule) {
			post({ type: 'openRule', path: d.rule });
		} else if (d.try) {
			const item = itemByName(d.try);
			if (item) {
				post({ type: 'tryItem', text: M.tryText(item.kind, item.name) });
			}
		} else if (d.delete) {
			post({ type: 'deleteItem', kind: section().id, name: d.delete, path: d.path });
		} else if (d.copy) {
			post({ type: 'copyItem', kind: section().id, name: d.copy });
		} else if (d.install) {
			const scope = $('cz-exScope') ? $('cz-exScope').value : 'user';
			t.disabled = true;
			t.textContent = 'Installing...';
			post({ type: 'installExample', id: d.install, scope: scope });
		} else if (d.act === 'new') {
			ui.newForm = true;
			ui.detail = null;
			render();
		} else if (d.act === 'cancelNew') {
			ui.newForm = false;
			render();
		} else if (d.act === 'examples') {
			openExamples();
		} else if (d.act === 'closeDialog') {
			closeDialog();
		} else if (d.act === 'back') {
			ui.detail = null;
			render();
		} else if (d.act === 'personalRules') {
			post({ type: 'openPersonalRules' });
		} else if (d.act === 'platforms') {
			post({ type: 'openPlatforms' });
		}
	});

	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') {
			if (!$('cz-dialog').hidden) {
				closeDialog();
			} else if (ui.newForm) {
				ui.newForm = false;
				render();
			} else if (ui.detail) {
				ui.detail = null;
				render();
			}
		}
	});

	window.addEventListener('message', function (event) {
		const m = event.data || {};
		switch (m.type) {
			case 'state':
				ui.data = m;
				if (!$('cz-dialog').hidden) {
					openExamples();
				}
				render();
				break;
			case 'reveal':
				if (m.section) {
					setSection(m.section);
				}
				if (m.startNew) {
					ui.newForm = true;
					render();
				}
				break;
			case 'detailBody':
				if (ui.detail && ui.detail.path === m.path) {
					ui.detailText = m.text;
					render();
				}
				break;
			case 'created':
				ui.newForm = false;
				ui.error = '';
				if (m.kind && KIND_OF[m.kind]) {
					ui.section = m.kind;
				}
				render();
				break;
			case 'deleted':
				ui.detail = null;
				render();
				break;
			case 'error':
				ui.error = String(m.message || 'Something went wrong.');
				if (!$('cz-dialog').hidden) {
					openExamples();
				}
				render();
				break;
		}
	});

	render();
	post({ type: 'ready' });
})();
