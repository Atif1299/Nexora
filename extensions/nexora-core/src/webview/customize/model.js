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
		{ id: 'plugins', kind: 'plugin', title: 'Plugins', singular: 'plugin',
			blurb: 'Bundles of commands, skills, subagents, hooks and MCP servers, installed in one step from a marketplace, a git repository or a folder. Claude Code plugins work as they are.' },
		{ id: 'skills', kind: 'skill', title: 'Skills', singular: 'skill',
			blurb: 'Instructions for a kind of task. The agent sees each skill\'s name and description and loads the full text only when a request matches, so you can keep many.' },
		{ id: 'agents', kind: 'agent', title: 'Subagents', singular: 'subagent',
			blurb: 'Specialists the agent hands a task to, each with its own instructions, tools and model. Up to 3 run at once; each shows as a card in the chat.' },
		{ id: 'commands', kind: 'command', title: 'Commands', singular: 'command',
			blurb: 'Prompts you run by typing /name in the chat. Text after the name fills $ARGUMENTS.' },
		{ id: 'hooks', kind: 'hook', title: 'Hooks', singular: 'hook',
			blurb: 'Your commands that run at fixed points: before and after a tool, when you send a message, when the agent finishes, around plan steps. They can block, add context or check the work.' },
		{ id: 'rules', kind: 'rule', title: 'Rules', singular: 'rule',
			blurb: 'Standing instructions sent with every message: your personal rules for all projects, then this project\'s AGENTS.md, CLAUDE.md and .nexora/rules.' },
		{ id: 'platforms', kind: 'platform', title: 'Platforms (MCP)', singular: 'platform',
			blurb: 'Connected platforms and your own MCP servers. They are managed in the Platforms panel.' }
	];

	const ORIGINS = { nexora: 'Nexora', plugin: 'Plugin', claude: 'Claude Code', cursor: 'Cursor' };

	/** Every hook event, in the order Customize lists them. matcher: whether a matcher applies. */
	const EVENT_INFO = {
		PreToolUse: { title: 'Before a tool runs', matcher: true, hint: 'Bash, Write|Edit, Read, mcp__github__.*',
			desc: 'Exit 2 blocks the tool; stderr tells the agent why.' },
		PostToolUse: { title: 'After a tool runs', matcher: true, hint: 'Write|Edit',
			desc: 'Check or format the result. Exit 2 sends stderr to the agent as feedback.' },
		UserPromptSubmit: { title: 'When you send a message', matcher: false, hint: '',
			desc: 'What it prints is added as context. Exit 2 stops the message.' },
		Stop: { title: 'When the agent finishes', matcher: false, hint: '',
			desc: 'Exit 2 sends the agent back to work with stderr as the reason (at most 3 times).' },
		SessionStart: { title: 'When a new chat starts', matcher: true, hint: 'startup',
			desc: 'What it prints is added as context to the first message.' },
		PlanStepStart: { title: 'Before a plan step', matcher: true, hint: 'deploy\\..*',
			desc: 'Matches the step\'s capability. Exit 2 stops the step.' },
		PlanStepEnd: { title: 'After a plan step', matcher: true, hint: 'deploy\\..*',
			desc: 'Gets the step\'s status and error, for notifications and checks.' }
	};

	function hookRunLabel(run, now) {
		if (!run) {
			return 'Not run yet';
		}
		const when = ago(run.at, typeof now === 'number' ? now : Date.now());
		let what;
		if (run.timed_out) {
			what = 'timed out';
		} else if (run.blocked) {
			what = 'blocked';
		} else if (run.exit_code === 0) {
			what = 'ok ' + (run.duration_ms / 1000).toFixed(1) + ' s';
		} else {
			what = 'error exit ' + run.exit_code;
		}
		return when ? what + ' - ' + when : what;
	}

	function hookMatcherLabel(event, matcher) {
		const info = EVENT_INFO[event];
		if (!info || !info.matcher) {
			return '';
		}
		if (matcher && matcher !== '*') {
			return matcher;
		}
		return event === 'SessionStart' ? 'Every new chat' : (event.indexOf('PlanStep') === 0 ? 'All steps' : 'All tools');
	}

	function hookSourceLabel(hook) {
		if (hook.source === 'plugin') {
			return 'Plugin ' + hook.plugin;
		}
		return hook.source === 'project' ? 'This project' : 'You';
	}

	function plural(n, one, many) {
		return n + ' ' + (n === 1 ? one : many);
	}

	/** "3 commands - 1 subagent - 2 hooks - 1 MCP server" */
	function pluginContentsLabel(contents) {
		const c = contents || {};
		const parts = [
			[c.commands, 'command', 'commands'], [c.skills, 'skill', 'skills'], [c.agents, 'subagent', 'subagents'],
			[c.hooks, 'hook', 'hooks'], [c.mcp_servers, 'MCP server', 'MCP servers']
		].filter(function (p) { return Array.isArray(p[0]) && p[0].length; })
			.map(function (p) { return plural(p[0].length, p[1], p[2]); });
		return parts.length ? parts.join(' - ') : 'Nothing to add';
	}

	function marketplaceSourceHint(text) {
		const value = String(text || '').trim();
		if (!value) {
			return '';
		}
		if (/^(https?|git|ssh|file):\/\/|^git@/.test(value)) {
			return 'Git repository';
		}
		return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) ? 'GitHub repository' : 'Folder on this PC';
	}

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
		EVENT_INFO: EVENT_INFO,
		hookRunLabel: hookRunLabel,
		hookMatcherLabel: hookMatcherLabel,
		hookSourceLabel: hookSourceLabel,
		pluginContentsLabel: pluginContentsLabel,
		marketplaceSourceHint: marketplaceSourceHint,
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
