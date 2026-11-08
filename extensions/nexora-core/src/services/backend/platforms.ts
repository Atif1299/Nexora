/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';
import type { PlatformUsage } from '../platformUsage';

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
