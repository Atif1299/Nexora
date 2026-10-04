/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

export interface McpServerRow {
	id: string;
	name: string;
	transport: string;
	command?: string;
	args?: string[];
	endpoint?: string;
	requires?: string[];
	missing_requires?: string[];
	description?: string;
	connected: boolean;
	tools_count: number;
}

/** Outcome of one approved platform tool call. */
export interface McpCallResult {
	success: boolean;
	data?: unknown;
	error?: string;
}

export function createMcpApi(transport: Transport) {
	return {
		/**
		 * Run one tool on a connected server, after the user has approved it.
		 *
		 * The engine makes the call because the credential is there and never
		 * comes here; the IDE's part is asking the user first.
		 */
		callTool: async (
			serverId: string,
			tool: string,
			args: Record<string, unknown>
		): Promise<McpCallResult> => {
			try {
				const response = await transport.post(
					`/api/connectors/mcp/${encodeURIComponent(serverId)}/call`,
					{ tool, arguments: args }
				);
				return {
					success: response?.success === true,
					data: response?.data,
					error: response?.error ? String(response.error) : undefined
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Platform call failed'
				};
			}
		},

		listServers: async (): Promise<McpServerRow[]> => {
			try {
				const response = await transport.get('/api/connectors/mcp/servers');
				return Array.isArray(response?.servers) ? response.servers : [];
			} catch {
				return [];
			}
		},

		connect: async (
			serverId: string,
			workspacePath?: string
		): Promise<{ connected: boolean; error?: string }> => {
			try {
				const body = workspacePath ? { workspace_path: workspacePath } : {};
				await transport.post(`/api/connectors/mcp/${encodeURIComponent(serverId)}/connect`, body);
				return { connected: true };
			} catch (error) {
				return {
					connected: false,
					error: error instanceof Error ? error.message : 'MCP connect failed'
				};
			}
		},

		disconnect: async (serverId: string): Promise<{ disconnected: boolean; error?: string }> => {
			try {
				await transport.post(`/api/connectors/mcp/${encodeURIComponent(serverId)}/disconnect`, {});
				return { disconnected: true };
			} catch (error) {
				return {
					disconnected: false,
					error: error instanceof Error ? error.message : 'MCP disconnect failed'
				};
			}
		}
	};
}
