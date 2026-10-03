/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

export type SaasConnector = 'supabase' | 'stripe' | 'v0' | 'elevenlabs' | 'tavily';

export interface AuthStatus {
	github_connected: boolean;
	vercel_connected: boolean;
	supabase_connected: boolean;
	stripe_connected: boolean;
	v0_connected: boolean;
	elevenlabs_connected?: boolean;
	tavily_connected?: boolean;
	supabase_configured?: boolean;
	stripe_configured?: boolean;
	v0_configured?: boolean;
	elevenlabs_configured?: boolean;
	tavily_configured?: boolean;
	supabase_enabled?: boolean;
	stripe_enabled?: boolean;
	v0_enabled?: boolean;
	elevenlabs_enabled?: boolean;
	tavily_enabled?: boolean;
	/** True when the backend could not be reached, as opposed to genuinely disconnected. */
	backend_offline?: boolean;
}

const DISCONNECTED_STATUS: AuthStatus = {
	github_connected: false,
	vercel_connected: false,
	supabase_connected: false,
	stripe_connected: false,
	v0_connected: false,
	elevenlabs_connected: false,
	tavily_connected: false
};

export function createAuthApi(transport: Transport) {
	return {
		getAuthStatus: async (userId: string = 'default'): Promise<AuthStatus> => {
			try {
				const response = await transport.get(`/api/auth/status?user_id=${userId}`);
				// transport.get returns a mock ({} for this route) when the request
				// fails, so a missing github_connected means the backend never
				// answered - not that every provider is disconnected. Without this
				// check every badge silently reads "disconnected" while the backend
				// is simply down.
				if (!response || typeof response.github_connected !== 'boolean') {
					return { ...DISCONNECTED_STATUS, backend_offline: true };
				}
				return response;
			} catch {
				return { ...DISCONNECTED_STATUS, backend_offline: true };
			}
		},

		getGitHubAuthUrl: async (userId: string = 'default'): Promise<{ authorization_url: string } | null> => {
			try {
				return await transport.get(`/api/auth/github/connect?user_id=${userId}`);
			} catch {
				return null;
			}
		},

		getVercelAuthUrl: async (userId: string = 'default'): Promise<{ authorization_url: string } | null> => {
			try {
				return await transport.get(`/api/auth/vercel/connect?user_id=${userId}`);
			} catch {
				return null;
			}
		},

		disconnectGitHub: async (userId: string = 'default'): Promise<{ status: string }> => {
			try {
				return await transport.post(`/api/auth/github/disconnect?user_id=${userId}`, {});
			} catch {
				return { status: 'error' };
			}
		},

		disconnectVercel: async (userId: string = 'default'): Promise<{ status: string }> => {
			try {
				return await transport.post(`/api/auth/vercel/disconnect?user_id=${userId}`, {});
			} catch {
				return { status: 'error' };
			}
		},

		toggleSaasConnector: async (
			provider: SaasConnector,
			enabled: boolean,
			userId: string = 'default'
		): Promise<{ status: string; connected: boolean } | null> => {
			try {
				return await transport.post(
					`/api/auth/${provider}/toggle?user_id=${userId}`,
					{ enabled }
				);
			} catch {
				return null;
			}
		},

		disconnectSaasConnector: async (
			provider: SaasConnector,
			userId: string = 'default'
		): Promise<{ status: string }> => {
			try {
				return await transport.post(`/api/auth/${provider}/disconnect?user_id=${userId}`, {});
			} catch {
				return { status: 'error' };
			}
		}
	};
}

