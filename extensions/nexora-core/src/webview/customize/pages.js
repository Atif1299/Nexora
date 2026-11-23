/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Customize (Phase 4): the Hooks and Plugins pages. customize.js owns the panel, navigation
// and dialogs, and hands these sections to the object this file builds.
(function (root) {
	'use strict';

	root.NexoraCustomizePages = function (ctx) {
		const M = ctx.M;
		const esc = ctx.esc;
		const ui = ctx.ui;
		const page = { pluginTab: 'installed', market: 'nexora', hookForm: false, focusForm: false, busy: '', expanded: '', pending: null };

		function data(key) {
			return ui.data ? ui.data[key] : undefined;
		}

		function busy(key, label, idle) {
			return page.busy === key ? ' disabled>' + esc(label) : '>' + esc(idle);
		}

		// --- Hooks -------------------------------------------------------------------------

		function hookForm() {
			const hasWs = !!data('hasWorkspace');
			const events = Object.keys(M.EVENT_INFO);
			return '<form class="nx-card cz-newForm" id="cz-hookForm" autocomplete="off">' +
				'<div class="cz-formTitle">New hook</div>' +
				'<label class="cz-field"><span>When</span><select class="nx-select" id="cz-hkEvent">' +
				events.map(function (e) { return '<option value="' + e + '">' + esc(M.EVENT_INFO[e].title) + ' (' + e + ')</option>'; }).join('') +
				'</select><span class="nx-hint" id="cz-hkEventHint">' + esc(M.EVENT_INFO[events[0]].desc) + '</span></label>' +
				'<label class="cz-field" id="cz-hkMatcherField"><span>Matcher <span class="nx-hint">(empty for all)</span></span>' +
				'<input class="nx-input cz-mono" id="cz-hkMatcher" placeholder="' + esc(M.EVENT_INFO[events[0]].hint) + '"></label>' +
				'<label class="cz-field"><span>Command</span><textarea class="nx-textarea cz-mono" id="cz-hkCommand" rows="3" ' +
				'placeholder="sh .nexora/hooks/check.sh" required></textarea>' +
				'<span class="nx-hint">Runs on this PC with your permissions, in ' + esc(data('hookShell') || 'your shell') +
				'. It gets the event as JSON on stdin.</span></label>' +
				'<label class="cz-field cz-inline"><span>Timeout</span><input class="nx-input cz-narrow" id="cz-hkTimeout" type="number" min="1" max="300" value="30"><span class="nx-hint">seconds</span></label>' +
				'<fieldset class="cz-scope"><legend>Where</legend>' +
				'<label><input type="radio" name="cz-hkScope" value="user" checked> You (all projects)</label>' +
				'<label' + (hasWs ? '' : ' class="cz-disabled" title="Open a folder first"') + '><input type="radio" name="cz-hkScope" value="project"' + (hasWs ? '' : ' disabled') + '> This project (.nexora/settings.json)</label>' +
				'</fieldset><div class="cz-formError" id="cz-hkError" role="alert"></div>' +
				'<div class="nx-row"><button type="submit" class="nx-btn">Add hook</button><button type="button" class="nx-btn nx-btn-ghost" data-hk="cancel">Cancel</button></div></form>';
		}

		function hookRow(h) {
			const matcher = M.hookMatcherLabel(h.event, h.matcher);
			const run = (h.recent_runs || [])[0];
			const runClass = !run ? '' : (run.blocked ? ' cz-runBlocked' : (run.exit_code === 0 ? ' cz-runOk' : ' cz-runBad'));
			const info = M.EVENT_INFO[h.event];
			return ctx.rowHtml({
				icon: 'zap',
				name: h.command,
				nameCls: 'cz-mono',
				source: [M.hookSourceLabel(h), info ? info.title : h.event, matcher].filter(Boolean).join(' - '),
				badges: (h.approved ? '' : '<span class="cz-chip cz-warnChip">Needs approval</span>') +
					'<span class="cz-usage' + runClass + '">' + esc(M.hookRunLabel(run)) + '</span>',
				actions: (h.approved ? '' : '<button type="button" class="nx-btn nx-btn-secondary" data-hk-approve="' + esc(h.id) + '">Approve</button>') +
					'<button type="button" class="nx-btn nx-btn-ghost" data-hk-test="' + esc(h.id) + '"' + busy('test:' + h.id, 'Running...', 'Test') + '</button>' +
					'<button type="button" class="nx-btn nx-btn-ghost" data-open-file="' + esc(h.file) + '">Open</button>' +
					(h.source === 'plugin' ? '' : '<button type="button" class="nx-btn nx-btn-ghost" data-hk-delete="' + esc(h.id) + '">Delete</button>')
			});
		}

		function renderHooks(s) {
			const list = data('hooks');
			let html = ctx.intro(s);
			if (!Array.isArray(list)) {
				return html + ctx.tooOld();
			}
			const shown = entries('hooks').filter(ctx.keep);
			const importBtn = '<button type="button" class="nx-btn nx-btn-ghost" data-hk="import"' + busy('import', 'Importing...', 'Import from Claude Code') + '</button>';
			if (list.length) {
				html += ctx.listHead('Installed', shown.length, importBtn + ctx.addButton('hooks'));
			}
			if (page.hookForm) {
				html += hookForm();
			}
			if (!list.length) {
				return html + ctx.invite('hooks', importBtn);
			}
			if (!shown.length) {
				return html + ctx.none();
			}
			html += '<p class="nx-hint cz-shellLine">Hooks run in ' + esc(data('hookShell') || 'your shell') + '. Project hooks run only after you approve them.</p>';
			Object.keys(M.EVENT_INFO).forEach(function (event) {
				const group = shown.filter(function (e) { return e.item.event === event; });
				if (!group.length) {
					return;
				}
				const info = M.EVENT_INFO[event];
				html += '<div class="cz-group"><div class="cz-groupTitle">' + esc(info.title) + ' <span class="nx-hint">' + esc(event) + ' - ' + esc(info.desc) + '</span></div>' +
					ctx.listOf(group.map(function (e) { return e.html; })) + '</div>';
			});
			return html;
		}

		function hookTestDialog(name, r) {
			const outcome = r.timed_out ? 'Timed out' : (r.blocked ? 'Blocked: ' + (r.reason || '') : (r.exit_code === 0 ? 'Allowed (exit 0)' : 'Exit ' + r.exit_code));
			return '<div class="cz-dialogBox"><header class="cz-dialogHead"><h2>Test run</h2><button type="button" class="nx-btn nx-btn-ghost" data-act="closeDialog">Close</button></header>' +
				'<p><code class="cz-command">' + esc(name) + '</code></p>' +
				'<div class="nx-card cz-meta"><div class="cz-metaRow"><span class="cz-metaLabel">Result</span><span class="' + (r.blocked || r.exit_code !== 0 ? 'cz-warn' : '') + '">' + esc(outcome) + '</span></div>' +
				'<div class="cz-metaRow"><span class="cz-metaLabel">Time</span><span>' + esc((r.duration_ms / 1000).toFixed(2)) + ' s</span></div>' +
				(r.error ? '<div class="cz-metaRow"><span class="cz-metaLabel">Error</span><span class="cz-warn">' + esc(r.error) + '</span></div>' : '') + '</div>' +
				'<div class="cz-previewTitle">stdout</div><pre class="cz-preview">' + esc(r.stdout || '(nothing)') + '</pre>' +
				'<div class="cz-previewTitle">stderr</div><pre class="cz-preview">' + esc(r.stderr || '(nothing)') + '</pre>' +
				'<p class="nx-hint">The hook got a sample event, like the real one it will see.</p></div>';
		}

		// --- Plugins -------------------------------------------------------------------------

		function contentsList(c) {
			const rows = [];
			const add = function (label, values) {
				if (values && values.length) {
					rows.push('<div class="cz-metaRow"><span class="cz-metaLabel">' + esc(label) + '</span><span>' + values.join('<br>') + '</span></div>');
				}
			};
			add('Commands', (c.commands || []).map(function (x) { return '<code>/' + esc(x) + '</code>'; }));
			add('Skills', (c.skills || []).map(esc));
			add('Subagents', (c.agents || []).map(esc));
			add('Recipes', (c.recipes || []).map(esc));
			add('Hooks', (c.hooks || []).map(function (h) {
				const matcher = M.hookMatcherLabel(h.event, h.matcher);
				return esc(h.event) + (matcher ? ' - ' + esc(matcher) : '') + ': <code class="cz-command">' + esc(h.command) + '</code>';
			}));
			add('MCP servers', (c.mcp_servers || []).map(function (sv) {
				// Every key and value a server reads is shown: a plugin could otherwise send a saved key anywhere.
				const keys = (sv.env_keys || []).concat(sv.header_keys || []);
				return esc(sv.name) + ': <code class="cz-command">' + esc(sv.url || sv.command) + '</code>' +
					(keys.length ? '<br><span class="nx-hint">Sets ' + keys.map(esc).join(', ') + '</span>' : '') +
					((sv.reads || []).length ? '<br><span class="cz-warn">Reads ' + sv.reads.map(esc).join(', ') + '</span>' : '');
			}));
			return rows.length ? '<div class="nx-card cz-meta">' + rows.join('') + '</div>' : '<p class="nx-hint">This plugin adds nothing.</p>';
		}

		function pluginRow(p) {
			const open = page.expanded === p.name;
			return ctx.rowHtml({
				icon: 'package',
				name: p.name,
				cls: p.enabled ? '' : 'cz-off',
				badges: (p.version ? '<span class="nx-hint">v' + esc(p.version) + '</span>' : '') + (p.enabled ? '' : '<span class="cz-chip">Off</span>'),
				source: [p.marketplace ? 'From ' + p.marketplace : 'Plugin', M.pluginContentsLabel(p.contents)].join(' - '),
				desc: p.description || '',
				more: (p.error ? '<span class="cz-problem">' + esc(p.error) + '</span>' : '') + (open ? contentsList(p.contents || {}) : ''),
				actions: '<label class="cz-switch" title="' + (p.enabled ? 'Turn off' : 'Turn on') + '"><input type="checkbox" data-pl-toggle="' + esc(p.name) + '"' + (p.enabled ? ' checked' : '') + '>' +
					'<span aria-hidden="true"></span><span class="cz-srOnly">' + esc(p.name) + ' on</span></label>' +
					'<button type="button" class="nx-btn nx-btn-ghost" data-pl-expand="' + esc(p.name) + '">' + (open ? 'Hide details' : 'Details') + '</button>' +
					'<button type="button" class="nx-btn nx-btn-ghost" data-pl-update="' + esc(p.name) + '"' + busy('update:' + p.name, 'Checking...', 'Update') + '</button>' +
					'<button type="button" class="nx-btn nx-btn-ghost" data-pl-remove="' + esc(p.name) + '">Remove</button>'
			});
		}

		function renderInstalled() {
			const all = entries('plugins');
			const shown = all.filter(ctx.keep);
			if (!all.length) {
				return ctx.invite('plugins');
			}
			return ctx.listHead('Installed', shown.length, ctx.addButton('plugins')) +
				(shown.length ? ctx.listOf(shown.map(function (e) { return e.html; })) : ctx.none());
		}

		function renderMarketplace() {
			const markets = data('marketplaces') || [];
			const market = markets.find(function (m) { return m.name === page.market; }) || markets[0];
			let html = '<div class="cz-marketBar" role="tablist" aria-label="Marketplaces">' + markets.map(function (m) {
				const on = market && m.name === market.name;
				return '<button type="button" role="tab" aria-selected="' + on + '" class="cz-filter' + (on ? ' cz-filterOn' : '') + '" data-pl-market="' + esc(m.name) + '">' +
					esc(m.builtin ? 'Nexora' : m.name) + ' <span class="nx-hint">' + m.plugins.length + '</span></button>';
			}).join('') + '</div>';
			if (!market) {
				return html + '<p class="nx-hint">No marketplaces.</p>';
			}
			html += '<div class="cz-marketHead"><p class="nx-hint">' + esc(market.description || market.source || '') + '</p><div class="nx-row">' +
				'<button type="button" class="nx-btn nx-btn-ghost" data-pl-refresh="' + esc(market.name) + '"' + busy('refresh:' + market.name, 'Refreshing...', 'Refresh') + '</button>' +
				(market.builtin ? '' : '<button type="button" class="nx-btn nx-btn-ghost" data-pl-unmarket="' + esc(market.name) + '">Remove marketplace</button>') + '</div></div>';
			if (market.error) {
				html += '<p class="cz-problem">' + esc(market.error) + '</p>';
			}
			// The search box at the top filters the marketplace too.
			const shown = market.plugins.filter(function (p) {
				return M.matches({ text: p.name + ' ' + p.description + ' ' + p.category }, ctx.ui.query, 'all');
			});
			html += shown.length ? '<div class="cz-cards">' + shown.map(function (p) {
				return '<article class="cz-card"><div class="cz-cardHead"><span class="cz-name">' + esc(p.name) + '</span>' +
					(p.category ? '<span class="cz-chip">' + esc(p.category) + '</span>' : '') + '</div>' +
					'<p class="cz-desc">' + esc(p.description) + '</p>' +
					'<p class="nx-hint">' + esc([p.version ? 'v' + p.version : '', p.author].filter(Boolean).join(' - ')) + '</p>' +
					'<div class="nx-row">' + (p.installed ? '<span class="cz-chip cz-origin-nexora">Installed</span>'
						: '<button type="button" class="nx-btn nx-btn-secondary" data-pl-install="' + esc(p.name) + '"' + busy('preview:' + p.name, 'Fetching...', 'Install') + '</button>') +
					'</div></article>';
			}).join('') + '</div>' : ctx.none();
			html += '<div class="nx-card cz-addMarket"><div class="cz-formTitle">Add a marketplace</div>' +
				'<div class="cz-inputRow"><input class="nx-input" id="cz-marketSource" placeholder="owner/repo, a git URL or a folder" aria-label="Marketplace source">' +
				'<button type="button" class="nx-btn nx-btn-secondary" data-pl="addMarket"' + busy('addMarket', 'Adding...', 'Add') + '</button></div>' +
				'<p class="nx-hint" id="cz-marketHint">Claude Code marketplaces work as they are. <button type="button" class="cz-link" data-pl-suggest="anthropics/claude-code">anthropics/claude-code</button></p>' +
				'<div class="cz-formTitle">Install from a URL or folder</div>' +
				'<div class="cz-inputRow"><input class="nx-input" id="cz-pluginSource" placeholder="owner/repo, a git URL or a folder with .claude-plugin/plugin.json" aria-label="Plugin source">' +
				'<button type="button" class="nx-btn nx-btn-secondary" data-pl="installSource"' + busy('preview:source', 'Fetching...', 'Preview') + '</button></div></div>';
			return html;
		}

		function renderPlugins(s) {
			let html = ctx.intro(s);
			if (!Array.isArray(data('plugins'))) {
				return html + ctx.tooOld();
			}
			html += '<div class="cz-tabs" role="tablist">' +
				'<button type="button" role="tab" aria-selected="' + (page.pluginTab === 'installed') + '" class="cz-tab' + (page.pluginTab === 'installed' ? ' cz-tabOn' : '') + '" data-pl-tab="installed">Installed</button>' +
				'<button type="button" role="tab" aria-selected="' + (page.pluginTab === 'marketplace') + '" class="cz-tab' + (page.pluginTab === 'marketplace' ? ' cz-tabOn' : '') + '" data-pl-tab="marketplace">Marketplace</button></div>';
			return html + (page.pluginTab === 'installed' ? renderInstalled() : renderMarketplace());
		}

		function previewDialog(p) {
			const updating = p.installed;
			return '<div class="cz-dialogBox"><header class="cz-dialogHead"><h2>' + (updating ? 'Update ' : 'Install ') + esc(p.name) +
				(p.version ? ' <span class="nx-hint">v' + esc(p.version) + '</span>' : '') + '</h2>' +
				'<button type="button" class="nx-btn nx-btn-ghost" data-act="closeDialog">Cancel</button></header>' +
				'<p>' + esc(p.description || '') + '</p>' + (p.author ? '<p class="nx-hint">By ' + esc(p.author) + '</p>' : '') +
				'<div class="cz-previewTitle">What it adds</div>' + contentsList(p.contents || {}) +
				((p.contents && ((p.contents.hooks || []).length || (p.contents.mcp_servers || []).length))
					? '<p class="cz-warn">Its hooks and MCP servers run on this PC with your permissions. Install only plugins you trust.</p>' : '') +
				'<div class="nx-row"><button type="button" class="nx-btn" data-pl-confirm="' + esc(p.token) + '"' + busy('install', 'Installing...', updating ? 'Update' : 'Install') + '</button>' +
				'<button type="button" class="nx-btn nx-btn-ghost" data-act="closeDialog">Cancel</button></div></div>';
		}

		// --- events ----------------------------------------------------------------------------

		function bindForm() {
			const form = document.getElementById('cz-hookForm');
			if (!form) {
				return;
			}
			const event = document.getElementById('cz-hkEvent');
			const sync = function () {
				const info = M.EVENT_INFO[event.value];
				document.getElementById('cz-hkEventHint').textContent = info.desc;
				document.getElementById('cz-hkMatcherField').hidden = !info.matcher;
				document.getElementById('cz-hkMatcher').placeholder = info.hint;
			};
			event.addEventListener('change', sync);
			sync();
			form.addEventListener('submit', function (e) {
				e.preventDefault();
				const command = document.getElementById('cz-hkCommand').value.trim();
				if (!command) {
					document.getElementById('cz-hkError').textContent = 'Enter the command the hook runs.';
					return;
				}
				const scope = document.querySelector('input[name="cz-hkScope"]:checked');
				ctx.post({ type: 'newHook', event: event.value, matcher: M.EVENT_INFO[event.value].matcher ? document.getElementById('cz-hkMatcher').value.trim() : '',
					command: command, timeout: Number(document.getElementById('cz-hkTimeout').value) || 30, scope: scope ? scope.value : 'user' });
				page.hookForm = false;
			});
			// Only when the form opens: a refresh while typing elsewhere must not steal focus.
			if (page.focusForm) {
				document.getElementById('cz-hkCommand').focus();
			}
			page.focusForm = false;
		}

		function bindSource() {
			const source = document.getElementById('cz-marketSource');
			if (source) {
				source.addEventListener('input', function () {
					const hint = M.marketplaceSourceHint(source.value);
					document.getElementById('cz-marketHint').textContent = hint ? hint : 'Claude Code marketplaces work as they are.';
				});
			}
		}

		function start(key, message) {
			page.busy = key;
			ctx.render();
			ctx.post(message);
		}

		/** Rows for the overview, the search and the chip count: { item, text, scope, origin, html }. */
		function entries(id) {
			const list = data(id);
			if (!Array.isArray(list)) {
				return [];
			}
			if (id === 'hooks') {
				return list.map(function (h) {
					const info = M.EVENT_INFO[h.event];
					return { item: h, text: h.command + ' ' + h.event + ' ' + (info ? info.title : '') + ' ' + (h.matcher || ''),
						scope: h.source === 'project' ? 'project' : 'user', origin: '', html: hookRow(h) };
				});
			}
			return list.map(function (p) {
				return { item: p, text: p.name + ' ' + (p.description || ''), scope: 'user', origin: '', html: pluginRow(p) };
			});
		}

		return {
			entries: entries,
			render: function (s) {
				return s.id === 'hooks' ? renderHooks(s) : renderPlugins(s);
			},
			afterRender: function () {
				bindForm();
				bindSource();
			},
			reveal: function (sub) {
				if (sub === 'marketplace' || sub === 'installed') {
					page.pluginTab = sub;
				}
				if (sub === 'new') {
					page.hookForm = true;
					page.focusForm = true;
				}
			},
			/** Handles a click on this page's controls; returns whether it did. */
			click: function (t) {
				const d = t.dataset;
				if (d.hk === 'cancel') {
					page.hookForm = false;
					ctx.render();
				} else if (d.hk === 'import') {
					start('import', { type: 'importHooks' });
				} else if (d.hkTest) {
					start('test:' + d.hkTest, { type: 'testHook', id: d.hkTest });
				} else if (d.hkApprove) {
					ctx.post({ type: 'approveHook', id: d.hkApprove });
				} else if (d.hkDelete) {
					ctx.post({ type: 'deleteHook', id: d.hkDelete });
				} else if (d.plTab) {
					page.pluginTab = d.plTab;
					ctx.render();
				} else if (d.plMarket) {
					page.market = d.plMarket;
					ctx.render();
				} else if (d.plExpand) {
					page.expanded = page.expanded === d.plExpand ? '' : d.plExpand;
					ctx.render();
				} else if (d.plInstall) {
					start('preview:' + d.plInstall, { type: 'previewPlugin', marketplace: page.market, plugin: d.plInstall });
				} else if (d.pl === 'installSource') {
					const value = (document.getElementById('cz-pluginSource') || {}).value || '';
					if (value.trim()) {
						start('preview:source', { type: 'previewPlugin', source: value.trim() });
					}
				} else if (d.plConfirm) {
					start('install', { type: 'installPlugin', token: d.plConfirm });
				} else if (d.plUpdate) {
					start('update:' + d.plUpdate, { type: 'updatePlugin', name: d.plUpdate });
				} else if (d.plRemove) {
					ctx.post({ type: 'removePlugin', name: d.plRemove });
				} else if (d.pl === 'addMarket') {
					const value = (document.getElementById('cz-marketSource') || {}).value || '';
					if (value.trim()) {
						start('addMarket', { type: 'addMarketplace', source: value.trim() });
					}
				} else if (d.plSuggest) {
					const input = document.getElementById('cz-marketSource');
					input.value = d.plSuggest;
					input.dispatchEvent(new Event('input'));
					input.focus();
				} else if (d.plRefresh) {
					start('refresh:' + d.plRefresh, { type: 'refreshMarketplace', name: d.plRefresh });
				} else if (d.plUnmarket) {
					ctx.post({ type: 'removeMarketplace', name: d.plUnmarket });
				} else {
					return false;
				}
				return true;
			},
			change: function (t) {
				if (t.dataset && t.dataset.plToggle) {
					ctx.post({ type: 'enablePlugin', name: t.dataset.plToggle, enabled: t.checked });
					return true;
				}
				return false;
			},
			/** Handles a host message for these pages; returns whether it did. */
			message: function (m) {
				if (m.type === 'hookTestResult') {
					page.busy = '';
					ctx.showDialog('hookTest', hookTestDialog(m.command || '', m.result || {}));
				} else if (m.type === 'pluginPreview') {
					page.busy = '';
					page.pending = m.preview;
					ctx.showDialog('pluginPreview', previewDialog(m.preview));
				} else if (m.type === 'pluginInstalled') {
					page.busy = '';
					page.pending = null;
					page.pluginTab = 'installed';
					page.expanded = m.name || '';
					ctx.closeDialog();
				} else if (m.type === 'marketplaceAdded') {
					page.busy = '';
					page.market = m.name || page.market;
					page.pluginTab = 'marketplace';
				} else if (m.type === 'done' || m.type === 'error') {
					page.busy = '';
					if (m.type === 'error' && ctx.dialog() === 'pluginPreview' && page.pending) {
						ctx.showDialog('pluginPreview', previewDialog(page.pending));
					}
					return m.type === 'done';
				} else {
					return false;
				}
				ctx.render();
				return true;
			}
		};
	};
})(this);
