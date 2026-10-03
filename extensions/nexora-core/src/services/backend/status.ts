/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

export interface ProviderStatus {
	status: 'connected' | 'not_configured' | 'error' | string;
	models?: string[];
	username?: string;
	team?: string;
	error?: string;
}

export interface ConnectionsResponse {
	llm: Record<string, ProviderStatus>;
	deployment: Record<string, ProviderStatus>;
	database: Record<string, ProviderStatus>;
	saas?: Record<string, ProviderStatus>;
}

export interface TestResult {
	success: boolean;
	provider: string;
	details?: string;
	error?: string;
}

export function createStatusApi(transport: Transport) {
	return {
		getConnections: async (userId: string = 'default'): Promise<ConnectionsResponse | null> => {
			try {
				return await transport.get(`/api/status/connections?user_id=${encodeURIComponent(userId)}`);
			} catch {
				return null;
			}
		},

		testProvider: async (provider: string, userId: string = 'default'): Promise<TestResult | null> => {
			try {
				return await transport.post(
					`/api/status/test/${encodeURIComponent(provider)}?user_id=${encodeURIComponent(userId)}`,
					{}
				);
			} catch {
				return null;
			}
		},

		/** Option A: validate key in JSON body; backend does not persist it. */
		validateApiKey: async (provider: string, apiKey: string): Promise<TestResult | null> => {
			try {
				return await transport.post('/api/status/validate-key', {
					provider,
					api_key: apiKey
				});
			} catch {
				return { success: false, provider, error: 'Validation request failed (is backend running?)' };
			}
		}
	};
}
