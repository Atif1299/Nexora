/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';
import type { PlatformUsage, ServerTools } from '../platformUsage';
import type { ImportSource, MyServer, MyServers, ServerBody } from '../mcpServers';

export function createPlatformsApi(transport: Transport) {
	return {
		/**
		 * Every catalogue row, not the first page of them.
		 *
		 * `/api/platforms` paginates with a default of 20 and a hard cap of 100,
		 * so the bare call returned 20 of 50 rows ordered by name: the sidebar
		 * stopped at "GitHub" and never showed Vercel, Stripe, Supabase, OpenAI
		 * or v0. Ask for full pages until the server's own total is covered.
		 */
		getPlatforms: async (): Promise<any[]> => {
			const pageSize = 100;
			const rows: any[] = [];
			for (let skip = 0; ; skip += pageSize) {
				const response = await transport.get(`/api/platforms?skip=${skip}&limit=${pageSize}`);
				const page = response?.platforms || [];
				rows.push(...page);
				const total = Number(response?.total);
				if (page.length < pageSize || !Number.isFinite(total) || rows.length >= total) {
					break;
				}
			}
			return rows;
		},

		/**
		 * Where each platform can be used and its state (engine `GET /api/platforms/usage`).
		 * Undefined when the engine is older than that route or unreachable, so the panel
		 * keeps working as before.
		 */
		getPlatformUsage: async (): Promise<Record<string, PlatformUsage> | undefined> => {
			try {
				const response = await transport.get('/api/platforms/usage');
				const platforms = response?.platforms;
				return platforms && typeof platforms === 'object' ? platforms as Record<string, PlatformUsage> : undefined;
			} catch {
				return undefined;
			}
		},

		/** Every discovered tool of a connected server with its effect and switch; undefined when the engine has no such route. */
		getServerTools: async (server: string): Promise<ServerTools | undefined> => {
			try {
				const response = await transport.get(`/api/capabilities/tools/${encodeURIComponent(server)}`);
				return response && Array.isArray(response.tools) ? response as ServerTools : undefined;
			} catch {
				return undefined;
			}
		},

		/**
		 * Turn one tool on or off. The engine changes only that tool, under a lock,
		 * so a slow or failed read can never rewrite the other switches. Throws on failure.
		 */
		setToolEnabled: async (server: string, tool: string, enabled: boolean): Promise<ServerTools | undefined> => {
			const response = await transport.patch(
				`/api/capabilities/tools/${encodeURIComponent(server)}/${encodeURIComponent(tool)}`,
				{ enabled }
			);
			return response && Array.isArray(response.tools) ? response as ServerTools : undefined;
		},

		/** Your own MCP servers and the bundled local ones; undefined from an engine without the route. */
		getMyServers: async (): Promise<MyServers | undefined> => {
			try {
				const response = await transport.get('/api/mcp/my-servers');
				return response && Array.isArray(response.servers) ? response as MyServers : undefined;
			} catch {
				return undefined;
			}
		},

		/** Tell the engine which folder's .nexora/mcp.json applies; an older engine ignores it. */
		setMcpWorkspace: async (path: string | undefined): Promise<void> => {
			try {
				await transport.put('/api/mcp/workspace', { path: path || null });
			} catch {
				// An engine without the route has no project servers to read.
			}
		},

		addServer: async (body: ServerBody): Promise<MyServer> => transport.post('/api/mcp/my-servers', body),

		editServer: async (scope: string, name: string, body: ServerBody): Promise<MyServer> =>
			transport.put(`/api/mcp/my-servers/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`, body),

		removeServer: async (scope: string, name: string): Promise<void> => {
			await transport.delete(`/api/mcp/my-servers/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`);
		},

		enableServer: async (scope: string, name: string, enabled: boolean): Promise<MyServer> =>
			transport.post(`/api/mcp/my-servers/${encodeURIComponent(scope)}/${encodeURIComponent(name)}/enable`, { enabled }),

		approveServer: async (name: string): Promise<MyServer> =>
			transport.post(`/api/mcp/my-servers/project/${encodeURIComponent(name)}/approve`, {}),

		getImportSources: async (): Promise<ImportSource[] | undefined> => {
			try {
				const response = await transport.get('/api/mcp/import');
				return Array.isArray(response?.sources) ? response.sources as ImportSource[] : undefined;
			} catch {
				return undefined;
			}
		},

		applyImport: async (items: { source: string; name: string; scope: string }[]): Promise<MyServer[]> => {
			const response = await transport.post('/api/mcp/import', { items });
			return Array.isArray(response?.servers) ? response.servers as MyServer[] : [];
		},

		searchPlatforms: async (query: string): Promise<any[]> => {
			const response = await transport.get(`/api/platforms/search?q=${encodeURIComponent(query)}`);
			return response?.results || [];
		},

		semanticSearchPlatforms: async (query: string, limit: number = 5): Promise<any[]> => {
			const response = await transport.get(
				`/api/platforms/semantic-search?q=${encodeURIComponent(query)}&limit=${limit}`
			);
			return response?.results || [];
		}
	};
}
