/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Customize (Phase 3): labels, filters and texts shared by the Customize webview and its
// Node checks. Plain JS with no DOM access: the page loads it as window.NexoraCustomizeModel,
// Node loads it with require().
(function (root) {
	'use strict';

	const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

	const SECTIONS = [
		{ id: 'skills', kind: 'skill', title: 'Skills', singular: 'skill',
			blurb: 'Instructions for a kind of task. The agent sees each skill\'s name and description and loads the full text only when a request matches, so you can keep many.' },
		{ id: 'agents', kind: 'agent', title: 'Subagents', singular: 'subagent',
			blurb: 'Specialists the agent hands a task to, each with its own instructions, tools and model. Up to 3 run at once; each shows as a card in the chat.' },
		{ id: 'commands', kind: 'command', title: 'Commands', singular: 'command',
			blurb: 'Prompts you run by typing /name in the chat. Text after the name fills $ARGUMENTS.' },
		{ id: 'rules', kind: 'rule', title: 'Rules', singular: 'rule',
			blurb: 'Standing instructions sent with every message: your personal rules for all projects, then this project\'s AGENTS.md, CLAUDE.md and .nexora/rules.' },
		{ id: 'platforms', kind: 'platform', title: 'Platforms (MCP)', singular: 'platform',
			blurb: 'Connected platforms and your own MCP servers. They are managed in the Platforms panel.' }
	];

	const ORIGINS = { nexora: 'Nexora', claude: 'Claude Code', cursor: 'Cursor' };

	function originLabel(origin) {
		return ORIGINS[origin] || String(origin || '');
	}

	function useInLabel(kind) {
		return kind === 'command' ? 'Chat, Ask, Agent, Plan' : 'Ask, Agent';
	}

	/** chip: all | user | project | claude | cursor */
	function filterItems(items, query, chip) {
		const q = String(query || '').trim().toLowerCase();
		return (items || []).filter(function (item) {
			if (chip === 'user' || chip === 'project') {
				if (item.scope !== chip) {
					return false;
				}
			} else if (chip === 'claude' || chip === 'cursor') {
				if (item.origin !== chip) {
					return false;
				}
			}
			if (!q) {
				return true;
			}
			return String(item.name || '').toLowerCase().indexOf(q) >= 0
				|| String(item.description || '').toLowerCase().indexOf(q) >= 0;
		});
	}

	function groupByScope(items) {
		return {
			user: (items || []).filter(function (i) { return i.scope === 'user'; }),
			project: (items || []).filter(function (i) { return i.scope === 'project'; })
		};
	}

	/** '' when the name can be used, else what is wrong with it (same rule as the engine). */
	function validateNewName(name) {
		const value = String(name || '');
		if (!value) {
			return 'Enter a name.';
		}
		if (!NAME_RE.test(value)) {
			return 'Use lowercase letters, digits, hyphens and underscores (up to 64), starting with a letter or digit.';
		}
		return '';
	}

	function ago(iso, now) {
		const then = Date.parse(iso);
		if (isNaN(then)) {
			return '';
		}
		const s = Math.max(0, Math.round((now - then) / 1000));
		if (s < 60) {
			return 'just now';
		}
		if (s < 3600) {
			return Math.round(s / 60) + ' min ago';
		}
		if (s < 86400) {
			return Math.round(s / 3600) + ' h ago';
		}
		return Math.round(s / 86400) + ' d ago';
	}

	function money(usd) {
		return '$' + (usd >= 0.01 ? usd.toFixed(2) : usd.toFixed(4));
	}

	/** "Used 12 times - $0.42 - last used 2 h ago" */
	function usageLabel(usage, now) {
		if (!usage || !usage.count) {
			return 'Not used yet';
		}
		const parts = [usage.count === 1 ? 'Used once' : 'Used ' + usage.count + ' times'];
		if (usage.cost_usd > 0) {
			parts.push(money(usage.cost_usd));
		}
		const when = ago(usage.last_used, typeof now === 'number' ? now : Date.now());
		if (when) {
			parts.push('last used ' + when);
		}
		return parts.join(' - ');
	}

	/** What Try puts in the chat box (Agent mode). */
	function tryText(kind, name) {
		if (kind === 'command') {
			return '/' + name + ' ';
		}
		return 'Use the ' + name + ' ' + (kind === 'agent' ? 'subagent' : 'skill') + ' to ';
	}

	const api = {
		SECTIONS: SECTIONS,
		originLabel: originLabel,
		useInLabel: useInLabel,
		filterItems: filterItems,
		groupByScope: groupByScope,
		validateNewName: validateNewName,
		usageLabel: usageLabel,
		tryText: tryText
	};
	if (typeof module === 'object' && module.exports) {
		module.exports = api;
	} else {
		root.NexoraCustomizeModel = api;
	}
})(this);
