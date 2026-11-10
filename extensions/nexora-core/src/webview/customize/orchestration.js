/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Customize (Phase 5): what plans can use. The Agents page adds coding agents and remote (A2A)
// agents under the subagents list; the Recipes page lists plans saved for reuse. customize.js
// owns the panel and dialogs and hands these parts to the object this file builds.
(function (root) {
	'use strict';

	const LOCAL_ORDER = ['claude-code', 'cursor', 'cline'];

	root.NexoraCustomizeOrchestration = function (ctx) {
		const M = ctx.M;
		const esc = ctx.esc;
		const ui = ctx.ui;
		const page = { busy: '', card: null, cardError: '', recipe: null, answer: null };

		function data(key) {
			return ui.data ? ui.data[key] : undefined;
		}

		function busy(key, label, idle) {
			return page.busy === key ? ' disabled>' + esc(label) : '>' + esc(idle);
		}

		function start(key, message) {
			page.busy = key;
			ctx.render();
			ctx.post(message);
		}

		function learned(summary) {
			const text = M.learnedLabel(summary);
			return text ? '<span class="cz-usage" title="Plans order agents and routes by what worked before">' + esc(text) + '</span>' : '';
		}

		// --- Agents page: coding agents and remote agents ---------------------------------------

		function localRow(a) {
			return '<div class="cz-row" role="listitem"><div class="cz-rowMain cz-static">' +
				'<span class="cz-rowTop"><span class="cz-name">' + esc(a.name) + '</span>' +
				(a.installed ? '<span class="cz-chip cz-okChip">Installed</span>' : '<span class="cz-chip">Not installed</span>') +
				'<span class="cz-chip">Plans</span>' + learned(a.learned) + '</span>' +
				'<span class="cz-desc">' + (a.installed
					? 'Plans can hand it a code step. It works in its own git worktree; its changes come back as a diff.'
					: 'Install it to let plans hand it code steps: <code>' + esc(a.install_hint) + '</code>') + '</span></div>' +
				'<span class="cz-rowActions">' +
				(a.installed ? '' : '<button type="button" class="nx-btn nx-btn-secondary" data-ag-copy="' + esc(a.install_hint) + '">Copy install command</button>') +
				'<button type="button" class="nx-btn nx-btn-ghost" data-ag-docs="' + esc(a.docs_url) + '">Docs</button></span></div>';
		}

		function remoteRow(a) {
			const skills = (a.skills || []).map(function (s) { return s.name || s.id; }).filter(Boolean);
			return '<div class="cz-row" role="listitem"><div class="cz-rowMain cz-static">' +
				'<span class="cz-rowTop"><span class="cz-name">' + esc(a.title || a.name) + '</span>' +
				'<span class="cz-chip">' + (a.protocol === 'nexora' ? 'Nexora A2A' : 'A2A') + '</span>' +
				(a.has_token ? '<span class="cz-chip">Token saved</span>' : (a.needs_token ? '<span class="cz-chip cz-warnChip">Needs a token</span>' : '')) +
				'<span class="cz-chip">Plans</span>' + learned(a.learned) + '</span>' +
				'<span class="cz-desc">' + esc(a.description || a.url) + '</span>' +
				(skills.length ? '<span class="cz-desc nx-hint">Skills: ' + esc(skills.join(', ')) + '</span>' : '') +
				'<code class="cz-command">' + esc(a.url) + '</code></div>' +
				'<span class="cz-rowActions">' +
				'<button type="button" class="nx-btn nx-btn-ghost" data-ag-test="' + esc(a.name) + '"' + busy('test:' + a.name, 'Asking...', 'Test') + '</button>' +
				'<button type="button" class="nx-btn nx-btn-ghost" data-ag-remove="' + esc(a.name) + '">Remove</button></span></div>';
		}

		function agentsExtra() {
			const info = data('agentsInfo');
			if (!info) {
				return '';
			}
			const local = info.local.slice().sort(function (a, b) { return LOCAL_ORDER.indexOf(a.id) - LOCAL_ORDER.indexOf(b.id); });
			const facts = data('learned');
			let html = '<div class="cz-group"><div class="cz-groupTitle">Coding agents on this PC <span class="nx-hint">plans can hand them a code step</span></div>' +
				'<div class="cz-list" role="list">' + local.map(localRow).join('') + '</div></div>';
			html += '<div class="cz-group"><div class="cz-groupTitle cz-groupHead"><span>Remote agents (A2A) <span class="nx-hint">' + info.remote.length + '</span></span>' +
				'<button type="button" class="nx-btn nx-btn-secondary" data-ag="add">+ Remote agent</button></div>';
			html += info.remote.length
				? '<div class="cz-list" role="list">' + info.remote.map(remoteRow).join('') + '</div>'
				: '<p class="nx-hint cz-none">Agents on other services that speak the open A2A protocol. Add one by its address; plans can then give it a step, and its answer becomes the step\'s result.</p>';
			html += '</div>';
			if (facts && facts.steps) {
				html += '<div class="nx-card cz-learned"><div><strong>Routing that learns</strong><p class="nx-hint">' +
					esc(M.learnedFacts(facts)) + '</p></div><button type="button" class="nx-btn nx-btn-ghost" data-ag="forget"' +
					busy('forget', 'Forgetting...', 'Forget what it learned') + '</button></div>';
			}
			return html;
		}

		function addDialog() {
			const card = page.card;
			let html = '<div class="cz-dialogBox"><header class="cz-dialogHead"><h2>Add a remote agent</h2>' +
				'<button type="button" class="nx-btn nx-btn-ghost" data-act="closeDialog">Cancel</button></header>' +
				'<p class="nx-hint">Its address, or the URL of its agent card. Nexora reads /.well-known/agent-card.json and shows what it found before adding anything.</p>' +
				'<div class="nx-row"><input class="nx-input cz-grow" id="cz-agUrl" placeholder="https://agent.example.com" value="' + esc(page.cardUrl || '') + '" aria-label="Agent address">' +
				'<button type="button" class="nx-btn nx-btn-secondary" data-ag="read"' + busy('read', 'Reading...', 'Read card') + '</button></div>';
			if (page.cardError) {
				html += '<div class="cz-formError" role="alert">' + esc(page.cardError) + '</div>';
			}
			if (card) {
				html += '<div class="nx-card cz-preview"><div class="cz-rowTop"><span class="cz-name">' + esc(card.title) + '</span>' +
					(card.version ? '<span class="cz-chip">v' + esc(card.version) + '</span>' : '') +
					'<span class="cz-chip">' + (card.protocol === 'nexora' ? 'Nexora A2A' : 'A2A') + '</span></div>' +
					'<p>' + esc(card.description || 'No description.') + '</p>' +
					((card.skills || []).length ? '<div class="cz-previewTitle">Skills</div><ul class="cz-previewList">' + card.skills.map(function (s) {
						return '<li><strong>' + esc(s.name || s.id) + '</strong>' + (s.description ? ' - ' + esc(s.description) : '') + '</li>';
					}).join('') + '</ul>' : '') +
					'<p class="nx-hint">Plans will call it as <code>agent.a2a.' + esc(card.name) + '</code> at <code>' + esc(card.url) + '</code>.</p>' +
					'<label class="cz-field"><span>Token' + (card.needs_token ? '' : ' <span class="nx-hint">(optional)</span>') + '</span>' +
					'<input class="nx-input" id="cz-agToken" type="password" autocomplete="off" placeholder="' + (card.needs_token ? 'This agent asks for a bearer token' : 'Only if the agent needs one') + '">' +
					'<span class="nx-hint">Kept in Nexora\'s encrypted store, never in a file.</span></label>' +
					'<p class="cz-warn">A plan step sends this agent the step\'s task and the plan\'s context. Add only agents you trust with that.</p>' +
					'<div class="nx-row"><button type="button" class="nx-btn" data-ag="confirm"' + busy('add', 'Adding...', 'Add agent') + '</button>' +
					'<button type="button" class="nx-btn nx-btn-ghost" data-act="closeDialog">Cancel</button></div></div>';
			}
			return html + '</div>';
		}

		function answerDialog() {
			const a = page.answer || {};
			return '<div class="cz-dialogBox"><header class="cz-dialogHead"><h2>' + esc(a.title || 'Remote agent') + (a.ok ? ' answered' : ' did not answer') + '</h2>' +
				'<button type="button" class="nx-btn nx-btn-ghost" data-act="closeDialog">Close</button></header>' +
				(a.ok ? '<pre class="cz-preview">' + esc(a.text || '(empty answer)') + '</pre>'
					: '<div class="cz-formError" role="alert">' + esc(a.error || 'No answer.') + '</div>') +
				'<p class="nx-hint">This is what a plan step would get back as its result.</p></div>';
		}

		// --- Recipes page -------------------------------------------------------------------

		function recipeRow(r) {
			const own = r.source === 'user' || r.source === 'imported';
			const plugin = r.metadata && r.metadata.plugin;
			return '<div class="cz-row" role="listitem"><div class="cz-rowMain cz-static">' +
				'<span class="cz-rowTop"><span class="cz-name">' + esc(r.name) + '</span>' +
				'<span class="cz-chip">' + esc(M.recipeSourceLabel(r)) + '</span>' +
				'<span class="cz-usage">' + esc(M.recipeSummary(r)) + '</span></span>' +
				'<span class="cz-desc">' + esc(r.description || '') + '</span></div>' +
				'<span class="cz-rowActions">' +
				'<button type="button" class="nx-btn" data-rc-use="' + esc(r.id) + '">Use</button>' +
				'<button type="button" class="nx-btn nx-btn-ghost" data-rc-export="' + esc(r.id) + '">Export</button>' +
				(own ? '<button type="button" class="nx-btn nx-btn-ghost" data-rc-delete="' + esc(r.id) + '">Delete</button>'
					: (plugin ? '<button type="button" class="nx-btn nx-btn-ghost" data-rc="plugins">Manage plugin</button>' : '')) +
				'</span></div>';
		}

		function renderRecipes(s) {
			const list = data('recipes');
			const html = ctx.header(s, false).replace('</header>', '<div class="cz-headActions">' +
				'<button type="button" class="nx-btn nx-btn-secondary" data-rc="import">Import...</button></div></header>');
			if (!Array.isArray(list)) {
				return html + ctx.tooOld();
			}
			if (!list.length) {
				return html + '<div class="nx-empty cz-emptyState"><div class="nx-empty-title">No recipes yet</div>' +
					'<p class="nx-hint">When a plan finishes, its card offers to save it as a recipe. Plugins can bring recipes too: git-helper and web-qa in Nexora\'s marketplace each have one.</p>' +
					'<div class="nx-row"><button type="button" class="nx-btn nx-btn-secondary" data-rc="browse">Browse plugins</button></div></div>';
			}
			const groups = M.groupRecipes(list);
			return html + groups.map(function (g) {
				return '<div class="cz-group"><div class="cz-groupTitle">' + esc(g.title) + ' <span class="nx-hint">' + g.items.length + '</span></div>' +
					'<div class="cz-list" role="list">' + g.items.map(recipeRow).join('') + '</div></div>';
			}).join('');
		}

		function paramField(p) {
			const id = 'cz-rcParam-' + p.name;
			const value = p['default'] === undefined || p['default'] === null ? '' : String(p['default']);
			const input = Array.isArray(p.choices) && p.choices.length
				? '<select class="nx-select" id="' + esc(id) + '" data-rc-param="' + esc(p.name) + '">' + p.choices.map(function (c) {
					return '<option' + (String(c) === value ? ' selected' : '') + '>' + esc(c) + '</option>';
				}).join('') + '</select>'
				: '<input class="nx-input" id="' + esc(id) + '" data-rc-param="' + esc(p.name) + '" value="' + esc(value) + '"' + (p.required ? ' required' : '') + '>';
			return '<label class="cz-field"><span>' + esc(p.name) + (p.required ? '' : ' <span class="nx-hint">(optional)</span>') + '</span>' + input +
				(p.description ? '<span class="nx-hint">' + esc(p.description) + '</span>' : '') + '</label>';
		}

		function useDialog() {
			const r = page.recipe;
			return '<form class="cz-dialogBox" id="cz-rcForm" autocomplete="off"><header class="cz-dialogHead"><h2>' + esc(r.name) + '</h2>' +
				'<button type="button" class="nx-btn nx-btn-ghost" data-act="closeDialog">Cancel</button></header>' +
				'<p class="nx-hint">' + esc(r.description || '') + '</p>' +
				(r.parameters || []).map(paramField).join('') +
				'<div class="cz-previewTitle">Steps</div><ol class="cz-previewList">' + (r.tasks || []).map(function (t) {
					return '<li><strong>' + esc(t.name) + '</strong> <span class="nx-hint">' + esc(M.stepRunner(t.capability)) + '</span>' +
						((t.skills || []).length ? ' <span class="cz-chip">skills: ' + esc(t.skills.join(', ')) + '</span>' : '') + '</li>';
				}).join('') + '</ol>' +
				'<p class="nx-hint">Nexora builds the plan and shows it in the chat with its cost. Nothing runs until you approve it.</p>' +
				'<div class="cz-formError" id="cz-rcError" role="alert"></div>' +
				'<div class="nx-row"><button type="submit" class="nx-btn"' + busy('use', 'Planning...', 'Plan it') + '</button></div></form>';
		}

		function bindUse() {
			const form = document.getElementById('cz-rcForm');
			if (!form) {
				return;
			}
			form.addEventListener('submit', function (e) {
				e.preventDefault();
				const params = {};
				let missing = '';
				Array.prototype.forEach.call(form.querySelectorAll('[data-rc-param]'), function (el) {
					const value = el.value.trim();
					if (value) {
						params[el.dataset.rcParam] = value;
					} else if (el.required && !missing) {
						missing = el.dataset.rcParam;
					}
				});
				if (missing) {
					document.getElementById('cz-rcError').textContent = 'Fill in ' + missing + '.';
					return;
				}
				page.busy = 'use';
				ctx.showDialog('recipeUse', useDialog());
				bindUse();
				ctx.post({ type: 'useRecipe', id: page.recipe.id, params: params });
			});
			const first = form.querySelector('[data-rc-param]');
			if (first) {
				first.focus();
			}
		}

		return {
			agentsExtra: agentsExtra,
			render: renderRecipes,
			count: function () {
				const list = data('recipes');
				return Array.isArray(list) ? list.length : 0;
			},
			click: function (t) {
				const d = t.dataset;
				if (d.ag === 'add') {
					page.card = null;
					page.cardError = '';
					page.cardUrl = '';
					ctx.showDialog('agentAdd', addDialog());
					document.getElementById('cz-agUrl').focus();
				} else if (d.ag === 'read') {
					page.cardUrl = document.getElementById('cz-agUrl').value.trim();
					if (page.cardUrl) {
						page.busy = 'read';
						page.cardError = '';
						ctx.showDialog('agentAdd', addDialog());
						ctx.post({ type: 'previewRemoteAgent', url: page.cardUrl });
					}
				} else if (d.ag === 'confirm') {
					const token = document.getElementById('cz-agToken').value;
					page.busy = 'add';
					ctx.showDialog('agentAdd', addDialog());
					ctx.post({ type: 'addRemoteAgent', url: page.cardUrl, token: token });
				} else if (d.ag === 'forget') {
					start('forget', { type: 'forgetLearned' });
				} else if (d.agTest) {
					start('test:' + d.agTest, { type: 'testRemoteAgent', name: d.agTest });
				} else if (d.agRemove) {
					ctx.post({ type: 'removeRemoteAgent', name: d.agRemove });
				} else if (d.agCopy) {
					ctx.post({ type: 'copyText', text: d.agCopy });
				} else if (d.agDocs) {
					ctx.post({ type: 'openExternal', url: d.agDocs });
				} else if (d.rcUse) {
					page.recipe = (data('recipes') || []).find(function (r) { return r.id === d.rcUse; }) || null;
					if (page.recipe) {
						page.busy = '';
						ctx.showDialog('recipeUse', useDialog());
						bindUse();
					}
				} else if (d.rcExport) {
					ctx.post({ type: 'exportRecipe', id: d.rcExport });
				} else if (d.rcDelete) {
					ctx.post({ type: 'deleteRecipe', id: d.rcDelete });
				} else if (d.rc === 'import') {
					ctx.post({ type: 'importRecipe' });
				} else if (d.rc === 'browse' || d.rc === 'plugins') {
					ctx.reveal(d.rc === 'browse' ? 'plugins:marketplace' : 'plugins:installed');
				} else {
					return false;
				}
				return true;
			},
			/** Handles a host message for these parts; returns whether it did. */
			message: function (m) {
				if (m.type === 'remoteAgentCard') {
					page.busy = '';
					page.card = m.card || null;
					page.cardError = m.error || '';
					ctx.showDialog('agentAdd', addDialog());
					return true;
				}
				if (m.type === 'remoteAgentAdded') {
					page.busy = '';
					page.card = null;
					ctx.closeDialog();
					return true;
				}
				if (m.type === 'remoteAgentAnswer') {
					page.busy = '';
					page.answer = m.answer || {};
					ctx.showDialog('agentAnswer', answerDialog());
					return true;
				}
				if (m.type === 'recipePlanned') {
					page.busy = '';
					page.recipe = null;
					ctx.closeDialog();
					return true;
				}
				if (m.type === 'error' || m.type === 'done') {
					const was = page.busy;
					page.busy = '';
					if (m.type === 'error' && ctx.dialog() === 'agentAdd' && (was === 'read' || was === 'add')) {
						page.cardError = m.message || '';
						ctx.showDialog('agentAdd', addDialog());
					} else if (m.type === 'error' && ctx.dialog() === 'recipeUse' && page.recipe) {
						ctx.showDialog('recipeUse', useDialog());
						bindUse();
						document.getElementById('cz-rcError').textContent = m.message || '';
					}
					return false;
				}
				return false;
			}
		};
	};
})(this);
