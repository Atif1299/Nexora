/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Hooks (Phase 4): the user's commands around prompts, tool calls and the end of a run.
// The engine runs them (/api/hooks/run); these helpers shape what the chat does with the
// outcome. Pure, no vscode import.

import type { ToolCall } from './backend/agent';
import type { ToolResult } from './tools/executor';

/** A Stop hook may send the agent back to work at most this many times per run. */
export const MAX_STOP_CONTINUATIONS = 3;

export interface HookOutcome {
	blocked: boolean;
	reason: string;
	context: string;
	stop: boolean;
	warnings: string[];
	ran: Array<{ id: string; exit_code: number | null; blocked: boolean }>;
}

/** What the model gets for a call a PreToolUse hook blocked. */
export function hookBlockedResult(reason: string): ToolResult {
	return { success: false, error: 'Blocked by a hook: ' + reason };
}

/** A PostToolUse hook's message for the model, carried on the tool result. */
export function withHookFeedback(result: ToolResult, feedback: string): ToolResult {
	return feedback ? { ...result, hook_feedback: feedback } : result;
}

/** The message sent when UserPromptSubmit or SessionStart hooks add context. */
export function promptWithHookContext(text: string, context: string): string {
	return context ? text + '\n\n[Context from hooks]\n' + context : text;
}

/** The instruction a blocking Stop hook sends back to the agent. */
export function stopContinuation(reason: string): string {
	return 'A hook asked you to keep working before you finish: ' + reason;
}

/** What the user sees when a hook stops their message. */
export function hookRefusal(_event: string, reason: string): string {
	return 'A hook stopped this message: ' + reason;
}

/** The tool part of a hook payload: Nexora's name and arguments (the engine adds Claude Code's names). */
export function toolHookPayload(tc: ToolCall): { tool_name: string; tool_input: Record<string, unknown> } {
	const input: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(tc.arguments || {})) {
		if (!key.startsWith('_')) {
			input[key] = value;
		}
	}
	return { tool_name: tc.name, tool_input: input };
}
