/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';
import type { HookOutcome } from '../hooks';

export type CustomizeKind = 'skill' | 'command' | 'agent';
export type CustomizePlural = 'skills' | 'commands' | 'agents';

export interface CustomizeUsage {
	count: number;
	cost_usd: number;
	last_used: string;
}

/** One skill, command or subagent as GET /api/customize lists it (no body). */
export interface CustomizeItem {
	kind: CustomizeKind;
	name: string;
	description: string;
	scope: 'user' | 'project';
	origin: 'nexora' | 'claude' | 'cursor';
	path: string;
	editable: boolean;
	problems: string[];
	/** The winning item's file when another item of the same name hides this one. */
	shadowed_by: string;
	argument_hint: string;
	tools: string[] | null;
	unknown_tools: string[];
	model: string;
	usage: CustomizeUsage | null;
}

export interface CustomizeList {
	skills: CustomizeItem[];
	commands: CustomizeItem[];
	agents: CustomizeItem[];
}

export interface CustomizeExample {
	id: string;
	kind: CustomizeKind;
	name: string;
	description: string;
	installed: { user: boolean; project: boolean };
}

/** One hook as GET /api/hooks lists it. */
export interface HookItem {
	id: string;
	event: string;
	matcher: string;
	command: string;
	timeout: number;
	source: 'user' | 'project' | 'plugin';
	plugin: string;
	file: string;
	approved: boolean;
	recent_runs: Array<{ exit_code: number | null; duration_ms: number; blocked: boolean; timed_out: boolean; at: string; stderr: string }>;
}

export interface HookList {
	hooks: HookItem[];
	events: string[];
	shell: string;
}

export interface HookTestResult {
	exit_code: number | null;
	stdout: string;
	stderr: string;
	duration_ms: number;
	timed_out: boolean;
	blocked: boolean;
	reason: string;
	warnings: string[];
	error: string;
}

export interface PluginContents {
	commands: string[];
	skills: string[];
	agents: string[];
	hooks: Array<{ event: string; matcher: string; command: string }>;
	mcp_servers: Array<{ name: string; command: string; url: string; env_keys: string[]; header_keys: string[]; reads: string[] }>;
}

export interface PluginInfo {
	name: string;
	version: string;
	description: string;
	author: string;
	contents: PluginContents;
	enabled: boolean;
	marketplace: string;
	source: unknown;
	error: string;
}

export interface PluginPreview extends PluginInfo {
	token: string;
	installed: boolean;
}

export interface MarketplaceInfo {
	name: string;
	builtin: boolean;
	source: string;
	description: string;
	error: string;
	plugins: Array<{ name: string; description: string; version: string; category: string; author: string; source: string; installed: boolean }>;
}

/** Fetching a plugin or marketplace can mean a git clone: the engine allows 120 s. */
const PLUGIN_FETCH_TIMEOUT_MS = 150_000;

function query(workspacePath?: string): string {
	return workspacePath ? '?workspace_path=' + encodeURIComponent(workspacePath) : '';
}

export function createCustomizeApi(transport: Transport) {
	return {
		/** Skills, commands and subagents; undefined from an engine without the route. */
		list: async (workspacePath?: string): Promise<CustomizeList | undefined> => {
			try {
				const r = await transport.get('/api/customize' + query(workspacePath));
				return r && Array.isArray(r.skills) && Array.isArray(r.commands) && Array.isArray(r.agents) ? r as CustomizeList : undefined;
			} catch {
				return undefined;
			}
		},

		/** The prompt for "/name arguments". Throws with the engine's message on failure. */
		expandCommand: async (name: string, args: string, workspacePath?: string): Promise<string> => {
			const r = await transport.post('/api/customize/commands/expand', { name, arguments: args, workspace_path: workspacePath || null });
			return String(r?.prompt || '');
		},

		create: async (kind: CustomizePlural, name: string, scope: 'user' | 'project', description: string, workspacePath?: string): Promise<CustomizeItem> =>
			transport.post('/api/customize/' + kind, { name, scope, description, workspace_path: workspacePath || null }),

		examples: async (workspacePath?: string): Promise<CustomizeExample[] | undefined> => {
			try {
				const r = await transport.get('/api/customize/examples' + query(workspacePath));
				return Array.isArray(r?.examples) ? r.examples as CustomizeExample[] : undefined;
			} catch {
				return undefined;
			}
		},

		installExample: async (id: string, scope: 'user' | 'project', workspacePath?: string): Promise<CustomizeItem> =>
			transport.post('/api/customize/examples/install', { id, scope, workspace_path: workspacePath || null }),

		copyToNexora: async (kind: CustomizePlural, name: string, scope: 'user' | 'project', workspacePath?: string): Promise<CustomizeItem> =>
			transport.post('/api/customize/copy', { kind, name, scope, workspace_path: workspacePath || null }),

		// --- hooks (Phase 4) ---

		/** Events that have a hook that would run; [] from an engine without hooks. */
		hookEvents: async (workspacePath?: string): Promise<string[]> => {
			try {
				const r = await transport.get('/api/hooks/events' + query(workspacePath));
				return Array.isArray(r?.events) ? r.events as string[] : [];
			} catch {
				return [];
			}
		},

		/** Run an event's hooks; undefined when the engine could not (the action then goes ahead). */
		runHooks: async (event: string, payload: Record<string, unknown>, workspacePath?: string, sessionId?: string): Promise<HookOutcome | undefined> => {
			try {
				return await transport.post('/api/hooks/run', { event, payload, workspace_path: workspacePath || null, session_id: sessionId || '' }, 330_000) as HookOutcome;
			} catch {
				return undefined;
			}
		},

		listHooks: async (workspacePath?: string): Promise<HookList | undefined> => {
			try {
				const r = await transport.get('/api/hooks' + query(workspacePath));
				return Array.isArray(r?.hooks) ? r as HookList : undefined;
			} catch {
				return undefined;
			}
		},
		addHook: async (body: { scope: 'user' | 'project'; event: string; matcher: string; command: string; timeout?: number }, workspacePath?: string): Promise<HookItem> =>
			transport.post('/api/hooks', { ...body, workspace_path: workspacePath || null }),
		deleteHook: async (id: string, workspacePath?: string): Promise<void> => {
			await transport.delete('/api/hooks/' + encodeURIComponent(id) + query(workspacePath));
		},
		approveHook: async (id: string, workspacePath?: string): Promise<HookItem> =>
			transport.post('/api/hooks/' + encodeURIComponent(id) + '/approve', { workspace_path: workspacePath || null }),
		testHook: async (id: string, workspacePath?: string): Promise<HookTestResult> =>
			transport.post('/api/hooks/' + encodeURIComponent(id) + '/test', { workspace_path: workspacePath || null }, 330_000),
		importHooks: async (workspacePath?: string): Promise<number> => {
			const r = await transport.post('/api/hooks/import', { workspace_path: workspacePath || null });
			return Number(r?.imported || 0);
		},

		// --- plugins and marketplaces (Phase 4) ---

		listPlugins: async (): Promise<PluginInfo[] | undefined> => {
			try {
				const r = await transport.get('/api/plugins');
				return Array.isArray(r?.plugins) ? r.plugins as PluginInfo[] : undefined;
			} catch {
				return undefined;
			}
		},
		listMarketplaces: async (): Promise<MarketplaceInfo[] | undefined> => {
			try {
				const r = await transport.get('/api/plugins/marketplaces');
				return Array.isArray(r?.marketplaces) ? r.marketplaces as MarketplaceInfo[] : undefined;
			} catch {
				return undefined;
			}
		},
		/** Fetch a plugin and list what it adds; nothing is active until install(token). */
		previewPlugin: async (body: { source?: string; marketplace?: string; plugin?: string }): Promise<PluginPreview> =>
			transport.post('/api/plugins/preview', body, PLUGIN_FETCH_TIMEOUT_MS),
		installPlugin: async (token: string): Promise<PluginInfo> => transport.post('/api/plugins/install', { token }),
		enablePlugin: async (name: string, enabled: boolean): Promise<PluginInfo> =>
			transport.post('/api/plugins/' + encodeURIComponent(name) + '/enable', { enabled }),
		updatePlugin: async (name: string): Promise<PluginPreview> =>
			transport.post('/api/plugins/' + encodeURIComponent(name) + '/update', {}, PLUGIN_FETCH_TIMEOUT_MS),
		removePlugin: async (name: string): Promise<void> => {
			await transport.delete('/api/plugins/' + encodeURIComponent(name));
		},
		addMarketplace: async (source: string): Promise<MarketplaceInfo> =>
			transport.post('/api/plugins/marketplaces', { source }, PLUGIN_FETCH_TIMEOUT_MS),
		removeMarketplace: async (name: string): Promise<void> => {
			await transport.delete('/api/plugins/marketplaces/' + encodeURIComponent(name));
		},
		refreshMarketplace: async (name: string): Promise<MarketplaceInfo> =>
			transport.post('/api/plugins/marketplaces/' + encodeURIComponent(name) + '/refresh', {}, PLUGIN_FETCH_TIMEOUT_MS)
	};
}
