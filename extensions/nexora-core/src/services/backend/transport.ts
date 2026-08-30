/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BackendConfig } from '../backendClient';

export type Transport = {
	get: (endpoint: string) => Promise<any>;
	/**
	 * GET that rejects instead of falling back to a mock response.
	 *
	 * `get` returns mock data when the backend is unreachable, which is fine for panels
	 * that only need something to render. It is wrong for the analytics dashboard: a
	 * cost readout of $0.00 is a factual claim, and showing it when the backend is
	 * simply down is worse than showing nothing.
	 */
	getStrict: (endpoint: string) => Promise<any>;
	post: (endpoint: string, data: any) => Promise<any>;
	put: (endpoint: string, data?: any) => Promise<any>;
	delete: (endpoint: string) => Promise<any>;
};

/** Optional async provider for IDE SecretStorage API key headers. */
export type HeaderProvider = () => Promise<Record<string, string>>;

export function createTransport(
	config: BackendConfig,
	getMockResponse: (endpoint: string) => any,
	getExtraHeaders?: HeaderProvider
): Transport {
	async function buildHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		if (getExtraHeaders) {
			try {
				const extra = await getExtraHeaders();
				if (extra) {
					for (const [key, value] of Object.entries(extra)) {
						if (value) {
							headers[key] = value;
						}
					}
				}
			} catch {
				// Settings not ready - continue without IDE keys (.env fallback on backend)
			}
		}
		return headers;
	}

	return {
		get: async (endpoint: string) => {
			const url = `${config.baseUrl}${endpoint}`;
			try {
				const response = await fetch(url, {
					method: 'GET',
					headers: await buildHeaders()
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}

				return await response.json();
			} catch {
				return getMockResponse(endpoint);
			}
		},
		getStrict: async (endpoint: string) => {
			const url = `${config.baseUrl}${endpoint}`;
			const response = await fetch(url, {
				method: 'GET',
				headers: await buildHeaders()
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return await response.json();
		},
		post: async (endpoint: string, data: any) => {
			const url = `${config.baseUrl}${endpoint}`;

			const response = await fetch(url, {
				method: 'POST',
				headers: await buildHeaders(),
				body: JSON.stringify(data)
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return await response.json();
		},
		put: async (endpoint: string, data?: any) => {
			const url = `${config.baseUrl}${endpoint}`;

			const response = await fetch(url, {
				method: 'PUT',
				headers: await buildHeaders(),
				body: data ? JSON.stringify(data) : undefined
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return await response.json();
		},
		delete: async (endpoint: string) => {
			const url = `${config.baseUrl}${endpoint}`;

			const response = await fetch(url, {
				method: 'DELETE',
				headers: await buildHeaders()
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return await response.json();
		}
	};
}
