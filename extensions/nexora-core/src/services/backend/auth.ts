/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

export interface AuthStatus {
	github_connected: boolean;
	vercel_connected: boolean;
	supabase_connected: boolean;
	stripe_connected: boolean;
	v0_connected: boolean;
	supabase_configured?: boolean;
	stripe_configured?: boolean;
	v0_configured?: boolean;
	supabase_enabled?: boolean;
	stripe_enabled?: boolean;
	v0_enabled?: boolean;
}

export function createAuthApi(transport: Transport) {
	return {
		getAuthStatus: async (userId: string = 'default'): Promise<AuthStatus> => {
			try {
				const response = await transport.get(`/api/auth/status?user_id=${userId}`);
				return response || {
					github_connected: false,
					vercel_connected: false,
					supabase_connected: false,
					stripe_connected: false,
					v0_connected: false
				};
			} catch {
				return {
					github_connected: false,
					vercel_connected: false,
					supabase_connected: false,
					stripe_connected: false,
					v0_connected: false
				};
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
			provider: 'supabase' | 'stripe' | 'v0',
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
			provider: 'supabase' | 'stripe' | 'v0',
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

