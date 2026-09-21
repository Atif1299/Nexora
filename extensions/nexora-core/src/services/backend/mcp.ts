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

const MCP_OAUTH_IDS = new Set(['github', 'vercel', 'supabase', 'v0']);

export function mcpNeedsOAuth(row: McpServerRow): boolean {
	return MCP_OAUTH_IDS.has(row.id) && (row.missing_requires || []).length > 0;
}

export function createMcpApi(transport: Transport) {
	return {
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
		},

		startOAuth: async (provider: string, userId: string = 'default'): Promise<{ authorization_url: string } | null> => {
			try {
				return await transport.get(
					`/api/mcp/auth/start/${encodeURIComponent(provider)}?user_id=${encodeURIComponent(userId)}`
				);
			} catch {
				return null;
			}
		}
	};
}
