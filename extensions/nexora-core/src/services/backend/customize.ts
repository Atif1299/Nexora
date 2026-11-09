/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

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
			transport.post('/api/customize/copy', { kind, name, scope, workspace_path: workspacePath || null })
	};
}
