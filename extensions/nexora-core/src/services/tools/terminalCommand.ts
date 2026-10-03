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
const SI_WAIT_NEW_MS = 4000;
const SI_WAIT_REUSE_MS = 500;
const SHORT_FALLBACK_MS = 8000;
const STOP_GRACE_MS = 1500;

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

type ShellIntegration = {
	cwd?: vscode.Uri;
	executeCommand(commandLine: string): ShellExecution;
};

type ShellExecution = {
	read(): AsyncIterable<string>;
};

type ShellWindow = typeof vscode.window & {
	onDidChangeTerminalShellIntegration?: vscode.Event<{ terminal: vscode.Terminal; shellIntegration: ShellIntegration }>;
	onDidStartTerminalShellExecution?: vscode.Event<{ terminal: vscode.Terminal; execution: ShellExecution }>;
	onDidEndTerminalShellExecution?: vscode.Event<{ terminal: vscode.Terminal; execution: ShellExecution; exitCode?: number }>;
};

type AgentTerminalSession = {
	terminal: vscode.Terminal;
	cwd: string;
	busy: boolean;
	fresh: boolean;
	userTookOver: boolean;
};

type CommandRunResult = {
	output: string;
	exitCode: number;
	timedOut: boolean;
	cancelled: boolean;
	captured: boolean;
	killedShell: boolean;
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

function shellWindow(): ShellWindow {
	return vscode.window as ShellWindow;
}

function terminalShellIntegration(terminal: vscode.Terminal): ShellIntegration | undefined {
	return (terminal as vscode.Terminal & { shellIntegration?: ShellIntegration }).shellIntegration;
}

function terminalShellName(terminal: vscode.Terminal): string | undefined {
	return (terminal as vscode.Terminal & { state?: { shell?: string } }).state?.shell;
}

function withWorkingDirectory(
	command: string,
	cwd: string,
	currentCwd: string,
	shell: string | undefined
): string {
	if (currentCwd && path.resolve(currentCwd) === path.resolve(cwd)) {
		return command;
	}
	if (process.platform === 'win32' && shell === 'cmd') {
		return `cd /d "${cwd.replace(/"/g, '""')}" && ${command}`;
	}
	if (process.platform === 'win32') {
		return `Set-Location -LiteralPath ${JSON.stringify(cwd)}; ${command}`;
	}
	return `cd ${JSON.stringify(cwd)} && ${command}`;
}

async function killTerminalTree(terminal: vscode.Terminal): Promise<void> {
	const pid = await terminal.processId;
	if (pid && process.platform === 'win32') {
		await new Promise<void>((resolve) => {
			cp.execFile('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }, () => resolve());
		});
	} else if (pid) {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			// ignore
		}
	}
	terminal.dispose();
}

function sendCtrlC(terminal: vscode.Terminal): void {
	terminal.sendText('\u0003', false);
}

let agentSession: AgentTerminalSession | undefined;
let closeListener: vscode.Disposable | undefined;
let pendingClose: ReturnType<typeof setTimeout> | undefined;

function ensureCloseListener(): void {
	if (closeListener) {
		return;
	}
	closeListener = vscode.window.onDidCloseTerminal((closed) => {
		if (agentSession && closed === agentSession.terminal) {
			agentSession = undefined;
		}
	});
}

function scheduleAgentSessionClose(session: AgentTerminalSession): void {
	if (!getAgentFlag('autoCloseTerminal') || session.userTookOver) {
		return;
	}
	if (pendingClose) {
		clearTimeout(pendingClose);
	}
	const w = shellWindow();
	const takeover = w.onDidStartTerminalShellExecution?.((e) => {
		if (e.terminal === session.terminal) {
			session.userTookOver = true;
		}
	});
	pendingClose = setTimeout(() => {
		pendingClose = undefined;
		takeover?.dispose();
		if (session.userTookOver) {
			return;
		}
		if (agentSession === session && !session.busy) {
			session.terminal.dispose();
			if (agentSession === session) {
				agentSession = undefined;
			}
		}
	}, 800);
}

function windowsAgentShell(): { shellPath: string; shellArgs: string[] } {
	const detected = vscode.env.shell;
	const shellPath = /(?:^|[\\/])pwsh(?:\.exe)?$/i.test(detected)
		? detected
		: 'powershell.exe';
	return { shellPath, shellArgs: ['-NoLogo'] };
}

function isAgentTerminal(t: vscode.Terminal): boolean {
	return t.exitStatus === undefined
		&& (t.name === AGENT_TERMINAL_NAME || t.name.startsWith(`${AGENT_TERMINAL_NAME} -`));
}

function getOrCreateAgentTerminal(workspaceRoot: string): AgentTerminalSession {
	ensureCloseListener();
	if (pendingClose) {
		clearTimeout(pendingClose);
		pendingClose = undefined;
	}
	if (agentSession && agentSession.terminal.exitStatus === undefined) {
		return agentSession;
	}
	const existing = vscode.window.terminals.find(isAgentTerminal);
	if (existing) {
		agentSession = { terminal: existing, cwd: '', busy: false, fresh: false, userTookOver: false };
		return agentSession;
	}
	const winShell = process.platform === 'win32' ? windowsAgentShell() : undefined;
	const terminal = vscode.window.createTerminal({
		name: AGENT_TERMINAL_NAME,
		cwd: workspaceRoot,
		shellPath: winShell?.shellPath,
		shellArgs: winShell?.shellArgs,
		iconPath: new vscode.ThemeIcon('terminal'),
		isTransient: true
	});
	agentSession = { terminal, cwd: workspaceRoot, busy: false, fresh: true, userTookOver: false };
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

function waitForShellIntegration(
	terminal: vscode.Terminal,
	timeoutMs: number
): Promise<ShellIntegration | undefined> {
	const existing = terminalShellIntegration(terminal);
	if (existing) {
		return Promise.resolve(existing);
	}
	const onChange = shellWindow().onDidChangeTerminalShellIntegration;
	if (!onChange || timeoutMs <= 0) {
		return Promise.resolve(terminalShellIntegration(terminal));
	}
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			sub.dispose();
			resolve(terminalShellIntegration(terminal));
		}, timeoutMs);
		const sub = onChange((e) => {
			if (e.terminal === terminal) {
				clearTimeout(timer);
				sub.dispose();
				resolve(e.shellIntegration);
			}
		});
	});
}

function attachExecutionReader(
	execution: ShellExecution,
	onChunk: (combined: string) => void
): { output: () => string; done: Promise<void> } {
	let output = '';
	const done = (async () => {
		try {
			for await (const chunk of execution.read()) {
				output = appendCapped(output, chunk);
				onChunk(output);
			}
		} catch {
			// Stream closed with the command.
		}
	})();
	return { output: () => output, done };
}

function waitForExecutionEnd(
	execution: ShellExecution
): { promise: Promise<number | undefined>; dispose: () => void } {
	const onEnd = shellWindow().onDidEndTerminalShellExecution;
	if (!onEnd) {
		return { promise: Promise.resolve(undefined), dispose: () => undefined };
	}
	let disposeFn = () => undefined;
	const promise = new Promise<number | undefined>((resolve) => {
		const sub = onEnd((e) => {
			if (e.execution === execution) {
				sub.dispose();
				resolve(e.exitCode);
			}
		});
		disposeFn = () => sub.dispose();
	});
	return { promise, dispose: () => disposeFn() };
}

async function collectExecution(
	terminal: vscode.Terminal,
	execution: ShellExecution,
	timeoutMs: number,
	token: vscode.CancellationToken | undefined,
	onOutput: (combined: string) => void
): Promise<CommandRunResult> {
	const reader = attachExecutionReader(execution, onOutput);
	const endWait = waitForExecutionEnd(execution);
	let timedOut = false;
	let cancelled = false;
	let killedShell = false;

	const interrupt = (killTree: boolean) => {
		sendCtrlC(terminal);
		if (killTree) {
			killedShell = true;
			void killTerminalTree(terminal);
			if (agentSession?.terminal === terminal) {
				agentSession = undefined;
			}
		}
	};

	return await new Promise<CommandRunResult>((resolve) => {
		let settled = false;
		const finish = (exitCode: number) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutHandle);
			cancelSub?.dispose();
			endWait.dispose();
			resolve({
				output: reader.output(),
				exitCode,
				timedOut,
				cancelled,
				captured: true,
				killedShell
			});
		};

		void endWait.promise.then((code) => {
			finish(typeof code === 'number' ? code : (cancelled || timedOut ? -1 : 0));
		});
		void reader.done.then(() => {
			setTimeout(() => finish(cancelled || timedOut ? -1 : 0), 200);
		});

		const timeoutHandle = setTimeout(() => {
			timedOut = true;
			sendCtrlC(terminal);
			setTimeout(() => {
				if (!settled) {
					interrupt(true);
					finish(-1);
				}
			}, STOP_GRACE_MS);
		}, timeoutMs);

		const cancelSub = token?.onCancellationRequested(() => {
			cancelled = true;
			sendCtrlC(terminal);
			setTimeout(() => {
				if (!settled) {
					interrupt(true);
					finish(-1);
				}
			}, STOP_GRACE_MS);
		});

		if (token?.isCancellationRequested) {
			cancelled = true;
			sendCtrlC(terminal);
			setTimeout(() => {
				if (!settled) {
					interrupt(true);
					finish(-1);
				}
			}, STOP_GRACE_MS);
		}
	});
}

async function runViaShellIntegration(
	terminal: vscode.Terminal,
	si: ShellIntegration,
	command: string,
	timeoutMs: number,
	token: vscode.CancellationToken | undefined,
	onOutput: (combined: string) => void
): Promise<CommandRunResult> {
	const execution = si.executeCommand(command);
	return collectExecution(terminal, execution, timeoutMs, token, onOutput);
}

function uncapturedResult(onOutput: (combined: string) => void, cancelled: boolean): CommandRunResult {
	const note = 'Command sent to the Nexora Agent terminal. Shell integration was unavailable, so output was not captured.\n';
	onOutput(note);
	return {
		output: note,
		exitCode: 0,
		timedOut: false,
		cancelled,
		captured: false,
		killedShell: false
	};
}

async function runViaSendText(
	terminal: vscode.Terminal,
	command: string,
	timeoutMs: number,
	token: vscode.CancellationToken | undefined,
	onOutput: (combined: string) => void
): Promise<CommandRunResult> {
	const onStart = shellWindow().onDidStartTerminalShellExecution;
	if (!onStart) {
		terminal.sendText(command, true);
		return uncapturedResult(onOutput, !!token?.isCancellationRequested);
	}

	return await new Promise<CommandRunResult>((resolve) => {
		let started = false;
		const timer = setTimeout(() => {
			if (started) {
				return;
			}
			sub.dispose();
			resolve(uncapturedResult(onOutput, !!token?.isCancellationRequested));
		}, SHORT_FALLBACK_MS);
		const sub = onStart((e) => {
			if (e.terminal !== terminal || started) {
				return;
			}
			started = true;
			clearTimeout(timer);
			sub.dispose();
			void collectExecution(terminal, e.execution, timeoutMs, token, onOutput).then(resolve);
		});
		terminal.sendText(command, true);
	});
}

/**
 * Run a terminal command inside the workspace.
 *
 * Security guarantees:
 * - Checks command against a denylist before showing the confirmation dialog.
 * - Validates that cwd resolves inside the workspace root.
 * - Runs in a real VS Code terminal (user can type). Capture uses shell integration.
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

	const session = getOrCreateAgentTerminal(workspaceRoot);
	session.terminal.show(true);
	session.busy = true;
	session.userTookOver = false;
	emit('running', 'starting...');

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
		void session.terminal.processId.then((pid) => {
			if (pid && !lastPreview) {
				pushProgress(`started pid=${pid}\n`, true);
			} else if (pid) {
				pushProgress(`started pid=${pid}\n${lastPreview}`, true);
			}
		});

		const si = await waitForShellIntegration(
			session.terminal,
			session.fresh ? SI_WAIT_NEW_MS : SI_WAIT_REUSE_MS
		);
		session.fresh = false;
		if (si?.cwd?.fsPath) {
			session.cwd = si.cwd.fsPath;
		}
		if (token?.isCancellationRequested) {
			clearInterval(ticker);
			emit('cancelled', lastPreview);
			return {
				success: false,
				error: 'Command cancelled.'
			};
		}

		const commandToRun = withWorkingDirectory(
			command,
			effectiveCwd,
			session.cwd,
			terminalShellName(session.terminal)
		);

		let result: CommandRunResult;
		if (si) {
			try {
				result = await runViaShellIntegration(
					session.terminal,
					si,
					commandToRun,
					effectiveTimeout,
					token,
					(combined) => pushProgress(combined, false)
				);
			} catch {
				result = await runViaSendText(
					session.terminal,
					commandToRun,
					effectiveTimeout,
					token,
					(combined) => pushProgress(combined, false)
				);
			}
		} else {
			result = await runViaSendText(
				session.terminal,
				commandToRun,
				effectiveTimeout,
				token,
				(combined) => pushProgress(combined, false)
			);
		}

		if (!result.killedShell) {
			session.cwd = effectiveCwd;
		}

		if (!result.captured) {
			session.userTookOver = true;
		}

		clearInterval(ticker);

		const stdoutResult = truncateTail(stripAnsi(result.output));
		const isTruncated = stdoutResult.truncated;

		if (result.cancelled || token?.isCancellationRequested) {
			emit('cancelled', lastPreview, result.exitCode);
			return {
				success: false,
				error: 'Command cancelled.',
				data: {
					stdout: stdoutResult.text,
					stderr: '',
					exitCode: result.exitCode
				},
				truncated: isTruncated
			};
		}

		if (result.timedOut) {
			emit('timeout', lastPreview, -1);
			return {
				success: false,
				error: `Command timed out after ${effectiveTimeout} ms`,
				data: {
					stdout: stdoutResult.text,
					stderr: '',
					exitCode: -1
				},
				truncated: isTruncated
			};
		}

		if (!result.captured) {
			emit('succeeded', lastPreview, result.exitCode);
			return {
				success: true,
				data: {
					stdout: stdoutResult.text,
					stderr: '',
					exitCode: result.exitCode
				},
				truncated: isTruncated
			};
		}

		const ok = result.exitCode === 0;
		emit(ok ? 'succeeded' : 'failed', lastPreview, result.exitCode);
		const empty = !stdoutResult.text.trim();
		return {
			success: ok,
			error: ok ? undefined : (
				empty
					? `Command exited ${result.exitCode} with no output. Retry the same command; do not ask the user to run it.`
					: `Command exited ${result.exitCode}`
			),
			data: {
				stdout: stdoutResult.text,
				stderr: '',
				exitCode: result.exitCode
			},
			truncated: isTruncated
		};
	} finally {
		clearInterval(ticker);
		if (agentSession === session) {
			session.busy = false;
			if (!session.terminal.exitStatus) {
				scheduleAgentSessionClose(session);
			}
		}
	}
}
