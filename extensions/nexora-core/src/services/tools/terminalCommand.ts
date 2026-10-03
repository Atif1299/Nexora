/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import { getAgentFlag, shouldConfirmTerminal } from '../agentRunMode';
import type { ToolResult } from './executor';

/** Maximum bytes returned to the LLM (16 KB per stream, kept from the tail). */
const MAX_OUTPUT_BYTES = 16 * 1024;

/** Keep a rolling capture buffer so the LLM still gets the end of long installs. */
const MAX_CAPTURE_CHARS = 256 * 1024;

/** Default / max timeouts. Streaming commands stay visible; installs need headroom. */
const DEFAULT_TIMEOUT_MS = 600_000;
const LONG_TIMEOUT_MS = 600_000;
const MAX_TIMEOUT_MS = 600_000;

const AGENT_TERMINAL_NAME = 'Nexora Agent';
const PROGRESS_INTERVAL_MS = 400;
const PREVIEW_LINE_COUNT = 12;

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
};

function isLongRunningCommand(command: string): boolean {
	return /\b(npm|pnpm|yarn|bun)\s+(install|ci|add|update)\b/i.test(command)
		|| /\bpip(?:3)?\s+install\b/i.test(command)
		|| /\b(cargo|go)\s+(build|test|install)\b/i.test(command);
}

function truncateTail(text: string): { text: string; truncated: boolean } {
	const buf = Buffer.from(text, 'utf8');
	if (buf.length <= MAX_OUTPUT_BYTES) {
		return { text, truncated: false };
	}
	return { text: buf.slice(buf.length - MAX_OUTPUT_BYTES).toString('utf8'), truncated: true };
}

function appendCapped(current: string, chunk: string): string {
	const next = current + chunk;
	if (next.length <= MAX_CAPTURE_CHARS) {
		return next;
	}
	return next.slice(next.length - MAX_CAPTURE_CHARS);
}

function stripAnsi(text: string): string {
	return text
		.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
		.replace(/\r/g, '');
}

function lastLines(text: string, count: number): string {
	const lines = stripAnsi(text).split(/\n/);
	while (lines.length && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines.slice(-count).join('\n');
}

function toTerminalText(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

function formatElapsed(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}:${s.toString().padStart(2, '0')}`;
}

function killProcessTree(child: cp.ChildProcess): void {
	if (!child.pid) {
		child.kill();
		return;
	}
	if (process.platform === 'win32') {
		cp.execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => undefined);
		return;
	}
	child.kill('SIGTERM');
	setTimeout(() => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL');
		}
	}, 1500);
}

class AgentPty implements vscode.Pseudoterminal {
	private readonly writeEmitter = new vscode.EventEmitter<string>();
	private readonly closeEmitter = new vscode.EventEmitter<number | void>();
	readonly onDidWrite = this.writeEmitter.event;
	readonly onDidClose = this.closeEmitter.event;
	disposed = false;
	private opened = false;
	private readonly pending: string[] = [];
	onUserInterrupt?: () => void;

	open(): void {
		this.opened = true;
		this.writeEmitter.fire(toTerminalText(`\x1b[90m${AGENT_TERMINAL_NAME}\x1b[0m\n`));
		for (const text of this.pending.splice(0)) {
			this.writeEmitter.fire(toTerminalText(text));
		}
	}

	close(): void {
		this.disposed = true;
		this.onUserInterrupt?.();
	}

	handleInput(data: string): void {
		if (data === '\x03') {
			this.onUserInterrupt?.();
		}
	}

	write(text: string): void {
		if (this.disposed) {
			return;
		}
		if (!this.opened) {
			this.pending.push(text);
			return;
		}
		this.writeEmitter.fire(toTerminalText(text));
	}
}

type AgentTerminalSession = {
	terminal: vscode.Terminal;
	pty: AgentPty;
	busy: boolean;
};

let agentSession: AgentTerminalSession | undefined;
let closeListener: vscode.Disposable | undefined;
let pendingClose: ReturnType<typeof setTimeout> | undefined;

function ensureCloseListener(): void {
	if (closeListener) {
		return;
	}
	closeListener = vscode.window.onDidCloseTerminal((closed) => {
		if (agentSession && closed === agentSession.terminal) {
			agentSession.pty.disposed = true;
			agentSession = undefined;
		}
	});
}

function disposeAgentSession(session: AgentTerminalSession): void {
	if (pendingClose) {
		clearTimeout(pendingClose);
		pendingClose = undefined;
	}
	session.pty.onUserInterrupt = undefined;
	session.pty.disposed = true;
	if (agentSession === session) {
		agentSession = undefined;
	}
	session.terminal.dispose();
}

function scheduleAgentSessionClose(session: AgentTerminalSession): void {
	if (!getAgentFlag('autoCloseTerminal')) {
		return;
	}
	if (pendingClose) {
		clearTimeout(pendingClose);
	}
	pendingClose = setTimeout(() => {
		pendingClose = undefined;
		if (agentSession === session && !session.busy) {
			disposeAgentSession(session);
		}
	}, 800);
}

function getOrCreateAgentTerminal(): AgentTerminalSession {
	ensureCloseListener();
	if (pendingClose) {
		clearTimeout(pendingClose);
		pendingClose = undefined;
	}
	if (agentSession && !agentSession.pty.disposed) {
		return agentSession;
	}
	const pty = new AgentPty();
	const terminal = vscode.window.createTerminal({
		name: AGENT_TERMINAL_NAME,
		pty,
		iconPath: new vscode.ThemeIcon('terminal'),
		isTransient: true
	});
	agentSession = { terminal, pty, busy: false };
	return agentSession;
}

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

function spawnAndMirror(
	command: string,
	cwd: string,
	timeoutMs: number,
	session: AgentTerminalSession,
	token: vscode.CancellationToken | undefined,
	onOutput: (combined: string) => void
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean; cancelled: boolean }> {
	const isWindows = process.platform === 'win32';
	const file = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
	const args = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];

	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let combined = '';
		let settled = false;
		let timedOut = false;
		let cancelled = false;

		const child = cp.spawn(file, args, {
			cwd,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				NO_COLOR: '1',
				CI: '1',
				npm_config_progress: 'false',
				npm_config_loglevel: 'info',
				npm_config_fund: 'false',
				PYTHONUNBUFFERED: '1'
			},
			windowsHide: true,
			windowsVerbatimArguments: isWindows,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		child.stdin?.on('error', () => undefined);
		child.stdin?.end();

		const startLine = child.pid ? `started pid=${child.pid}\n` : 'started\n';
		session.pty.write(startLine);
		onOutput(startLine);

		const finish = (exitCode: number) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutHandle);
			cancelSub?.dispose();
			session.pty.onUserInterrupt = undefined;
			resolve({ stdout, stderr, exitCode, timedOut, cancelled });
		};

		const interrupt = () => {
			cancelled = true;
			session.pty.write('^C\n');
			killProcessTree(child);
		};

		session.pty.onUserInterrupt = interrupt;
		const cancelSub = token?.onCancellationRequested(() => {
			cancelled = true;
			interrupt();
		});

		const timeoutHandle = setTimeout(() => {
			timedOut = true;
			killProcessTree(child);
		}, timeoutMs);

		if (token?.isCancellationRequested) {
			interrupt();
		}

		const onChunk = (chunk: Buffer | string, stream: 'stdout' | 'stderr') => {
			const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
			if (stream === 'stdout') {
				stdout = appendCapped(stdout, text);
			} else {
				stderr = appendCapped(stderr, text);
			}
			combined = appendCapped(combined, text);
			session.pty.write(text);
			onOutput(combined);
		};

		if (child.stdout) {
			child.stdout.on('data', (chunk) => onChunk(chunk, 'stdout'));
		}
		if (child.stderr) {
			child.stderr.on('data', (chunk) => onChunk(chunk, 'stderr'));
		}
		if (!child.stdout && !child.stderr) {
			const message = 'spawn failed: no stdio pipes (command did not start)\n';
			stderr = message;
			combined = message;
			session.pty.write(message);
			onOutput(combined);
			finish(-1);
			return;
		}

		child.on('error', (err) => {
			const message = err instanceof Error ? err.message : String(err);
			stderr = appendCapped(stderr, message + '\n');
			combined = appendCapped(combined, message + '\n');
			session.pty.write(message + '\n');
			onOutput(combined);
			finish(-1);
		});
		child.on('close', (code) => {
			finish(typeof code === 'number' ? code : (cancelled || timedOut ? -1 : 0));
		});
	});
}

/**
 * Run a terminal command inside the workspace.
 *
 * Security guarantees:
 * - Checks command against a denylist before showing the confirmation dialog.
 * - Validates that cwd resolves inside the workspace root.
 * - Spawns an explicit shell binary (not exec) to avoid PATH injection
 *   through the file argument.
 * - Truncates stdout and stderr to 16 KB (tail) before returning to the LLM.
 * - Enforces a timeout (default 10 min, max 10 min).
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
		options?.onProgress?.({
			command,
			elapsedMs: Date.now() - startedAt,
			preview,
			status,
			exitCode
		});
	};

	for (const pattern of DENYLIST) {
		if (pattern.test(command)) {
			return {
				success: false,
				error: `Command blocked by security policy: "${command}"`
			};
		}
	}

	const rawCwd = cwd ? path.resolve(workspaceRoot, cwd) : workspaceRoot;
	const rootNorm = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
	const cwdNorm = rawCwd.endsWith(path.sep) ? rawCwd : rawCwd + path.sep;
	if (!cwdNorm.startsWith(rootNorm) && rawCwd !== workspaceRoot) {
		return {
			success: false,
			error: `cwd must be inside the workspace root ("${workspaceRoot}")`
		};
	}
	const effectiveCwd = rawCwd;

	let effectiveTimeout = timeoutMs !== undefined && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
	if (isLongRunningCommand(command) && effectiveTimeout < LONG_TIMEOUT_MS) {
		effectiveTimeout = LONG_TIMEOUT_MS;
	}
	effectiveTimeout = Math.min(effectiveTimeout, MAX_TIMEOUT_MS);

	emit('confirming', '');
	const displayCmd = command.length > 80 ? command.slice(0, 77) + '...' : command;
	const allowed = await confirmCommand(command, displayCmd, token);
	if (!allowed) {
		const cancelled = !!token?.isCancellationRequested;
		emit('cancelled', '');
		return {
			success: false,
			error: cancelled ? 'Command cancelled.' : 'User denied terminal command execution.'
		};
	}

	const session = getOrCreateAgentTerminal();
	session.terminal.show(true);
	session.busy = true;
	session.pty.write(`\n\x1b[90m# cwd ${effectiveCwd}\x1b[0m\n\x1b[1m$ ${command}\x1b[0m\n`);
	emit('running', 'starting…');

	let lastPreview = '';
	let lastEmitAt = 0;
	const pushProgress = (combined: string, force: boolean) => {
		lastPreview = lastLines(combined, PREVIEW_LINE_COUNT);
		const now = Date.now();
		if (!force && now - lastEmitAt < PROGRESS_INTERVAL_MS) {
			return;
		}
		lastEmitAt = now;
		emit('running', lastPreview);
	};

	const ticker = setInterval(() => emit('running', lastPreview), PROGRESS_INTERVAL_MS);

	try {
		const result = await spawnAndMirror(
			command,
			effectiveCwd,
			effectiveTimeout,
			session,
			token,
			(combined) => pushProgress(combined, false)
		);
		clearInterval(ticker);

		const stdoutResult = truncateTail(stripAnsi(result.stdout));
		const stderrResult = truncateTail(stripAnsi(result.stderr));
		const isTruncated = stdoutResult.truncated || stderrResult.truncated;
		const elapsed = formatElapsed(Date.now() - startedAt);

		if (result.cancelled || token?.isCancellationRequested) {
			session.pty.write(`\n\x1b[33m[cancelled · ${elapsed}]\x1b[0m\n`);
			emit('cancelled', lastPreview, result.exitCode);
			return {
				success: false,
				error: 'Command cancelled.',
				data: {
					stdout: stdoutResult.text,
					stderr: stderrResult.text,
					exitCode: result.exitCode
				},
				truncated: isTruncated
			};
		}

		if (result.timedOut) {
			session.pty.write(`\n\x1b[33m[timed out after ${effectiveTimeout} ms · ${elapsed}]\x1b[0m\n`);
			emit('timeout', lastPreview, -1);
			return {
				success: false,
				error: `Command timed out after ${effectiveTimeout} ms`,
				data: {
					stdout: stdoutResult.text,
					stderr: stderrResult.text,
					exitCode: -1
				},
				truncated: isTruncated
			};
		}

		const ok = result.exitCode === 0;
		session.pty.write(
			`\n\x1b[${ok ? '32' : '31'}m[exit ${result.exitCode} · ${elapsed}]\x1b[0m\n`
		);
		emit(ok ? 'succeeded' : 'failed', lastPreview, result.exitCode);
		const empty = !stdoutResult.text.trim() && !stderrResult.text.trim();
		return {
			success: ok,
			error: ok ? undefined : (
				empty
					? `Command exited ${result.exitCode} with no output. Retry the same command; do not ask the user to run it.`
					: `Command exited ${result.exitCode}`
			),
			data: {
				stdout: stdoutResult.text,
				stderr: stderrResult.text,
				exitCode: result.exitCode
			},
			truncated: isTruncated
		};
	} finally {
		clearInterval(ticker);
		session.busy = false;
		scheduleAgentSessionClose(session);
	}
}
