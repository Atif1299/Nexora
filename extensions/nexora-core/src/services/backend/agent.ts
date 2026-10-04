/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import type { SSEEvent, Transport } from './transport';

/** Agent turns call LiteLLM with tools; 30s aborts a healthy first completion. */
const AGENT_TURN_TIMEOUT_MS = 120000;

export interface AgentMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content?: string;
	tool_calls?: Array<{
		id: string;
		type: string;
		function: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
	name?: string;
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, any>;
}

export interface AgentTurnResponse {
	type: 'tool_calls' | 'final';
	content?: string;
	tool_calls?: ToolCall[];
	model_used: string;
}

export type AgentMode = 'ask' | 'agent';

/**
 * Which shell run_terminal_command will actually use.
 *
 * The engine cannot know this -- it may not even be on the same machine -- and
 * without it the model writes POSIX syntax everywhere. On Windows that makes
 * `cd x && npm install` a parse error rather than a command.
 */
function currentShell(): string {
	if (process.platform !== 'win32') {
		const unix = process.env.SHELL || '';
		return unix ? unix.split(/[\/]/).pop() || 'bash' : 'bash';
	}
	return /pwsh/i.test(vscode.env.shell || '') ? 'pwsh' : 'powershell';
}

export function createAgentApi(transport: Transport) {
	return {
		/**
		 * Execute one turn of the agent loop.
		 * Returns either tool calls to execute or a final answer.
		 * 
		 * @param mode 'ask' for read-only, 'agent' for read+write
		 */
		agentTurn: async (
			messages: AgentMessage[],
			workspaceId: string,
			workspacePath?: string,
			model?: string,
			mode: AgentMode = 'ask',
			sessionId?: string,
			signal?: AbortSignal
		): Promise<AgentTurnResponse> => {
			return await transport.post('/api/agent/turn', {
				messages,
				workspace_id: workspaceId,
				workspace_path: workspacePath,
				model,
				mode,
				max_tokens: 2048,
				session_id: sessionId,
				shell: currentShell()
			}, AGENT_TURN_TIMEOUT_MS, signal);
		},

		/**
		 * Stream one agent turn as SSE events (token, tool_calls, done, error).
		 */
		agentTurnStream: (
			messages: AgentMessage[],
			workspaceId: string,
			workspacePath?: string,
			model?: string,
			mode: AgentMode = 'ask',
			sessionId?: string,
			signal?: AbortSignal
		): AsyncIterable<SSEEvent> => {
			return transport.postStream('/api/agent/turn/stream', {
				messages,
				workspace_id: workspaceId,
				workspace_path: workspacePath,
				model,
				mode,
				max_tokens: 2048,
				session_id: sessionId,
				shell: currentShell()
			}, signal, AGENT_TURN_TIMEOUT_MS);
		},

		/**
		 * Get list of available agent tools.
		 */
		getTools: async (): Promise<{ tools: any[]; total: number }> => {
			try {
				return await transport.get('/api/agent/tools');
			} catch {
				return { tools: [], total: 0 };
			}
		}
	};
}
