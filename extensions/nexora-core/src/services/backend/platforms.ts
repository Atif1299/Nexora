/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

export function createPlatformsApi(transport: Transport) {
	return {
		getPlatforms: async (): Promise<any[]> => {
			const response = await transport.get('/api/platforms');
			return response?.platforms || [];
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
