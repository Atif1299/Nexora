/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

/**
 * Client for the engine's generic remote-MCP connect endpoints.
 *
 * The engine decides how each server is authorized; the IDE only reacts to the
 * outcome. Tokens stay in the engine's encrypted store and never reach a webview.
 */
export type McpConnectOutcome =
	| { status: 'connected'; server_id: string; open?: boolean }
	| { status: 'browser'; server_id: string; authorization_url: string }
	| {
		status: 'device';
		server_id: string;
		user_code: string;
		verification_uri: string;
		verification_uri_complete?: string | null;
		interval?: number;
	}
	| { status: 'needs_setup'; server_id: string; message: string };

export type McpDevicePoll =
	| { status: 'pending' | 'connected' | 'idle'; server_id: string }
	| { status: 'error'; server_id: string; error: string };

export interface McpConnectRow {
	id: string;
	name: string;
	endpoint: string;
	connected: boolean;
	has_client_id: boolean;
}

export function createMcpConnectApi(transport: Transport) {
	return {
		/** Which HTTP MCP servers the engine holds a login for. */
		status: async (userId: string = 'default'): Promise<McpConnectRow[]> => {
			try {
				const response = await transport.get(
					`/api/mcp/connect/status?user_id=${encodeURIComponent(userId)}`
				);
				return Array.isArray(response?.servers) ? response.servers : [];
			} catch {
				return [];
			}
		},

		/** Begin a connection. Throws with the engine's message on failure. */
		connect: async (
			serverId: string,
			userId: string = 'default',
			returnUri?: string
		): Promise<McpConnectOutcome> => {
			return await transport.post(`/api/mcp/connect/${encodeURIComponent(serverId)}`, {
				user_id: userId,
				return_uri: returnUri
			});
		},

		/** Ask once whether a device sign-in has been approved. */
		pollDevice: async (
			serverId: string,
			userId: string = 'default'
		): Promise<McpDevicePoll> => {
			return await transport.get(
				`/api/mcp/connect/${encodeURIComponent(serverId)}/device`
				+ `?user_id=${encodeURIComponent(userId)}`
			);
		},

		disconnect: async (
			serverId: string,
			userId: string = 'default'
		): Promise<{ had_token: boolean }> => {
			return await transport.post(
				`/api/mcp/connect/${encodeURIComponent(serverId)}/disconnect`
				+ `?user_id=${encodeURIComponent(userId)}`,
				{}
			);
		}
	};
}
