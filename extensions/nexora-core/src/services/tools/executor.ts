/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import type { ToolCall } from '../backend/agent';
import { readFileTool } from './readFile';
import { grepTool } from './grep';
import { listFilesTool } from './listFiles';
import { writeFileTool } from './writeFile';
import { applyPatchTool, insertLinesTool } from './applyPatch';
import {
	readCommandOutputTool,
	runTerminalCommandTool,
	stopCommandTool,
	type TerminalCommandProgress
} from './terminalCommand';
import { executePlatformTool } from './platformTool';
import { getDiagnosticsTool, withErrorsAfterEdit } from './diagnostics';
import {
	browserClickTool,
	browserPressTool,
	browserSelectTool,
	browserSnapshotTool,
	browserTypeTool,
	openBrowserTool
} from './openBrowser';

export interface ToolResult {
	success: boolean;
	data?: any;
	error?: string;
	truncated?: boolean;
}

export interface ExecuteToolCallsOptions {
	cancellationToken?: vscode.CancellationToken;
	onToolProgress?: (toolCallId: string, name: string, progress: TerminalCommandProgress) => void;
	/** todo_write: the agent's current checklist, for the chat to show. */
	onTodos?: (todos: TodoItem[]) => void;
}

export interface ExecutedToolCall {
	id: string;
	name: string;
	result: ToolResult;
}

/**
 * Execute tool calls from the agent.
 * File-based tools run here in the extension (have filesystem access).
 * search_codebase is pre-executed on backend (has Memvid access).
 */
export async function executeToolCalls(
	toolCalls: ToolCall[],
	workspaceRoot: string,
	options?: ExecuteToolCallsOptions
): Promise<ExecutedToolCall[]> {
	const results: ExecutedToolCall[] = [];
	let i = 0;
	while (i < toolCalls.length) {
		// Reads next to each other run at the same time; edits, commands and
		// platform calls run one by one, in the order the model asked for them.
		if (isParallelSafe(toolCalls[i])) {
			let j = i;
			while (j < toolCalls.length && isParallelSafe(toolCalls[j])) {
				j++;
			}
			results.push(...await Promise.all(toolCalls.slice(i, j).map((tc) => executeOne(tc, workspaceRoot, options))));
			i = j;
		} else {
			results.push(await executeOne(toolCalls[i], workspaceRoot, options));
			i++;
		}
	}
	return results;
}

/** Tools that only read, so several can run at once. */
const PARALLEL_SAFE = new Set(['read_file', 'grep', 'list_files', 'get_diagnostics', 'read_command_output']);

function isParallelSafe(tc: ToolCall): boolean {
	const args = tc.arguments || {};
	if (typeof args._platform === 'string') {
		return false;
	}
	return PARALLEL_SAFE.has(tc.name) || (args._executed === true && !!args._result);
}

async function executeOne(
	tc: ToolCall,
	workspaceRoot: string,
	options?: ExecuteToolCallsOptions
): Promise<ExecutedToolCall> {
	{
		const args = tc.arguments;

		// A connected platform's tool. The engine deliberately did not run it:
		// the call leaves the machine, so the user approves it here first and
		// the engine then makes the call with the credential it holds.
		if (typeof args._platform === 'string' && typeof args._platform_tool === 'string') {
			return {
				id: tc.id,
				name: tc.name,
				result: await executePlatformTool(
					args._platform,
					args._platform_tool,
					args as Record<string, unknown>,
					args._read_only_hint === true
				)
			};
		}

		// Already run by the engine, because that is where the data lives:
		// the memory, codebase-search and web tools.
		if (args._executed && args._result) {
			return {
				id: tc.id,
				name: tc.name,
				result: args._result as ToolResult
			};
		}

		let result: ToolResult;

		try {
			switch (tc.name) {
				case 'read_file':
					result = await readFileTool(
						workspaceRoot,
						args.path,
						args.start_line,
						args.end_line
					);
					break;

				case 'grep':
					result = await grepTool(
						workspaceRoot,
						args.pattern,
						args.glob || '**/*',
						args.max_results || 50,
						{ mode: args.output_mode, context: args.context, caseInsensitive: args.case_insensitive === true }
					);
					break;

				case 'list_files':
					result = await listFilesTool(
						workspaceRoot,
						args.glob || '**/*',
						args.max_results || 100
					);
					break;

				// Each edit comes back with the editor's errors in that file (errors_after_edit).
				case 'write_file':
					result = await withErrorsAfterEdit(await writeFileTool(
						workspaceRoot,
						args.path,
						args.content,
						true
					), path.resolve(workspaceRoot, String(args.path || '')));
					break;

				case 'apply_patch':
					result = await withErrorsAfterEdit(await applyPatchTool(
						workspaceRoot,
						args.path,
						args.old_text,
						args.new_text,
						true,
						args.replace_all === true
					), path.resolve(workspaceRoot, String(args.path || '')));
					break;

				case 'insert_lines':
					result = await withErrorsAfterEdit(await insertLinesTool(
						workspaceRoot,
						args.path,
						args.line_number,
						args.lines,
						true
					), path.resolve(workspaceRoot, String(args.path || '')));
					break;

				case 'get_diagnostics':
					result = await getDiagnosticsTool(workspaceRoot, args.path, args.include_warnings !== false);
					break;

				case 'run_terminal_command':
					result = await runTerminalCommandTool(
						workspaceRoot,
						args.command,
						args.cwd,
						args.timeout_ms,
						{
							cancellationToken: options?.cancellationToken,
							onProgress: options?.onToolProgress
								? (progress) => options.onToolProgress!(tc.id, tc.name, progress)
								: undefined,
							background: args.run_in_background === true
						}
					);
					break;

				case 'read_command_output':
					result = readCommandOutputTool(args.id);
					break;

				case 'stop_command':
					result = stopCommandTool(args.id);
					break;

				case 'open_browser':
					result = await openBrowserTool(args.url);
					break;

				case 'browser_snapshot':
					result = await browserSnapshotTool();
					break;

				case 'browser_click':
					result = await browserClickTool(args.selector, args.text);
					break;

				case 'browser_type':
					result = await browserTypeTool(args.text, args.selector, args.submit);
					break;

				case 'browser_select':
					result = await browserSelectTool(args.selector, args.text, args.option);
					break;

				case 'browser_press':
					result = await browserPressTool(args.key);
					break;

				case 'todo_write':
					result = todoWriteTool(args.todos, options?.onTodos);
					break;

				default:
					result = {
						success: false,
						error: `Unknown tool: ${tc.name}`
					};
			}
		} catch (err) {
			result = {
				success: false,
				error: err instanceof Error ? err.message : String(err)
			};
		}

		return {
			id: tc.id,
			name: tc.name,
			result
		};
	}
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed';
export interface TodoItem {
	content: string;
	status: TodoStatus;
}

const TODO_STATUSES = new Set<TodoStatus>(['pending', 'in_progress', 'completed']);

/**
 * todo_write: the agent's checklist for a task of several steps. Each call
 * sends the whole list; the chat shows it as a checklist (onTodos).
 */
export function todoWriteTool(raw: unknown, onTodos?: (todos: TodoItem[]) => void): ToolResult {
	if (!Array.isArray(raw)) {
		return { success: false, error: 'todos must be a list of { content, status }.' };
	}
	const todos: TodoItem[] = [];
	for (const item of raw.slice(0, 20)) {
		const content = typeof item?.content === 'string' ? item.content.trim().slice(0, 200) : '';
		const status = TODO_STATUSES.has(item?.status) ? item.status as TodoStatus : 'pending';
		if (content) {
			todos.push({ content, status });
		}
	}
	if (todos.length === 0) {
		return { success: false, error: 'todos is empty.' };
	}
	onTodos?.(todos);
	const done = todos.filter((t) => t.status === 'completed').length;
	const current = todos.find((t) => t.status === 'in_progress');
	const notes: string[] = [];
	if (todos.filter((t) => t.status === 'in_progress').length > 1) {
		notes.push('Keep only one item in_progress at a time.');
	}
	if (done < todos.length) {
		// The 8 Nov test ended with "3 of 4 done" while the answer said all done.
		notes.push('Before your final answer, call todo_write again with every finished item marked completed.');
	}
	return {
		success: true,
		data: {
			summary: `${done} of ${todos.length} done${current ? `; now: ${current.content}` : ''}`,
			note: notes.length ? notes.join(' ') : undefined
		}
	};
}

/**
 * Format tool results as messages for the next agent turn.
 */
export function formatToolResultsAsMessages(
	executedCalls: ExecutedToolCall[]
): Array<{ role: 'tool'; tool_call_id: string; name: string; content: string }> {
	return executedCalls.map(ec => ({
		role: 'tool' as const,
		tool_call_id: ec.id,
		name: ec.name,
		content: JSON.stringify(ec.result)
	}));
}
