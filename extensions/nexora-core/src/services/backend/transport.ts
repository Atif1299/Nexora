/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BackendConfig } from '../backendClient';

/**
 * When true, GET failures rethrow instead of returning mock data.
 * Permanent: an unreachable engine must look unreachable.
 */
export const STRICT_BACKEND = true;

export type Transport = {
	get: (endpoint: string) => Promise<any>;
	/**
	 * GET that rejects instead of falling back to a mock response.
	 */
	getStrict: (endpoint: string) => Promise<any>;
	post: (endpoint: string, data: any) => Promise<any>;
	put: (endpoint: string, data?: any) => Promise<any>;
	delete: (endpoint: string) => Promise<any>;
};

/** Optional async provider for IDE SecretStorage API key headers. */
export type HeaderProvider = () => Promise<Record<string, string>>;

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

export function createTransport(
	config: BackendConfig,
	getExtraHeaders?: HeaderProvider
): Transport {
	async function buildHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		if (config.localToken) {
			headers['X-Nexora-Local-Token'] = config.localToken;
		}
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

	async function getJson(endpoint: string): Promise<any> {
		const url = `${config.baseUrl}${endpoint}`;
		const response = await fetchWithTimeout(url, {
			method: 'GET',
			headers: await buildHeaders()
		}, config.timeout);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		return await response.json();
	}

	return {
		get: getJson,
		getStrict: getJson,
		post: async (endpoint: string, data: any) => {
			const url = `${config.baseUrl}${endpoint}`;

			const response = await fetchWithTimeout(url, {
				method: 'POST',
				headers: await buildHeaders(),
				body: JSON.stringify(data)
			}, config.timeout);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return await response.json();
		},
		put: async (endpoint: string, data?: any) => {
			const url = `${config.baseUrl}${endpoint}`;

			const response = await fetchWithTimeout(url, {
				method: 'PUT',
				headers: await buildHeaders(),
				body: data ? JSON.stringify(data) : undefined
			}, config.timeout);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return await response.json();
		},
		delete: async (endpoint: string) => {
			const url = `${config.baseUrl}${endpoint}`;

			const response = await fetchWithTimeout(url, {
				method: 'DELETE',
				headers: await buildHeaders()
			}, config.timeout);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return await response.json();
		}
	};
}
