/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runs the agent's shell commands as hidden child processes.
 *
 * The agent used to type into a visible VS Code terminal and read the output
 * back through shell integration. That gave unreliable exit codes, OSC escape
 * codes in the output, and a working folder the tool could not see: after the
 * model ran `cd x`, the tool still believed it was in the workspace root. A
 * child process gives an exact exit code and clean output, and a marker printed
 * after the command reports the folder the command ended in.
 *
 * This module has no `vscode` import so it can be exercised with plain Node.
 */

import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';

export type ShellKind = 'bash' | 'pwsh' | 'powershell' | 'cmd' | 'sh' | 'zsh';

export interface AgentShell {
	kind: ShellKind;
	path: string;
	/** What the model is told, e.g. "Git Bash" or "Windows PowerShell 5.1". */
	label: string;
}

export interface ShellEnvironment {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	exists?: (file: string) => boolean;
}

/** Output kept for the model: the start and the end of long output. */
export const MODEL_HEAD_CHARS = 4 * 1024;
export const MODEL_TAIL_CHARS = 16 * 1024;
/** Raw output kept in memory per command. */
const CAPTURE_HEAD_CHARS = 8 * 1024;
const CAPTURE_TAIL_CHARS = 256 * 1024;

export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 600_000;
/** A command silent for this long before a timeout was probably waiting for input. */
const IDLE_NOTE_MS = 60_000;
const BACKGROUND_FIRST_LOOK_MS = 3_000;
const MAX_BACKGROUND_JOBS = 5;
const KILL_GRACE_MS = 1_500;

/**
 * Pick the shell the agent's commands run in.
 *
 * `auto` prefers Git Bash on Windows, as Claude Code does: models write bash
 * far more reliably than PowerShell, and Windows PowerShell 5.1 rejects `&&`.
 * Without Git Bash, PowerShell 7 (`pwsh`) is next because it accepts `&&`.
 * The WSL `bash.exe` in System32 is never used: it runs in a different
 * filesystem and cannot see Windows paths the way the workspace needs.
 */
export function resolveAgentShell(preference: string = 'auto', host: ShellEnvironment = {}): AgentShell {
	const platform = host.platform ?? process.platform;
	const env = host.env ?? process.env;
	const exists = host.exists ?? ((file: string) => {
		try {
			return fs.statSync(file).isFile();
		} catch {
			return false;
		}
	});
	const want = (preference || 'auto').trim().toLowerCase();

	if (platform !== 'win32') {
		if (want === 'pwsh') {
			const pwsh = findOnPath('pwsh', env, platform, exists);
			if (pwsh) {
				return { kind: 'pwsh', path: pwsh, label: 'PowerShell 7 (pwsh)' };
			}
		}
		const fromEnv = env.SHELL || '';
		const base = path.posix.basename(fromEnv);
		if (want === 'auto' && (base === 'zsh' || base === 'bash') && exists(fromEnv)) {
			return { kind: base, path: fromEnv, label: base };
		}
		const bash = exists('/bin/bash') ? '/bin/bash' : findOnPath('bash', env, platform, exists);
		if (bash) {
			return { kind: 'bash', path: bash, label: 'bash' };
		}
		return { kind: 'sh', path: '/bin/sh', label: 'sh' };
	}

	const gitBash = () => findGitBash(env, exists);
	const pwsh = () => findOnPath('pwsh', env, platform, exists);
	const windowsPowerShell = (): AgentShell => {
		const root = env.SystemRoot || env.windir || 'C:\\Windows';
		const full = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
		return { kind: 'powershell', path: exists(full) ? full : 'powershell.exe', label: 'Windows PowerShell 5.1' };
	};

	if (want === 'cmd') {
		return { kind: 'cmd', path: env.ComSpec || 'cmd.exe', label: 'cmd.exe' };
	}
	if (want === 'powershell') {
		return windowsPowerShell();
	}
	if (want === 'pwsh') {
		const found = pwsh();
		return found ? { kind: 'pwsh', path: found, label: 'PowerShell 7 (pwsh)' } : windowsPowerShell();
	}
	const bash = gitBash();
	if (bash) {
		return { kind: 'bash', path: bash, label: 'Git Bash' };
	}
	const found = pwsh();
	if (found) {
		return { kind: 'pwsh', path: found, label: 'PowerShell 7 (pwsh)' };
	}
	return windowsPowerShell();
}

function findGitBash(env: NodeJS.ProcessEnv, exists: (file: string) => boolean): string | undefined {
	const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432]
		.filter((r): r is string => !!r)
		.map((r) => path.win32.join(r, 'Git'));
	if (env.LOCALAPPDATA) {
		roots.push(path.win32.join(env.LOCALAPPDATA, 'Programs', 'Git'));
	}
	// git.exe on PATH lives in <root>\cmd or <root>\bin; bash.exe is in <root>\bin.
	const git = findOnPath('git', env, 'win32', exists);
	if (git) {
		roots.unshift(path.win32.dirname(path.win32.dirname(git)));
	}
	for (const root of roots) {
		const candidate = path.win32.join(root, 'bin', 'bash.exe');
		if (exists(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function findOnPath(
	name: string,
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
	exists: (file: string) => boolean
): string | undefined {
	const p = platform === 'win32' ? path.win32 : path.posix;
	const raw = env.PATH ?? env.Path ?? '';
	const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
	for (const dir of raw.split(platform === 'win32' ? ';' : ':')) {
		if (!dir) {
			continue;
		}
		for (const ext of exts) {
			const candidate = p.join(dir, name + ext);
			if (exists(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

/** Remove terminal control codes the model cannot use. */
export function cleanTerminalText(text: string): string {
	const withoutCodes = text
		// OSC: ESC ] ... BEL or ESC ] ... ESC \  (shell-integration marks such as 633;C)
		.replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
		// CSI: colours, cursor moves
		.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '')
		// two-character escapes
		.replace(/\x1B[@-Z\\-_]/g, '')
		.replace(/\r\n/g, '\n');
	// A bare carriage return redraws the line (progress bars): keep the last state.
	const lines = withoutCodes.split('\n').map((line) => {
		const at = line.lastIndexOf('\r');
		return at >= 0 ? line.slice(at + 1) : line;
	});
	return lines.join('\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/** Keep the start and the end of long output, saying how much was left out. */
export function truncateMiddle(text: string, head = MODEL_HEAD_CHARS, tail = MODEL_TAIL_CHARS): { text: string; truncated: boolean } {
	if (text.length <= head + tail) {
		return { text, truncated: false };
	}
	const middle = text.slice(head, text.length - tail);
	const lines = middle.split('\n').length;
	return {
		text: `${text.slice(0, head)}\n[... ${lines} lines omitted ...]\n${text.slice(text.length - tail)}`,
		truncated: true
	};
}

/**
 * Folders put first on PATH for agent commands, set by runtimeProbe.ts: the
 * project's virtual environment, node_modules/.bin, and uv's Python when the
 * system python is a broken shortcut. One window has one workspace, so this
 * is module state.
 */
let agentPathPrefix: string[] = [];

export function setAgentPathPrefix(dirs: string[]): void {
	agentPathPrefix = dirs.filter((d) => !!d);
}

export function getAgentPathPrefix(): string[] {
	return [...agentPathPrefix];
}

/** Environment for a non-interactive agent command. withPrefix false: the plain PATH, for probing. */
export function agentProcessEnv(base: NodeJS.ProcessEnv = process.env, withPrefix: boolean = true): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(base)) {
		// The extension host runs Electron as Node; a child must not inherit that.
		if (/^(ELECTRON_|VSCODE_)/i.test(key)) {
			continue;
		}
		env[key] = value;
	}
	if (withPrefix && agentPathPrefix.length > 0) {
		const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
		env[key] = [...agentPathPrefix, env[key] || ''].filter((p) => p.length > 0).join(path.delimiter);
	}
	return {
		...env,
		GIT_TERMINAL_PROMPT: '0',
		GCM_INTERACTIVE: 'never',
		GIT_PAGER: 'cat',
		PAGER: 'cat',
		NO_COLOR: '1',
		FORCE_COLOR: '0',
		TERM: 'dumb',
		CI: '1',
		npm_config_yes: 'true',
		// Git Bash: start in the folder we give it, not the home folder.
		CHERE_INVOKING: '1'
	};
}

interface PreparedCommand {
	file: string;
	args: string[];
	verbatim: boolean;
	cleanup: () => void;
}

function prepare(shell: AgentShell, command: string, marker?: string): PreparedCommand {
	if (shell.kind === 'pwsh' || shell.kind === 'powershell') {
		const lines = [
			'$ProgressPreference = \'SilentlyContinue\'',
			'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}',
			'$global:LASTEXITCODE = 0',
			command,
			'$__nxOk = $?',
			'$__nxCode = $global:LASTEXITCODE'
		];
		if (marker) {
			lines.push(`[Console]::Out.WriteLine("\`n${marker}" + (Get-Location).ProviderPath)`);
		}
		lines.push('if ($__nxCode -ne 0) { exit $__nxCode }', 'if (-not $__nxOk) { exit 1 }', 'exit 0', '');
		// A script file, not -EncodedCommand: with an encoded command and
		// redirected output, PowerShell writes errors as CLIXML instead of text.
		// The BOM makes Windows PowerShell 5.1 read the file as UTF-8.
		const file = tempScript('.ps1', '\ufeff' + lines.join('\n'));
		return {
			file: shell.path,
			args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
			verbatim: false,
			cleanup: () => removeFile(file)
		};
	}
	if (shell.kind === 'cmd') {
		return {
			file: shell.path,
			args: ['/d', '/s', '/c', `"${command}"`],
			verbatim: true,
			cleanup: () => undefined
		};
	}
	// bash / zsh / sh: a script file avoids every quoting rule of the Windows
	// command line, and stdin stays closed so a prompt cannot hang the run.
	const body = [command, '__nx_ec=$?'];
	if (marker) {
		body.push(`printf '\\n%s%s\\n' '${marker}' "$( (pwd -W) 2>/dev/null || pwd )"`);
	}
	body.push('exit $__nx_ec', '');
	const file = tempScript('.sh', body.join('\n'));
	return {
		file: shell.path,
		args: [process.platform === 'win32' ? file.replace(/\\/g, '/') : file],
		verbatim: false,
		cleanup: () => removeFile(file)
	};
}

function tempScript(extension: string, content: string): string {
	const file = path.join(os.tmpdir(), `nexora-cmd-${crypto.randomBytes(6).toString('hex')}${extension}`);
	fs.writeFileSync(file, content, 'utf8');
	return file;
}

function removeFile(file: string): void {
	try {
		fs.unlinkSync(file);
	} catch {
		// already gone
	}
}

function killTree(child: cp.ChildProcess): void {
	if (!child.pid || child.exitCode !== null) {
		return;
	}
	if (process.platform === 'win32') {
		cp.execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => undefined);
		return;
	}
	try {
		process.kill(-child.pid, 'SIGTERM');
	} catch {
		child.kill('SIGTERM');
	}
	setTimeout(() => {
		try {
			process.kill(-child.pid!, 'SIGKILL');
		} catch {
			// gone
		}
	}, KILL_GRACE_MS);
}

/** Output captured from one process: the first part and a rolling tail. */
class Capture {
	private head = '';
	private tail = '';
	private dropped = 0;
	total = 0;
	lastOutputAt = Date.now();

	push(chunk: string): void {
		if (!chunk) {
			return;
		}
		this.total += chunk.length;
		this.lastOutputAt = Date.now();
		if (this.head.length < CAPTURE_HEAD_CHARS) {
			const room = CAPTURE_HEAD_CHARS - this.head.length;
			this.head += chunk.slice(0, room);
			chunk = chunk.slice(room);
		}
		this.tail += chunk;
		if (this.tail.length > CAPTURE_TAIL_CHARS) {
			const cut = this.tail.length - CAPTURE_TAIL_CHARS;
			this.dropped += cut;
			this.tail = this.tail.slice(cut);
		}
	}

	text(): string {
		return this.dropped ? `${this.head}\n[... output dropped ...]\n${this.tail}` : this.head + this.tail;
	}

	/** Everything received after `offset` (a count of characters), when still held. */
	since(offset: number): { text: string; lost: boolean } {
		if (offset >= this.total) {
			return { text: '', lost: false };
		}
		if (this.dropped === 0) {
			// Nothing dropped yet, so head + tail is the whole output.
			return { text: (this.head + this.tail).slice(offset), lost: false };
		}
		const tailStart = this.total - this.tail.length;
		if (offset >= tailStart) {
			return { text: this.tail.slice(offset - tailStart), lost: false };
		}
		return { text: this.tail, lost: true };
	}
}

interface Spawned {
	child: cp.ChildProcess;
	capture: Capture;
	done: Promise<number | null>;
	startedAt: number;
	/** Stop the process tree and settle `done` within the grace period. */
	stop: () => void;
}

function spawnShell(shell: AgentShell, command: string, cwd: string, marker: string | undefined, onOutput?: (chunk: string) => void): Spawned {
	const prepared = prepare(shell, command, marker);
	const capture = new Capture();
	const startedAt = Date.now();
	const child = cp.spawn(prepared.file, prepared.args, {
		cwd,
		env: agentProcessEnv(),
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
		windowsVerbatimArguments: prepared.verbatim,
		detached: process.platform !== 'win32'
	});
	const take = (decoder: StringDecoder) => (data: Buffer) => {
		const text = decoder.write(data);
		capture.push(text);
		onOutput?.(text);
	};
	const outDecoder = new StringDecoder('utf8');
	const errDecoder = new StringDecoder('utf8');
	child.stdout?.on('data', take(outDecoder));
	child.stderr?.on('data', take(errDecoder));
	let finish: (code: number | null) => void = () => undefined;
	const done = new Promise<number | null>((resolve) => {
		let settled = false;
		finish = (code: number | null) => {
			if (settled) {
				return;
			}
			settled = true;
			capture.push(outDecoder.end() + errDecoder.end());
			prepared.cleanup();
			resolve(code);
		};
		child.on('error', (err) => {
			capture.push(`\n${err.message}\n`);
			finish(127);
		});
		child.on('close', (code) => finish(code));
	});
	const stop = () => {
		killTree(child);
		// Git Bash children are not always reached by taskkill /t, and one that
		// keeps our output pipe open would hold 'close' back until it ends on
		// its own. Give the kill a moment, then let go of the pipes.
		setTimeout(() => {
			child.stdout?.destroy();
			child.stderr?.destroy();
			finish(child.exitCode);
		}, KILL_GRACE_MS);
	};
	return { child, capture, done, startedAt, stop };
}

function splitMarker(output: string, marker: string): { output: string; cwd?: string } {
	const at = output.lastIndexOf(marker);
	if (at < 0) {
		return { output };
	}
	const rest = output.slice(at + marker.length);
	const end = rest.indexOf('\n');
	const reported = (end >= 0 ? rest.slice(0, end) : rest).trim();
	const before = output.slice(0, at).replace(/\n$/, '');
	const after = end >= 0 ? rest.slice(end + 1) : '';
	return { output: before + after, cwd: reported ? path.resolve(reported) : undefined };
}

export interface RunCommandOptions {
	shell: AgentShell;
	command: string;
	cwd: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	onOutput?: (chunk: string) => void;
}

export interface RunCommandResult {
	/** Clean output (no control codes), not yet shortened for the model. */
	output: string;
	exitCode: number | null;
	/** The folder the command ended in, when the shell could report it. */
	finalCwd?: string;
	timedOut: boolean;
	cancelled: boolean;
	durationMs: number;
	/** How long the command had been silent when it ended. */
	silentMs: number;
}

/** Run one command to completion (or timeout / cancel). */
export async function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
	const marker = `__NEXORA_CWD_${crypto.randomBytes(5).toString('hex')}__`;
	const timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
	const run = spawnShell(options.shell, options.command, options.cwd, marker, options.onOutput);
	let timedOut = false;
	let cancelled = false;

	const timer = setTimeout(() => {
		timedOut = true;
		run.stop();
	}, timeoutMs);
	const onAbort = () => {
		cancelled = true;
		run.stop();
	};
	if (options.signal?.aborted) {
		onAbort();
	} else {
		options.signal?.addEventListener('abort', onAbort, { once: true });
	}

	const exitCode = await run.done;
	clearTimeout(timer);
	options.signal?.removeEventListener('abort', onAbort);

	const { output, cwd } = splitMarker(cleanTerminalText(run.capture.text()), marker);
	return {
		output: output.replace(/\s+$/, ''),
		exitCode: timedOut || cancelled ? null : exitCode,
		finalCwd: cwd,
		timedOut,
		cancelled,
		durationMs: Date.now() - run.startedAt,
		silentMs: Date.now() - run.capture.lastOutputAt
	};
}

/** Explain a finished command in one line, for the result the model reads. */
/** True for the `{ error }` side of a background-job result (the repo's lint bans the `in` operator). */
export function isJobError<T extends object>(result: T | { error: string }): result is { error: string } {
	return typeof (result as { error?: unknown }).error === 'string';
}

export function describeEnding(result: RunCommandResult, timeoutMs: number): string | undefined {
	if (result.cancelled) {
		return 'Command cancelled by the user.';
	}
	if (result.timedOut) {
		const silent = result.silentMs >= IDLE_NOTE_MS
			? ` It printed nothing for the last ${Math.round(result.silentMs / 1000)} s, so it was probably waiting for input: commands cannot be answered interactively, so pass a flag such as --yes, or run long-lived processes with run_in_background.`
			: ' For a server or watcher, use run_in_background instead.';
		return `Command timed out after ${Math.round(timeoutMs / 1000)} s and was stopped.${silent}`;
	}
	if (result.exitCode !== 0) {
		return `Command exited ${result.exitCode}. Read the output, fix the cause, then try again; do not resend the same command unchanged.`;
	}
	return undefined;
}

export interface BackgroundJobInfo {
	id: string;
	command: string;
	cwd: string;
	status: 'running' | 'exited' | 'stopped';
	exitCode: number | null;
	startedAt: number;
}

interface BackgroundJob extends BackgroundJobInfo {
	run: Spawned;
	readOffset: number;
}

/** Long-running commands (dev servers, watchers) the agent starts and checks later. */
export class BackgroundJobs {
	private readonly jobs = new Map<string, BackgroundJob>();
	private next = 1;

	list(): BackgroundJobInfo[] {
		return [...this.jobs.values()].map(({ id, command, cwd, status, exitCode, startedAt }) => ({ id, command, cwd, status, exitCode, startedAt }));
	}

	running(): BackgroundJobInfo[] {
		return this.list().filter((job) => job.status === 'running');
	}

	/** Start a job and wait a few seconds so the first output (or a crash) is visible. */
	async start(shell: AgentShell, command: string, cwd: string, onOutput?: (chunk: string) => void): Promise<{ job: BackgroundJobInfo; output: string } | { error: string }> {
		if (this.running().length >= MAX_BACKGROUND_JOBS) {
			return { error: `${MAX_BACKGROUND_JOBS} background commands are already running. Stop one with stop_command first.` };
		}
		const id = `bg${this.next++}`;
		const run = spawnShell(shell, command, cwd, undefined, onOutput);
		const job: BackgroundJob = { id, command, cwd, status: 'running', exitCode: null, startedAt: run.startedAt, run, readOffset: 0 };
		this.jobs.set(id, job);
		void run.done.then((code) => {
			if (job.status === 'running') {
				job.status = 'exited';
				job.exitCode = code;
			}
		});
		await Promise.race([run.done, new Promise((resolve) => setTimeout(resolve, BACKGROUND_FIRST_LOOK_MS))]);
		const first = this.read(id);
		return isJobError(first) ? first : { job: first.job, output: first.output };
	}

	/** Output since the last read. */
	read(id: string): { job: BackgroundJobInfo; output: string; lost: boolean } | { error: string } {
		const job = this.jobs.get(id);
		if (!job) {
			return { error: `No background command with id "${id}". Running: ${this.running().map((j) => j.id).join(', ') || 'none'}.` };
		}
		const { text, lost } = job.run.capture.since(job.readOffset);
		job.readOffset = job.run.capture.total;
		const clean = truncateMiddle(cleanTerminalText(text)).text.replace(/\s+$/, '');
		const { run: _run, readOffset: _offset, ...info } = job;
		return { job: info, output: clean, lost };
	}

	stop(id: string): { job: BackgroundJobInfo } | { error: string } {
		const job = this.jobs.get(id);
		if (!job) {
			return { error: `No background command with id "${id}".` };
		}
		if (job.status === 'running') {
			job.status = 'stopped';
			job.run.stop();
		}
		const { run: _run, readOffset: _offset, ...info } = job;
		return { job: info };
	}

	stopAll(): void {
		for (const job of this.jobs.values()) {
			if (job.status === 'running') {
				job.status = 'stopped';
				job.run.stop();
			}
		}
	}
}
