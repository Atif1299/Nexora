/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getAgentFlag, shouldConfirmTerminal } from '../agentRunMode';
import type { ToolResult } from './executor';
import {
	type AgentShell,
	BackgroundJobs,
	DEFAULT_TIMEOUT_MS,
	MAX_TIMEOUT_MS,
	cleanTerminalText,
	describeEnding,
	isJobError,
	resolveAgentShell,
	runCommand,
	truncateMiddle
} from './commandRunner';
import { ensureRuntimeProbe, noteCommandRan, notFoundHint } from './runtimeProbe';

/** Installs get the full ten minutes without the model having to ask. */
const LONG_TIMEOUT_MS = MAX_TIMEOUT_MS;
const AGENT_VIEW_NAME = 'Nexora Agent';
const PROGRESS_INTERVAL_MS = 400;
const PREVIEW_LINE_COUNT = 12;
const VIEW_CLOSE_DELAY_MS = 800;

/**
 * Commands that are unconditionally blocked regardless of user confirmation.
 * Patterns are tested against the full command string (case-insensitive).
 */
const DENYLIST: RegExp[] = [
	/rm\s+-rf\s+\//i,
	/rmdir\s+\/s\s+\/q/i,
	/del\s+\/s/i,
	/format\s+[a-z]:/i,
	/mkfs/i,
	/dd\s+if=/i,
	/>\s*\/dev\/[sh]d[a-z]/i,
];

export type TerminalCommandStatus =
	| 'confirming'
	| 'running'
	| 'succeeded'
	| 'failed'
	| 'cancelled'
	| 'timeout';

export type TerminalCommandProgress = {
	command: string;
	elapsedMs: number;
	preview: string;
	status: TerminalCommandStatus;
	exitCode?: number;
};

export type RunTerminalCommandOptions = {
	cancellationToken?: vscode.CancellationToken;
	onProgress?: (progress: TerminalCommandProgress) => void;
	/** Start the command and return after a first look instead of waiting for it. */
	background?: boolean;
};

let cachedShell: { preference: string; shell: AgentShell } | undefined;

/** The shell agent commands run in (setting `nexora.agent.shell`, default auto). */
export function agentShell(): AgentShell {
	const preference = vscode.workspace.getConfiguration('nexora.agent').get<string>('shell', 'auto') || 'auto';
	if (!cachedShell || cachedShell.preference !== preference) {
		cachedShell = { preference, shell: resolveAgentShell(preference) };
	}
	return cachedShell.shell;
}

/** The folder the agent's next command runs in, per workspace (kept between commands). */
const sessionCwd = new Map<string, string>();

export function agentCwd(workspaceRoot: string): string {
	const cwd = sessionCwd.get(workspaceRoot);
	return cwd && isInside(workspaceRoot, cwd) && isDirectory(cwd) ? cwd : workspaceRoot;
}

/**
 * Back to the workspace root. Called when a new agent run starts (a new user
 * message or plan step): a `cd` carries over between the commands of one run,
 * but "here" in the next message means the project, not the folder an earlier
 * answer ended in (8 Nov test: `cd demo` leaked into the next two messages).
 */
export function resetAgentCwd(workspaceRoot: string): void {
	sessionCwd.delete(workspaceRoot);
}

const background = new BackgroundJobs();

/** Background commands the agent has started and not stopped (for the prompt). */
export function backgroundCommands(): Array<{ id: string; command: string; status: string }> {
	return background.list().map(({ id, command, status }) => ({ id, command, status }));
}

/** Stop every background command (chat stopped, extension deactivated). */
export function stopAllBackgroundCommands(): void {
	background.stopAll();
}

function isInside(root: string, candidate: string): boolean {
	const rel = path.relative(path.resolve(root), path.resolve(candidate));
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isDirectory(dir: string): boolean {
	try {
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
}

function lastLines(text: string, count: number): string {
	const lines = cleanTerminalText(text).split('\n');
	while (lines.length && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines.slice(-count).join('\n');
}

/**
 * A read-only terminal tab that mirrors what the agent runs, so the user sees
 * every command and its output live even though the process itself is hidden.
 */
class AgentView {
	private terminal: vscode.Terminal | undefined;
	private readonly writer = new vscode.EventEmitter<string>();
	private opened = false;
	private pending: string[] = [];
	private closeTimer: ReturnType<typeof setTimeout> | undefined;
	private interrupt: (() => void) | undefined;
	private busy = 0;

	begin(command: string, cwd: string, shell: AgentShell, onInterrupt: () => void): void {
		if (this.closeTimer) {
			clearTimeout(this.closeTimer);
			this.closeTimer = undefined;
		}
		this.busy++;
		this.interrupt = onInterrupt;
		this.ensure();
		this.write(`\x1b[2m${cwd} (${shell.label})\x1b[0m\r\n\x1b[1m$ ${command}\x1b[0m\r\n`);
		this.terminal?.show(true);
	}

	output(chunk: string): void {
		this.write(chunk.replace(/\r?\n/g, '\r\n'));
	}

	end(summary: string): void {
		this.write(`\x1b[2m${summary}\x1b[0m\r\n\r\n`);
		this.busy = Math.max(0, this.busy - 1);
		this.interrupt = undefined;
		if (this.busy === 0 && getAgentFlag('autoCloseTerminal')) {
			this.closeTimer = setTimeout(() => {
				this.closeTimer = undefined;
				if (this.busy === 0) {
					this.terminal?.dispose();
				}
			}, VIEW_CLOSE_DELAY_MS);
		}
	}

	private write(text: string): void {
		if (this.opened) {
			this.writer.fire(text);
		} else {
			this.pending.push(text);
		}
	}

	private ensure(): void {
		if (this.terminal && this.terminal.exitStatus === undefined) {
			return;
		}
		this.opened = false;
		const pty: vscode.Pseudoterminal = {
			onDidWrite: this.writer.event,
			open: () => {
				this.opened = true;
				for (const text of this.pending.splice(0)) {
					this.writer.fire(text);
				}
			},
			close: () => {
				this.terminal = undefined;
				this.opened = false;
			},
			handleInput: (data) => {
				// Ctrl+C in the view stops the running command.
				if (data === '\x03') {
					this.interrupt?.();
				}
			}
		};
		this.terminal = vscode.window.createTerminal({
			name: AGENT_VIEW_NAME,
			pty,
			iconPath: new vscode.ThemeIcon('terminal'),
			isTransient: true
		});
	}
}

const view = new AgentView();

async function confirmCommand(
	command: string,
	displayCmd: string,
	token?: vscode.CancellationToken
): Promise<boolean> {
	if (!shouldConfirmTerminal(command)) {
		return true;
	}
	if (token?.isCancellationRequested) {
		return false;
	}
	return await new Promise<boolean>((resolve) => {
		let settled = false;
		const finish = (allowed: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			cancelSub?.dispose();
			resolve(allowed);
		};
		const cancelSub = token?.onCancellationRequested(() => finish(false));
		void vscode.window.showWarningMessage(
			`Nexora wants to run: \`${displayCmd}\``,
			'Allow',
			'Deny'
		).then((choice) => finish(choice === 'Allow'));
	});
}

function isLongRunningCommand(command: string): boolean {
	return /\b(npm|pnpm|yarn|bun)\s+(install|ci|add|update)\b/i.test(command)
		|| /\bpip(?:3)?\s+install\b/i.test(command)
		|| /\buv\s+(pip\s+install|sync|add)\b/i.test(command)
		|| /\b(cargo|go)\s+(build|test|install)\b/i.test(command);
}

/**
 * Run a shell command for the agent.
 *
 * - Checked against a denylist, then approved according to the run mode.
 * - Runs as a hidden process in the agent's shell (`agentShell`), in the
 *   folder the previous command ended in unless `cwd` is given; the folder it
 *   ends in is reported and kept, and moved back to the workspace root if it
 *   left the workspace.
 * - Output is mirrored live to the "Nexora Agent" tab and the chat; the model
 *   gets clean text, its first 4 KB and last 16 KB.
 * - Default timeout 2 min (installs 10 min, maximum 10 min).
 */
export async function runTerminalCommandTool(
	workspaceRoot: string,
	command: string,
	cwd?: string,
	timeoutMs?: number,
	options?: RunTerminalCommandOptions
): Promise<ToolResult> {
	const token = options?.cancellationToken;
	const startedAt = Date.now();
	const emit = (status: TerminalCommandStatus, preview: string, exitCode?: number) => {
		options?.onProgress?.({ command, elapsedMs: Date.now() - startedAt, preview, status, exitCode });
	};

	if (!command || !command.trim()) {
		return { success: false, error: 'No command given.' };
	}
	for (const pattern of DENYLIST) {
		if (pattern.test(command)) {
			return { success: false, error: `Command blocked by security policy: "${command}"` };
		}
	}

	// `cwd` is relative to the workspace root (as the tool schema says), never to
	// the current folder: resolving "app" inside "app" is the doubled-path bug.
	const startCwd = cwd ? path.resolve(workspaceRoot, cwd) : agentCwd(workspaceRoot);
	if (!isInside(workspaceRoot, startCwd)) {
		return { success: false, error: `cwd must be inside the workspace ("${workspaceRoot}"). Got "${startCwd}".` };
	}
	if (!isDirectory(startCwd)) {
		return { success: false, error: `Folder not found: "${startCwd}".` };
	}

	let effectiveTimeout = timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
	if (isLongRunningCommand(command)) {
		effectiveTimeout = Math.max(effectiveTimeout, LONG_TIMEOUT_MS);
	}
	effectiveTimeout = Math.min(effectiveTimeout, MAX_TIMEOUT_MS);

	emit('confirming', '');
	const displayCmd = command.length > 80 ? command.slice(0, 77) + '...' : command;
	if (!(await confirmCommand(command, displayCmd, token))) {
		const cancelled = !!token?.isCancellationRequested;
		emit('cancelled', '');
		return { success: false, error: cancelled ? 'Command cancelled.' : 'The user denied this command. Ask what to do instead, or take another approach.' };
	}

	// What works on this PC (and the PATH fixes for it) before anything runs.
	const runtimes = await ensureRuntimeProbe(workspaceRoot).catch(() => undefined);
	const shell = agentShell();
	const controller = new AbortController();
	const cancelSub = token?.onCancellationRequested(() => controller.abort());
	view.begin(command, startCwd, shell, () => controller.abort());

	let live = '';
	let lastEmit = 0;
	const onOutput = (chunk: string) => {
		view.output(chunk);
		live = (live + chunk).slice(-8192);
		const now = Date.now();
		if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
			lastEmit = now;
			emit('running', lastLines(live, PREVIEW_LINE_COUNT));
		}
	};
	emit('running', 'starting...');
	const ticker = setInterval(() => emit('running', lastLines(live, PREVIEW_LINE_COUNT)), PROGRESS_INTERVAL_MS);

	try {
		if (options?.background) {
			const started = await background.start(shell, command, startCwd, onOutput);
			clearInterval(ticker);
			if (isJobError(started)) {
				view.end(started.error);
				emit('failed', '');
				return { success: false, error: started.error };
			}
			const { job, output } = started;
			const running = job.status === 'running';
			noteCommandRan(workspaceRoot, command);
			const bgHint = running ? undefined : notFoundHint(command, output, job.exitCode, runtimes);
			view.end(running ? `started in the background as ${job.id}` : `exited ${job.exitCode}`);
			emit(running || job.exitCode === 0 ? 'succeeded' : 'failed', lastLines(output, PREVIEW_LINE_COUNT), job.exitCode ?? undefined);
			return {
				success: running || job.exitCode === 0,
				error: running ? undefined : `The command exited (${job.exitCode}) within a few seconds instead of running in the background. Read the output.`,
				data: {
					id: job.id,
					status: job.status,
					exit_code: job.exitCode,
					cwd: startCwd,
					output,
					note: running ? `Running as ${job.id}. Use read_command_output("${job.id}") to see new output and stop_command("${job.id}") to stop it.` : undefined,
					hint: bgHint
				}
			};
		}

		const result = await runCommand({ shell, command, cwd: startCwd, timeoutMs: effectiveTimeout, signal: controller.signal, onOutput });
		clearInterval(ticker);
		noteCommandRan(workspaceRoot, command);
		const hint = notFoundHint(command, result.output, result.exitCode, runtimes);

		let endCwd = result.finalCwd ?? startCwd;
		let cwdNote: string | undefined;
		if (!isInside(workspaceRoot, endCwd) || !isDirectory(endCwd)) {
			cwdNote = `The command ended outside the workspace (${endCwd}); the next command starts in the workspace root.`;
			endCwd = workspaceRoot;
		}
		sessionCwd.set(workspaceRoot, endCwd);

		const forModel = truncateMiddle(result.output);
		const ending = describeEnding(result, effectiveTimeout);
		const ok = result.exitCode === 0;
		const status: TerminalCommandStatus = result.cancelled ? 'cancelled' : result.timedOut ? 'timeout' : ok ? 'succeeded' : 'failed';
		const seconds = (result.durationMs / 1000).toFixed(1);
		view.end(result.exitCode === null ? (ending ?? 'stopped') : `exit ${result.exitCode} in ${seconds} s`);
		emit(status, lastLines(result.output, PREVIEW_LINE_COUNT), result.exitCode ?? -1);
		return {
			success: ok,
			error: ending,
			data: {
				exit_code: result.exitCode,
				duration_s: Number(seconds),
				cwd: endCwd,
				shell: shell.label,
				output: forModel.text || '(no output)',
				note: cwdNote,
				hint
			},
			truncated: forModel.truncated
		};
	} finally {
		clearInterval(ticker);
		cancelSub?.dispose();
	}
}

/** New output of a background command since the last read. */
export function readCommandOutputTool(id: string): ToolResult {
	const read = background.read(String(id || ''));
	if (isJobError(read)) {
		return { success: false, error: read.error };
	}
	const { job, output, lost } = read;
	return {
		success: true,
		data: {
			id: job.id,
			status: job.status,
			exit_code: job.exitCode,
			output: output || '(no new output)',
			note: lost ? 'Some output was produced faster than it could be kept; the oldest part is missing.' : undefined
		}
	};
}

/** Stop a background command. */
export function stopCommandTool(id: string): ToolResult {
	const stopped = background.stop(String(id || ''));
	if (isJobError(stopped)) {
		return { success: false, error: stopped.error };
	}
	return { success: true, data: { id: stopped.job.id, status: stopped.job.status } };
}
