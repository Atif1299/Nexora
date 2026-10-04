/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Run one local coding agent to completion and report what it did.
 *
 * The agent is a subprocess that streams newline-delimited JSON while it
 * works. This module turns that stream into the two things Nexora needs: live
 * progress for the activity card, and a final verdict with the agent's own
 * cost figure. It does not touch the user's files -- the agent writes inside a
 * worktree, and reviewing what came back belongs to the caller.
 */

import * as cp from 'child_process';
import * as readline from 'readline';
import * as vscode from 'vscode';

import type { LocalAgentProbe, LocalAgentSpec } from './localAgents';

/** A run cannot outlast this, however quiet the agent goes. */
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

export interface LocalAgentProgress {
	kind: 'text' | 'tool' | 'turn';
	/** Assistant prose, for 'text'. */
	text?: string;
	/** Tool name the agent invoked, for 'tool'. */
	tool?: string;
	/** Turns consumed so far, for 'turn'. */
	turn?: number;
}

export interface LocalAgentRunResult {
	success: boolean;
	/** One line fit for the DAG task result. */
	summary: string;
	/** The agent's own spend figure, when it reports one. */
	costUsd?: number;
	numTurns?: number;
	sessionId?: string;
	/** Set when the run could not start or did not finish cleanly. */
	error?: string;
}

export interface LocalAgentRunOptions {
	spec: LocalAgentSpec;
	probe: LocalAgentProbe;
	/** Worktree the agent edits. Never the real workspace. */
	cwd: string;
	prompt: string;
	runId: string;
	model?: string;
	maxTurns: number;
	maxBudgetUsd?: number;
	token?: vscode.CancellationToken;
	onProgress?: (progress: LocalAgentProgress) => void;
}

/** Windows npm shims are .cmd, which Node refuses to spawn without a shell. */
function needsShell(file: string): boolean {
	return process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
}

/**
 * One NDJSON line from the agent, reduced to what Nexora cares about.
 *
 * The three agents do not share a schema, so this reads defensively: an
 * unrecognised line is progress we cannot label, never a failure.
 */
function interpret(line: string, onProgress?: (p: LocalAgentProgress) => void): {
	result?: LocalAgentRunResult;
} {
	let event: any;
	try {
		event = JSON.parse(line);
	} catch {
		return {};
	}
	if (!event || typeof event !== 'object') {
		return {};
	}

	// Claude Code and Cursor both end with a `result` message.
	if (event.type === 'result') {
		const isError = event.is_error === true || event.subtype === 'error_max_turns';
		const text = typeof event.result === 'string' ? event.result : '';
		return {
			result: {
				success: !isError,
				summary: text,
				costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : undefined,
				numTurns: typeof event.num_turns === 'number' ? event.num_turns : undefined,
				sessionId: typeof event.session_id === 'string' ? event.session_id : undefined,
				error: isError ? text || String(event.subtype || 'agent reported an error') : undefined
			}
		};
	}

	if (event.type === 'assistant' && event.message?.content) {
		const content = Array.isArray(event.message.content) ? event.message.content : [];
		for (const block of content) {
			if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
				onProgress?.({ kind: 'text', text: block.text });
			} else if (block?.type === 'tool_use' && typeof block.name === 'string') {
				onProgress?.({ kind: 'tool', tool: block.name });
			}
		}
	}

	return {};
}

/**
 * Spawn the agent and wait for its verdict.
 *
 * Never throws for an agent that merely fails: a failed run is a result the
 * DAG can record and show. Exceptions are reserved for not being able to start
 * one at all.
 */
export async function runLocalAgent(options: LocalAgentRunOptions): Promise<LocalAgentRunResult> {
	const { spec, probe, cwd, prompt } = options;
	const file = probe.path;
	if (!probe.installed || !file) {
		return {
			success: false,
			summary: `${spec.name} is not installed`,
			error: `${spec.binary} was not found on PATH. Install it with: ${spec.installHint}`
		};
	}

	const shell = needsShell(file);
	if (shell && spec.promptChannel === 'argv') {
		// The prompt would have to survive cmd.exe parsing, where a stray & or
		// ^ changes what runs. Refusing is the only honest answer until this
		// agent's run path passes the prompt out of band.
		return {
			success: false,
			summary: `${spec.name} cannot be run safely from this shim on Windows`,
			error:
				`${spec.name} resolves to ${file}, which Nexora would have to launch through cmd.exe. ` +
				'Passing the task text that way is not safe, so the run was not started.'
		};
	}

	const args = spec.runArgs({
		sessionId: options.runId,
		model: options.model,
		maxTurns: options.maxTurns,
		maxBudgetUsd: options.maxBudgetUsd,
		prompt
	});

	return new Promise<LocalAgentRunResult>((resolve) => {
		let settled = false;
		let finalResult: LocalAgentRunResult | undefined;
		let lastText = '';
		let stderrTail = '';

		const child = cp.spawn(file, args, {
			cwd,
			shell,
			windowsHide: true,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: { ...process.env }
		});

		const finish = (result: LocalAgentRunResult) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			cancelReg?.dispose();
			resolve(result);
		};

		const kill = () => {
			if (child.pid && process.platform === 'win32') {
				cp.execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => undefined);
			} else {
				child.kill('SIGTERM');
			}
		};

		const timer = setTimeout(() => {
			kill();
			finish({
				success: false,
				summary: `${spec.name} timed out`,
				error: `No result after ${Math.round(RUN_TIMEOUT_MS / 60000)} minutes.`
			});
		}, RUN_TIMEOUT_MS);

		const cancelReg = options.token?.onCancellationRequested(() => {
			kill();
			finish({ success: false, summary: `${spec.name} was cancelled`, error: 'Cancelled' });
		});

		child.on('error', (err) => {
			finish({
				success: false,
				summary: `Could not start ${spec.name}`,
				error: err instanceof Error ? err.message : String(err)
			});
		});

		if (child.stdout) {
			readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
				const trimmed = line.trim();
				if (!trimmed) {
					return;
				}
				const { result } = interpret(trimmed, (progress) => {
					if (progress.kind === 'text' && progress.text) {
						lastText = progress.text;
					}
					options.onProgress?.(progress);
				});
				if (result) {
					finalResult = result;
				}
			});
		}

		if (child.stderr) {
			child.stderr.on('data', (chunk) => {
				// Keep only the tail: a failing agent can be noisy, and the end
				// is where the reason is.
				stderrTail = (stderrTail + String(chunk)).slice(-2000);
			});
		}

		// The prompt goes over stdin when the agent supports it, so nothing the
		// user wrote has to be quoted for a shell.
		if (spec.promptChannel === 'stream-json-stdin') {
			const message = JSON.stringify({
				type: 'user',
				message: { role: 'user', content: prompt },
				parent_tool_use_id: null
			});
			child.stdin?.end(message + '\n');
		} else {
			child.stdin?.end();
		}

		child.on('close', (code) => {
			if (finalResult) {
				finish(finalResult);
				return;
			}
			if (code === 0) {
				// Exited cleanly without a result message: treat the last thing
				// it said as the answer rather than inventing a failure.
				finish({
					success: true,
					summary: lastText.split(/\r?\n/).find((l) => l.trim())?.trim() || `${spec.name} finished`
				});
				return;
			}
			finish({
				success: false,
				summary: `${spec.name} exited with code ${code}`,
				error: stderrTail.trim() || `Exit code ${code}`
			});
		});
	});
}
