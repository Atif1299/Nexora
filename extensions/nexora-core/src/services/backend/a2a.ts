/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

export interface A2ADelegateResult {
	success: boolean;
	task_id?: string;
	status?: string;
	error?: string;
}

export function createA2AApi(transport: Transport) {
	return {
		delegate: async (
			agentUrl: string,
			taskType: string,
			taskInput: Record<string, unknown>
		): Promise<A2ADelegateResult> => {
			try {
				return await transport.post('/api/a2a/delegate', {
					agent_url: agentUrl,
					task_type: taskType,
					task_input: taskInput,
					wait_for_completion: false
				});
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : 'A2A delegate failed'
				};
			}
		}
	};
}
