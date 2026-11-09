/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Subagents (Phase 3): the agent hands one task to a subagent with `delegate`, and the
// IDE runs it as a second agent loop. Pure helpers, no vscode import, so they can be
// checked with plain Node.

import type { ToolCall } from './backend/agent';
import type { ToolResult } from './tools/executor';

/** At most this many subagents run at once; more `delegate` calls wait for a free slot. */
export const SUBAGENT_MAX_PARALLEL = 3;
/** A subagent's turn budget is the smaller of this and nexora.agent.maxTurns. */
export const SUBAGENT_MAX_TURNS = 25;
/** The answer handed back to the main agent is cut here. */
export const SUBAGENT_ANSWER_MAX = 16000;

const CUT_NOTE = '\n[... cut]';

export type SubagentState = 'running' | 'done' | 'failed' | 'stopped';

export interface DelegateCall {
	id: string;
	agent: string;
	task: string;
	/** LiteLLM id from the agent's front matter; '' means the main agent's model. */
	model: string;
}

/** A delegate call the engine approved (it adds `_subagent`); undefined for anything else. */
export function delegateCall(tc: ToolCall): DelegateCall | undefined {
	const args = tc.arguments || {};
	if (tc.name !== 'delegate' || typeof args._subagent !== 'string' || !args._subagent) {
		return undefined;
	}
	return {
		id: tc.id,
		agent: args._subagent,
		task: typeof args.task === 'string' ? args.task : '',
		model: typeof args._subagent_model === 'string' ? args._subagent_model : ''
	};
}

/** Runs fn over items with at most `limit` running at once; results keep the input order. */
export async function runLimited<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index], index);
		}
	};
	const workers: Promise<void>[] = [];
	for (let i = 0; i < Math.min(Math.max(1, limit), items.length); i++) {
		workers.push(worker());
	}
	await Promise.all(workers);
	return results;
}

/** The tool result the main agent sees for a finished subagent. */
export function subagentResult(r: { agent: string; answer: string; turns: number; costUsd: number; files: string[] }): ToolResult {
	const answer = r.answer.length <= SUBAGENT_ANSWER_MAX
		? r.answer
		: r.answer.slice(0, SUBAGENT_ANSWER_MAX - CUT_NOTE.length).trimEnd() + CUT_NOTE;
	return {
		success: true,
		data: { agent: r.agent, answer, turns: r.turns, cost_usd: r.costUsd, files_modified: r.files }
	};
}

/** "Subagent reviewer - done - 4 tools - $0.0123" */
export function subagentCardTitle(agent: string, state: SubagentState, toolCount: number, costUsd: number): string {
	const parts = ['Subagent ' + agent, state];
	if (toolCount > 0) {
		parts.push(toolCount + (toolCount === 1 ? ' tool' : ' tools'));
	}
	if (costUsd > 0) {
		parts.push('$' + costUsd.toFixed(4));
	}
	return parts.join(' - ');
}
