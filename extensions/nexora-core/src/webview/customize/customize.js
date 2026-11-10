/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Customize tab: one search across every kind, a scope menu and a chip per kind (plugins,
// platforms, skills, agents, recipes, commands, hooks, rules); no chip is the All overview.
// The Hooks and Plugins pages live in pages.js, Agents extras and Recipes in orchestration.js.
(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const M = window.NexoraCustomizeModel;
	const KIND_OF = { skills: 'skill', agents: 'agent', commands: 'command' };
	const ITEM_SECTIONS = ['skills', 'agents', 'commands'];
	const PAGE_SECTIONS = ['hooks', 'plugins'];
	const OVERVIEW_ROWS = 4;
	const SEARCH_ROWS = 8;

	const ui = {
		section: '',
		query: '',
		scope: 'all',
		scopeMenu: false,
		detail: null,
		detailText: null,
		newForm: false,
		focusForm: false,
		error: '',
		dialog: '',
		data: null
	};
	const ctx = {
		M: M, esc: esc, ui: ui, post: post, intro: intro, tooOld: tooOld, render: render, reveal: reveal,
		showDialog: showDialog, closeDialog: closeDialog, dialog: function () { return ui.dialog; },
		keep: keep, rowHtml: rowHtml, listHead: listHead, listOf: listOf, invite: invite, none: none, addButton: addButton
	};
	const Pages = window.NexoraCustomizePages(ctx);
	const Orch = window.NexoraCustomizeOrchestration(ctx);

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

	function sectionOf(id) {
		return M.SECTIONS.find(function (s) { return s.id === id; }) || null;
	}

	/** The selected chip, or null for the All overview. */
	function section() {
		return sectionOf(ui.section);
	}

	function items(id) {
		return (ui.data && Array.isArray(ui.data[id])) ? ui.data[id] : [];
	}

	// --- rows shared by every kind ----------------------------------------------------------

	/** Whether a row passes the search and the scope menu. entry: { text, scope, origin }. */
	function keep(entry) {
		return M.matches(entry, ui.query, ui.scope);
	}

	/**
	 * One list row: an icon tile, the name, a muted source line and the actions on the right.
	 * o: { icon, name, source, desc, open (attributes that make the row a button), badges, more, cls, nameCls, actions }
	 */
	function rowHtml(o) {
		const tag = o.open ? 'button' : 'div';
		const line = [o.source, o.desc].filter(Boolean).join(' - ');
		return '<div class="cz-row' + (o.cls ? ' ' + o.cls : '') + '" role="listitem">' +
			'<' + tag + (o.open ? ' type="button" ' + o.open : '') + ' class="cz-rowMain">' +
			'<span class="cz-icon" aria-hidden="true"><i class="codicon codicon-' + o.icon + '"></i></span>' +
			'<span class="cz-rowText"><span class="cz-rowTop"><span class="cz-name' + (o.nameCls ? ' ' + o.nameCls : '') + '">' + esc(o.name) + '</span>' + (o.badges || '') + '</span>' +
			(line ? '<span class="cz-source" title="' + esc(line) + '">' + esc(line) + '</span>' : '') + (o.more || '') + '</span></' + tag + '>' +
			(o.actions ? '<span class="cz-rowActions">' + o.actions + '</span>' : '') + '</div>';
	}

	function listOf(rows) {
		return '<div class="cz-list" role="list">' + rows.join('') + '</div>';
	}

	/** "Installed 3" with the kind's actions on the right. */
	function listHead(title, count, actions) {
		return '<div class="cz-listHead"><h2 class="cz-listTitle">' + esc(title) + (count === undefined ? '' : ' <span class="cz-count">' + count + '</span>') + '</h2>' +
			(actions ? '<div class="cz-headActions">' + actions + '</div>' : '') + '</div>';
	}

	/** Each kind's one way to add something: [attributes, label, codicon]. */
	function addSpec(id) {
		const hasWs = !!(ui.data && ui.data.hasWorkspace);
		switch (id) {
			case 'plugins': return ['data-reveal="plugins:marketplace"', 'Add plugin', 'add'];
			case 'platforms': return ['data-act="platforms"', 'Open Platforms', 'link-external'];
			case 'recipes': return ['data-rc="import"', 'Import recipe', 'add'];
			case 'rules': return hasWs ? ['data-reveal="rules:new"', 'New rule', 'add'] : ['data-act="personalRules"', 'Personal rules', 'edit'];
			default: return ['data-reveal="' + id + ':new"', 'New ' + sectionOf(id).singular, 'add'];
		}
	}

	function addButton(id) {
		const spec = addSpec(id);
		return '<button type="button" class="nx-btn nx-btn-secondary" ' + spec[0] + '><i class="codicon codicon-' + spec[2] + '" aria-hidden="true"></i> ' + esc(spec[1]) + '</button>';
	}

	/** What a kind with no items shows: one line on what it is for, and its add action (extra: one more button). */
	function invite(id, extra) {
		const s = sectionOf(id);
		return '<div class="cz-invite"><span class="cz-icon" aria-hidden="true"><i class="codicon codicon-' + s.icon + '"></i></span>' +
			'<span class="cz-inviteText">' + esc(s.invite) + '</span>' + (typeof extra === 'string' ? extra : '') + addButton(id) + '</div>';
	}

	/** The line shown when the search or the scope menu hides every row. */
	/** Why a list is empty: the search, the scope menu, or (neither) emptyText. */
	function none(emptyText) {
		const q = ui.query.trim();
		if (q) {
			return '<p class="nx-hint cz-none">No matches for "' + esc(q) + '"</p>';
		}
		const scope = M.SCOPES.find(function (s) { return s.id === ui.scope; });
		if (emptyText && (!scope || scope === M.SCOPES[0])) {
			return '<p class="nx-hint cz-none">' + esc(emptyText) + '</p>';
		}
		return '<p class="nx-hint cz-none">Nothing here from ' + esc(scope ? scope.label : ui.scope) + '.</p>';
	}

	/** A kind page's opening line, and the last error. */
	function intro(s) {
		return '<p class="nx-hint cz-blurb">' + esc(s.blurb) + '</p>' +
			(ui.error ? '<div class="nx-banner cz-error" role="alert">' + esc(ui.error) + '</div>' : '');
	}

	function tooOld() {
		return '<div class="nx-empty"><div class="nx-empty-title">This engine is too old for Customize.</div>' +
			'<p class="nx-hint">Restart Nexora after updating, and skills, subagents and commands appear here.</p></div>';
	}

	function originChip(item) {
		return '<span class="cz-chip cz-origin-' + esc(item.origin) + '">' + esc(M.originLabel(item.origin)) + '</span>';
	}

	// --- what each kind lists --------------------------------------------------------------

	function itemRow(item) {
		const hidden = !!item.shadowed_by;
		const kind = item.kind + 's';
		const source = [item.scope === 'project' ? 'This project' : 'You', item.origin === 'nexora' ? '' : M.originLabel(item.origin),
			item.usage && item.usage.count ? M.usageLabel(item.usage) : ''].filter(Boolean).join(' - ');
		return rowHtml({
			icon: sectionOf(kind).icon,
			name: item.kind === 'command' ? '/' + item.name : item.name,
			source: source,
			desc: item.description || 'No description',
			open: 'data-open-detail="' + esc(item.name) + '" data-path="' + esc(item.path) + '" data-kind="' + kind + '"',
			cls: hidden ? 'cz-hidden' : '',
			badges: hidden ? '<span class="cz-chip">Hidden</span>' : '',
			more: (hidden ? '<span class="cz-hiddenBy">Hidden by ' + esc(item.shadowed_by) + '</span>' : '') +
				(item.problems || []).map(function (p) { return '<span class="cz-problem">' + esc(p) + '</span>'; }).join(''),
			actions: (hidden ? '' : '<button type="button" class="nx-btn nx-btn-ghost" data-try="' + esc(item.name) + '" data-kind="' + kind + '" title="Put it in the chat">Try</button>') +
				'<button type="button" class="nx-btn nx-btn-ghost" data-open-file="' + esc(item.path) + '">Open</button>'
		});
	}

	function itemEntry(item) {
		return { item: item, text: item.name + ' ' + (item.description || ''), scope: item.scope, origin: item.origin, html: itemRow(item) };
	}

	function ruleEntries() {
		const rules = ui.data && ui.data.rules;
		const files = rules && Array.isArray(rules.files) ? rules.files : [];
		const size = function (f) { return Number(f.chars).toLocaleString() + ' chars' + (f.truncated ? ', cut to fit' : ''); };
		return files.map(function (f) {
			return f.personal
				? { text: 'personal rules ' + rules.personal_path, scope: 'user', html: rowHtml({ icon: 'law', name: 'Personal rules', source: 'You, all projects - ' + size(f), open: 'data-act="personalRules"' }) }
				: { text: f.path, scope: 'project', html: rowHtml({ icon: 'law', name: f.path, nameCls: 'cz-mono', source: 'This project - ' + size(f), open: 'data-rule="' + esc(f.path) + '"' }) };
		});
	}

	function platformEntries() {
		const open = 'data-act="platforms" title="Open Platforms"';
		const servers = (ui.data && ui.data.mcpServers || []).map(function (sv) {
			return { group: 'servers', text: sv.name + ' ' + (sv.url || sv.command || ''), scope: sv.scope === 'project' ? 'project' : 'user',
				html: rowHtml({ icon: 'plug', name: sv.name, source: M.serverSource(sv), desc: sv.url || sv.command || '', open: open, cls: sv.state === 'connected' ? '' : 'cz-off' }) };
		});
		const platforms = (ui.data && ui.data.connectedPlatforms || []).map(function (p) {
			return { group: 'platforms', text: p.name + ' ' + p.id, scope: 'user',
				html: rowHtml({ icon: 'plug', name: p.name, source: ['Connected'].concat((p.usableIn || []).length ? ['works in ' + p.usableIn.join(', ')] : []).join(' - '), open: open }) };
		});
		return servers.concat(platforms);
	}

	/** Every row of a kind, as the overview, the search and the chip count see them. */
	function entries(id) {
		if (ITEM_SECTIONS.indexOf(id) >= 0) {
			const own = items(id).filter(function (i) { return !i.shadowed_by; }).map(itemEntry);
			return id === 'agents' ? own.concat(Orch.agentEntries()) : own;
		}
		if (id === 'recipes') {
			return Orch.recipeEntries();
		}
		if (PAGE_SECTIONS.indexOf(id) >= 0) {
			return Pages.entries(id);
		}
		return id === 'rules' ? ruleEntries() : platformEntries();
	}

	function count(id) {
		return entries(id).filter(function (e) { return M.matches(e, '', ui.scope); }).length;
	}

	// --- top bar: scope menu and chips -------------------------------------------------------

	function renderChips() {
		const scope = M.SCOPES.find(function (s) { return s.id === ui.scope; }) || M.SCOPES[0];
		let html = '<div class="cz-scopeWrap"><button type="button" class="cz-chipBtn' + (ui.scope === 'all' ? '' : ' cz-chipOn') + '" data-act="scopeMenu" aria-haspopup="menu" aria-expanded="' + ui.scopeMenu + '" title="Whose items to show">' +
			esc(scope.label) + ' <i class="codicon codicon-chevron-down" aria-hidden="true"></i></button>';
		if (ui.scopeMenu) {
			html += '<div class="cz-menu" role="menu">' + M.SCOPES.map(function (s) {
				return '<button type="button" class="cz-menuItem" role="menuitemradio" aria-checked="' + (s.id === ui.scope) + '" data-scope="' + s.id + '">' +
					'<i class="codicon codicon-check" aria-hidden="true"></i>' + esc(s.label) + '</button>';
			}).join('') + '</div>';
		}
		html += '</div>' + M.SECTIONS.map(function (s) {
			const on = s.id === ui.section;
			return '<button type="button" class="cz-chipBtn' + (on ? ' cz-chipOn' : '') + '" data-section="' + s.id + '" aria-pressed="' + on + '">' +
				esc(s.title) + (ui.data ? ' <span class="cz-count">' + count(s.id) + '</span>' : '') + '</button>';
		}).join('');
		// Redrawing the chips must not drop the keyboard user's place.
		const active = document.activeElement;
		const box = $('cz-chips');
		const again = active && box.contains(active) ? ['section', 'scope', 'act'].map(function (k) {
			return active.dataset[k] ? '[data-' + k + '="' + active.dataset[k] + '"]' : '';
		}).filter(Boolean)[0] : '';
		box.innerHTML = html;
		const target = again ? box.querySelector(again) : null;
		if (target) {
			target.focus();
		}
	}

	// --- New form --------------------------------------------------------------------------

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

	// --- pages -----------------------------------------------------------------------------

	function renderOverview() {
		const searching = !!ui.query.trim();
		let html = ui.error ? '<div class="nx-banner cz-error" role="alert">' + esc(ui.error) + '</div>' : '';
		if (!ui.data.engine) {
			html += tooOld();
		}
		let shownKinds = 0;
		const empty = [];
		M.SECTIONS.forEach(function (s) {
			const all = entries(s.id);
			const shown = all.filter(keep);
			if (!shown.length) {
				if (!all.length) {
					empty.push(s.id);
				}
				return;
			}
			shownKinds++;
			html += '<section class="cz-sec" aria-label="' + esc(s.title) + '">' +
				listHead(s.title, shown.length, '<button type="button" class="nx-btn nx-btn-ghost" data-section="' + s.id + '">See all</button>' + addButton(s.id)) +
				listOf(shown.slice(0, searching ? SEARCH_ROWS : OVERVIEW_ROWS).map(function (e) { return e.html; })) + '</section>';
		});
		if (!shownKinds && (searching || ui.scope !== 'all')) {
			return html + none();
		}
		if (!searching && ui.scope === 'all' && empty.length) {
			html += '<section class="cz-sec" aria-label="Get started">' + listHead('Get started') +
				'<div class="cz-list">' + empty.map(invite).join('') + '</div></section>';
		}
		return html;
	}

	function renderItems(s) {
		let html = intro(s);
		if (!ui.data.engine) {
			return html + tooOld();
		}
		const all = items(s.id);
		const shown = all.map(itemEntry).filter(keep);
		// This project's items first: they win over yours with the same name.
		shown.sort(function (a, b) { return (a.scope === 'project' ? 0 : 1) - (b.scope === 'project' ? 0 : 1); });
		const examples = '<button type="button" class="nx-btn nx-btn-ghost" data-act="examples">Examples</button>';
		if (all.length) {
			html += listHead(s.id === 'agents' ? 'Your subagents' : 'Your ' + s.title.toLowerCase(), shown.length, examples + addButton(s.id));
		}
		if (ui.newForm) {
			html += newForm(s);
		}
		if (!all.length) {
			return html + invite(s.id, examples);
		}
		return html + (shown.length ? listOf(shown.map(function (e) { return e.html; })) : none());
	}

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
			'<button type="button" class="nx-btn nx-btn-ghost cz-back" data-act="back"><i class="codicon codicon-chevron-left" aria-hidden="true"></i> ' + esc(s.title) + '</button>' +
			'<header class="cz-head"><div><h1>' + esc(kind === 'command' ? '/' + item.name : item.name) + ' ' + originChip(item) + '</h1>' +
			'<p>' + (item.description ? esc(item.description) : '<em>No description</em>') + '</p></div>' +
			'<div class="cz-headActions">' +
			(item.shadowed_by ? '' : '<button type="button" class="nx-btn" data-try="' + esc(item.name) + '" data-kind="' + s.id + '">Try in chat</button>') +
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

	function renderRules(s) {
		let html = intro(s);
		const rules = ui.data.rules;
		if (!rules) {
			return html + '<p class="nx-hint">The engine is not reachable, so the rules could not be read.</p>';
		}
		const hasWs = !!ui.data.hasWorkspace;
		const files = Array.isArray(rules.files) ? rules.files : [];
		const personal = files.find(function (f) { return f.personal; });
		const all = ruleEntries();
		const shown = all.filter(keep);
		const personalBtn = hasWs ? '<button type="button" class="nx-btn nx-btn-ghost" data-act="personalRules">' +
			(personal ? 'Edit personal rules' : 'Create personal rules') + '</button>' : '';
		if (all.length) {
			html += listHead('Rules', shown.length, personalBtn + addButton('rules'));
		}
		if (ui.newForm && hasWs) {
			html += newForm(s);
		}
		html += !all.length ? invite('rules', personalBtn) : (shown.length ? listOf(shown.map(function (e) { return e.html; })) : none());
		if (!hasWs) {
			html += '<p class="nx-hint">Open a folder to add project rules: AGENTS.md, CLAUDE.md or files in .nexora/rules/.</p>';
		}
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
		let html = intro(s);
		const all = platformEntries();
		if (!all.length) {
			return html + invite('platforms');
		}
		const shown = all.filter(keep);
		const servers = shown.filter(function (e) { return e.group === 'servers'; });
		const platforms = shown.filter(function (e) { return e.group === 'platforms'; });
		html += listHead('Your MCP servers', servers.length, addButton('platforms'));
		html += servers.length ? listOf(servers.map(function (e) { return e.html; })) : none('None yet. Add one by web address or as a command on this PC.');
		if (platforms.length) {
			html += listHead('Connected platforms', platforms.length) + listOf(platforms.map(function (e) { return e.html; }));
		}
		return html;
	}

	// --- examples dialog ---------------------------------------------------------------------

	function openExamples() {
		const examples = (ui.data && ui.data.examples) || [];
		const hasWs = !!(ui.data && ui.data.hasWorkspace);
		const kinds = [['agent', 'Subagents'], ['skill', 'Skills'], ['command', 'Commands']];
		const current = KIND_OF[ui.section];
		kinds.sort(function (a, b) { return (b[0] === current) - (a[0] === current); });
		showDialog('examples', '<div class="cz-dialogBox"><header class="cz-dialogHead"><h2>Examples</h2><button type="button" class="nx-btn nx-btn-ghost" data-act="closeDialog" aria-label="Close">Close</button></header>' +
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
					return '<div class="cz-exRow"><div><div class="cz-name">' + esc(k[0] === 'command' ? '/' + e.name : e.name) + '</div><div class="nx-hint">' + esc(e.description) + '</div>' +
						(done.length ? '<div class="nx-hint">Installed for ' + esc(done.join(' and ')) + '</div>' : '') + '</div>' +
						'<button type="button" class="nx-btn nx-btn-secondary" data-install="' + esc(e.id) + '">Install</button></div>';
				}).join('');
			}).join('') + '</div>');
	}

	/** One dialog at a time; ui.dialog says which, so a refresh redraws the right one. */
	function showDialog(kind, html) {
		const box = $('cz-dialog');
		box.innerHTML = html;
		box.hidden = false;
		ui.dialog = kind;
		const first = box.querySelector('.cz-dialogBox [data-install], .cz-dialogBox .nx-btn:not(.nx-btn-ghost), .cz-dialogBox button');
		if (first) {
			first.focus();
		}
	}

	function closeDialog() {
		$('cz-dialog').hidden = true;
		$('cz-dialog').innerHTML = '';
		ui.dialog = '';
	}

	// --- render ------------------------------------------------------------------------------

	/** Redraws the chips and the page. The search box is never redrawn, so typing keeps its focus. */
	function render() {
		renderChips();
		const main = $('cz-main');
		if (!ui.data) {
			main.innerHTML = '<div class="nx-hint">Loading...</div>';
			return;
		}
		const s = section();
		if (!s) {
			main.innerHTML = renderOverview();
			return;
		}
		if (s.id === 'recipes') {
			main.innerHTML = Orch.render(s);
			return;
		}
		if (PAGE_SECTIONS.indexOf(s.id) >= 0) {
			main.innerHTML = Pages.render(s);
			Pages.afterRender();
			return;
		}
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
			main.innerHTML = renderItems(s) + (s.id === 'agents' && ui.data.engine ? Orch.agentsExtra() : '');
		}
		const form = $('cz-newForm');
		if (form) {
			form.addEventListener('submit', submitNew);
			// Only when the form opens: a refresh while typing elsewhere must not steal focus.
			if (ui.focusForm) {
				$('cz-newName').focus();
			}
		}
		ui.focusForm = false;
	}

	/** Chooses a chip ('' for the All overview) without drawing; the search text stays. */
	function select(id) {
		ui.section = sectionOf(id) ? id : '';
		ui.detail = null;
		ui.newForm = false;
		ui.error = '';
	}

	function setSection(id) {
		select(id);
		render();
	}

	/** 'plugins:marketplace', 'hooks:new' or 'skills:new' opens a chip with its tab or form. */
	function reveal(where) {
		const parts = String(where).split(':');
		select(parts[0]);
		if (PAGE_SECTIONS.indexOf(ui.section) >= 0) {
			Pages.reveal(parts[1] || '');
		} else if (parts[1] === 'new' && ui.section) {
			ui.newForm = true;
			ui.focusForm = true;
		}
		render();
	}

	function itemByName(kind, name) {
		return items(kind).find(function (i) { return i.name === name && !i.shadowed_by; })
			|| items(kind).find(function (i) { return i.name === name; });
	}

	function closeScopeMenu(focusButton) {
		ui.scopeMenu = false;
		renderChips();
		if (focusButton) {
			$('cz-chips').querySelector('[data-act="scopeMenu"]').focus();
		}
	}

	$('cz-search').addEventListener('input', function (e) {
		ui.query = e.target.value;
		render();
	});

	document.addEventListener('click', function (e) {
		if (ui.scopeMenu && !e.target.closest('.cz-scopeWrap')) {
			closeScopeMenu(false);
		}
		const t = e.target.closest('button, [data-act]');
		if (!t) {
			return;
		}
		const d = t.dataset;
		if (Pages.click(t) || Orch.click(t)) {
			return;
		}
		if (d.reveal) {
			reveal(d.reveal);
		} else if (d.act === 'scopeMenu') {
			ui.scopeMenu = !ui.scopeMenu;
			renderChips();
			const current = $('cz-chips').querySelector('.cz-menuItem[aria-checked="true"]');
			if (current) {
				current.focus();
			}
		} else if (d.scope) {
			ui.scope = d.scope;
			ui.scopeMenu = false;
			render();
			$('cz-chips').querySelector('[data-act="scopeMenu"]').focus();
		} else if (d.section !== undefined) {
			// A selected chip, clicked again, goes back to the All overview.
			setSection(d.section === ui.section && t.closest('#cz-chips') ? '' : d.section);
		} else if (d.openDetail !== undefined) {
			select(d.kind);
			ui.detail = { name: d.openDetail, path: d.path };
			ui.detailText = null;
			post({ type: 'detailRequest', path: d.path });
			render();
		} else if (d.openFile) {
			post({ type: 'openFile', path: d.openFile });
		} else if (d.rule) {
			post({ type: 'openRule', path: d.rule });
		} else if (d.try) {
			const item = itemByName(d.kind, d.try);
			if (item) {
				post({ type: 'tryItem', text: M.tryText(item.kind, item.name) });
			}
		} else if (d.delete) {
			post({ type: 'deleteItem', kind: ui.section, name: d.delete, path: d.path });
		} else if (d.copy) {
			post({ type: 'copyItem', kind: ui.section, name: d.copy });
		} else if (d.install) {
			const scope = $('cz-exScope') ? $('cz-exScope').value : 'user';
			t.disabled = true;
			t.textContent = 'Installing...';
			post({ type: 'installExample', id: d.install, scope: scope });
		} else if (d.act === 'new') {
			ui.newForm = true;
			ui.focusForm = true;
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

	document.addEventListener('change', function (e) {
		Pages.change(e.target);
	});

	document.addEventListener('keydown', function (e) {
		if (e.key !== 'Escape') {
			return;
		}
		if (!$('cz-dialog').hidden) {
			closeDialog();
		} else if (ui.scopeMenu) {
			closeScopeMenu(true);
		} else if (ui.newForm) {
			ui.newForm = false;
			render();
		} else if (ui.detail) {
			ui.detail = null;
			render();
		}
	});

	window.addEventListener('message', function (event) {
		const m = event.data || {};
		// Orch first: it also needs to see 'done' and 'error', which Pages may claim.
		if (Orch.message(m) || Pages.message(m)) {
			return;
		}
		switch (m.type) {
			case 'state':
				ui.data = m;
				if (ui.dialog === 'examples') {
					openExamples();
				}
				render();
				break;
			case 'reveal':
				if (m.section) {
					reveal(String(m.section).indexOf(':') < 0 && m.startNew ? m.section + ':new' : m.section);
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
				if (ui.dialog === 'examples') {
					openExamples();
				}
				render();
				break;
		}
	});

	render();
	post({ type: 'ready' });
})();
