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

	/** The kind chips, in the order the page shows them. icon: a codicon; invite: the line a kind with no items shows. */
	const SECTIONS = [
		{ id: 'plugins', kind: 'plugin', title: 'Plugins', singular: 'plugin', icon: 'package',
			invite: 'Plugins add commands, skills, subagents, hooks and MCP servers in one install.',
			blurb: 'Bundles of commands, skills, subagents, hooks and MCP servers, installed in one step from a marketplace, a git repository or a folder. Claude Code plugins work as they are.' },
		{ id: 'platforms', kind: 'platform', title: 'Platforms', singular: 'platform', icon: 'plug',
			invite: 'Connect GitHub, Vercel or Supabase, or add your own MCP servers, so the agent can use them.',
			blurb: 'Connected platforms and your own MCP servers. They are managed in the Platforms panel.' },
		{ id: 'skills', kind: 'skill', title: 'Skills', singular: 'skill', icon: 'lightbulb',
			invite: 'Skills teach the agent a kind of task; it loads one only when a request matches.',
			blurb: 'Instructions for a kind of task. The agent sees each skill\'s name and description and loads the full text only when a request matches, so you can keep many.' },
		{ id: 'agents', kind: 'agent', title: 'Agents', singular: 'subagent', icon: 'hubot',
			invite: 'Subagents take on focused tasks the chat agent hands them, up to 3 at once.',
			blurb: 'Who can take on work: your subagents (the chat agent hands them tasks, up to 3 at once), coding agents on this PC and remote A2A agents. Plans can give a step to any of them.' },
		{ id: 'recipes', kind: 'recipe', title: 'Recipes', singular: 'recipe', icon: 'play-circle',
			invite: 'Recipes are plans you run again with new values. Save one from a finished plan\'s card.',
			blurb: 'Plans you can run again with new values: steps across platforms and agents, with their skills. Save a finished plan from its card, import one, or get them with plugins.' },
		{ id: 'commands', kind: 'command', title: 'Commands', singular: 'command', icon: 'terminal-cmd',
			invite: 'Commands are prompts you run by typing /name in the chat.',
			blurb: 'Prompts you run by typing /name in the chat. Text after the name fills $ARGUMENTS.' },
		{ id: 'hooks', kind: 'hook', title: 'Hooks', singular: 'hook', icon: 'zap',
			invite: 'Hooks run your commands at fixed points, such as before a tool or after an edit.',
			blurb: 'Your commands that run at fixed points: before and after a tool, when you send a message, when the agent finishes, around plan steps. They can block, add context or check the work.' },
		{ id: 'rules', kind: 'rule', title: 'Rules', singular: 'rule', icon: 'law',
			invite: 'Rules are standing instructions sent with every message.',
			blurb: 'Standing instructions sent with every message: your personal rules for all projects, then this project\'s AGENTS.md, CLAUDE.md and .nexora/rules.' }
	];

	/** The scope menu: which items the page shows. */
	const SCOPES = [
		{ id: 'all', label: 'All' },
		{ id: 'user', label: 'You' },
		{ id: 'project', label: 'This project' },
		{ id: 'claude', label: 'Claude Code' },
		{ id: 'cursor', label: 'Cursor' }
	];

	const ORIGINS = { nexora: 'Nexora', plugin: 'Plugin', claude: 'Claude Code', cursor: 'Cursor' };
	const SERVER_SCOPES = { user: 'You', project: 'This project', plugin: 'Plugin' };
	const SERVER_STATES = { connected: 'Connected', available: 'Not connected', needs_approval: 'Needs approval', disabled: 'Off', error: 'Error' };

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
			[c.hooks, 'hook', 'hooks'], [c.mcp_servers, 'MCP server', 'MCP servers'], [c.recipes, 'recipe', 'recipes']
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

	/**
	 * Whether a row stays in view. entry: { text, scope: user | project, origin }; scope is the
	 * menu's choice (all | user | project | claude | cursor); query matches anywhere in text.
	 */
	function matches(entry, query, scope) {
		if ((scope === 'user' || scope === 'project') && entry.scope !== scope) {
			return false;
		}
		if ((scope === 'claude' || scope === 'cursor') && entry.origin !== scope) {
			return false;
		}
		const q = String(query || '').trim().toLowerCase();
		return !q || String(entry.text || '').toLowerCase().indexOf(q) >= 0;
	}

	/** "You - Connected - 12 tools" for one of your MCP servers. */
	function serverSource(server) {
		const tools = server.tools && server.tools.total
			? (server.tools.enabled === server.tools.total ? plural(server.tools.total, 'tool', 'tools') : server.tools.enabled + ' of ' + server.tools.total + ' tools on')
			: '';
		return [SERVER_SCOPES[server.scope] || 'You', SERVER_STATES[server.state] || server.state, tools].filter(Boolean).join(' - ');
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

	/** "4 of 5 plan runs worked, about 40 s" from what past runs taught the router; '' before any. */
	function learnedLabel(summary) {
		if (!summary || !summary.runs) {
			return '';
		}
		const seconds = Math.round(Number(summary.avg_ms || 0) / 1000);
		const took = seconds >= 120 ? 'about ' + Math.round(seconds / 60) + ' min' : 'about ' + seconds + ' s';
		return summary.ok + ' of ' + summary.runs + ' plan runs worked, ' + took;
	}

	/** The Routing that learns card: what the stats cover. */
	function learnedFacts(facts) {
		return 'Nexora has learned from ' + facts.steps + (facts.steps === 1 ? ' plan step' : ' plan steps') + ' across ' +
			facts.capabilities + (facts.capabilities === 1 ? ' capability' : ' capabilities') +
			'. After 3 runs, a route or agent that keeps failing moves down and one that works faster and cheaper moves up.';
	}

	const RECIPE_GROUPS = [
		{ title: 'Yours', match: function (r) { return r.source === 'user' || r.source === 'imported'; } },
		{ title: 'From plugins', match: function (r) { return r.source === 'plugin'; } },
		{ title: 'Built in', match: function (r) { return r.source === 'builtin'; } }
	];

	function groupRecipes(list) {
		return RECIPE_GROUPS.map(function (g) {
			return { title: g.title, items: list.filter(g.match).sort(function (a, b) { return a.name.localeCompare(b.name); }) };
		}).filter(function (g) { return g.items.length; });
	}

	function recipeSourceLabel(recipe) {
		if (recipe.source === 'plugin') {
			return 'Plugin ' + ((recipe.metadata && recipe.metadata.plugin) || '');
		}
		return { builtin: 'Built in', imported: 'Imported', user: 'Yours' }[recipe.source] || recipe.source;
	}

	const LOCAL_AGENT_NAMES = { 'claude-code': 'Claude Code', cursor: 'Cursor', cline: 'Cline' };

	/** Who runs a recipe step: "IDE agent", "subagent ui-tester", "Claude Code", "remote agent x" or the capability. */
	function stepRunner(capability) {
		const id = String(capability || '');
		const name = id.split('.').slice(2).join('.');
		if (id === 'workspace.implement') {
			return 'IDE agent';
		}
		if (id.indexOf('agent.sub.') === 0) {
			return 'subagent ' + name;
		}
		if (id.indexOf('agent.local.') === 0) {
			return LOCAL_AGENT_NAMES[name] || name;
		}
		if (id.indexOf('agent.a2a.') === 0) {
			return 'remote agent ' + name;
		}
		return id;
	}

	/** "3 steps - 2 inputs - uses agents" */
	function recipeSummary(recipe) {
		const tasks = recipe.tasks || [];
		const params = recipe.parameters || [];
		const parts = [tasks.length + (tasks.length === 1 ? ' step' : ' steps')];
		if (params.length) {
			parts.push(params.length + (params.length === 1 ? ' input' : ' inputs'));
		}
		if (tasks.some(function (t) { return String(t.capability || '').indexOf('agent.') === 0; })) {
			parts.push('uses agents');
		}
		if (tasks.some(function (t) { return (t.skills || []).length; })) {
			parts.push('uses skills');
		}
		return parts.join(' - ');
	}

	const api = {
		SECTIONS: SECTIONS,
		SCOPES: SCOPES,
		matches: matches,
		serverSource: serverSource,
		learnedLabel: learnedLabel,
		learnedFacts: learnedFacts,
		groupRecipes: groupRecipes,
		recipeSourceLabel: recipeSourceLabel,
		stepRunner: stepRunner,
		recipeSummary: recipeSummary,
		EVENT_INFO: EVENT_INFO,
		hookRunLabel: hookRunLabel,
		hookMatcherLabel: hookMatcherLabel,
		hookSourceLabel: hookSourceLabel,
		pluginContentsLabel: pluginContentsLabel,
		marketplaceSourceHint: marketplaceSourceHint,
		originLabel: originLabel,
		useInLabel: useInLabel,
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
