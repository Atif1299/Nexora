/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

export interface InlineCompletionResult {
	completion: string;
	model: string;
	cost_usd: number;
}

export interface InlineCompletionRequest {
	prefix: string;
	suffix: string;
	language: string;
	path: string;
	model?: string;
	maxTokens?: number;
}

/** Abandoned after this; a slower answer has already been overtaken by typing. */
const TIMEOUT_MS = 4000;

export function createCompletionApi(transport: Transport) {
	return {
		/**
		 * Ask for the text that belongs at the cursor.
		 *
		 * Returns an empty completion rather than throwing: this runs while
		 * someone is typing, so a backend that is down or slow should be
		 * silence, never an error interrupting them.
		 */
		inline: async (
			request: InlineCompletionRequest,
			signal?: AbortSignal
		): Promise<InlineCompletionResult> => {
			try {
				const response = await transport.post(
					'/api/complete/inline',
					{
						prefix: request.prefix,
						suffix: request.suffix,
						language: request.language,
						path: request.path,
						model: request.model,
						max_tokens: request.maxTokens
					},
					TIMEOUT_MS,
					signal
				);
				return {
					completion: typeof response?.completion === 'string' ? response.completion : '',
					model: typeof response?.model === 'string' ? response.model : '',
					cost_usd: Number(response?.cost_usd) || 0
				};
			} catch {
				return { completion: '', model: '', cost_usd: 0 };
			}
		}
	};
}
