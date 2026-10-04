/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Coding agents Nexora runs as a local process.
 *
 * Claude Code, Cursor and Cline are not services to sign in to. They are
 * binaries on the developer's machine, already holding the developer's own
 * credentials, and they edit the folder they are started in. There is no
 * token for the engine to keep and no endpoint for it to call, so "connect"
 * here means one thing only: is the binary installed?
 *
 * That is why this lives in the IDE. The engine names these agents and decides
 * when a plan step should use one (app/connectors/local_agents.py), but only
 * the extension runs on the machine that has the PATH, the workspace and the
 * vendor's own login.
 *
 * The catalogue used to call all three MCP servers. Two are MCP clients and
 * publish no server; Claude Code answers `claude mcp serve`, but that exposes
 * its tools rather than its agent loop, which is the half Nexora already has.
 * What is worth having is the loop, and every one of them exposes that the
 * same way: a headless CLI that takes a prompt and edits a directory.
 */

import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

export type LocalAgentId = 'claude-code' | 'cursor' | 'cline';

/** How the prompt reaches the agent, which decides how we may spawn it. */
export type PromptChannel =
	/** Written to stdin as newline-delimited JSON. No prompt text in argv. */
	| 'stream-json-stdin'
	/** Passed as the final argv element. */
	| 'argv';

export interface LocalAgentSpec {
	id: LocalAgentId;
	name: string;
	/** Looked up on PATH. Windows resolution handles the .cmd shim npm installs. */
	binary: string;
	/** Printed when the binary is missing; this is the whole "connect" story. */
	installHint: string;
	docsUrl: string;
	/** Args that print a version and exit, used to probe for the binary. */
	versionArgs: string[];
	promptChannel: PromptChannel;
	/**
	 * Fixed flags for one non-interactive run. The prompt is never in here:
	 * it travels by `promptChannel` so nothing user-written has to survive a
	 * shell on Windows.
	 */
	runArgs(options: LocalAgentRunArgs): string[];
}

export interface LocalAgentRunArgs {
	/** Nexora's own id for the run, so its output can be correlated back. */
	sessionId: string;
	model?: string;
	maxTurns: number;
	/** Hard ceiling on spend for one step, in USD. */
	maxBudgetUsd?: number;
	/** Only used when promptChannel is 'argv'. */
	prompt: string;
}

/**
 * Flags verified against each vendor's own CLI reference:
 * - https://code.claude.com/docs/en/cli-reference
 * - https://cursor.com/docs/cli/headless
 * - https://docs.cline.bot/usage/cli-overview
 */
const LOCAL_AGENTS: Record<LocalAgentId, LocalAgentSpec> = {
	'claude-code': {
		id: 'claude-code',
		name: 'Claude Code',
		binary: 'claude',
		installHint: 'npm i -g @anthropic-ai/claude-code',
		docsUrl: 'https://code.claude.com/docs/en/headless',
		versionArgs: ['--version'],
		// stdin, so a prompt containing quotes, newlines or cmd.exe
		// metacharacters never has to be escaped for a Windows shell.
		promptChannel: 'stream-json-stdin',
		runArgs: (o) => {
			const args = [
				'-p',
				'--input-format', 'stream-json',
				'--output-format', 'stream-json',
				// stream-json output is rejected without it.
				'--verbose',
				// Nexora reviews the diff afterwards, so let the agent edit
				// freely inside its worktree rather than stalling on prompts
				// it has no way to answer.
				'--permission-mode', 'acceptEdits',
				// Nobody is watching the subprocess: deny anything that would
				// otherwise wait for a human instead of hanging the step.
				'--permission-prompts', 'none',
				'--max-turns', String(o.maxTurns),
				'--session-id', o.sessionId
			];
			if (o.maxBudgetUsd && o.maxBudgetUsd > 0) {
				args.push('--max-budget-usd', String(o.maxBudgetUsd));
			}
			if (o.model) {
				args.push('--model', o.model);
			}
			return args;
		}
	},
	cursor: {
		id: 'cursor',
		name: 'Cursor',
		binary: 'cursor-agent',
		installHint: 'curl https://cursor.com/install -fsS | bash',
		docsUrl: 'https://cursor.com/docs/cli/headless',
		versionArgs: ['--version'],
		promptChannel: 'argv',
		runArgs: (o) => {
			const args = ['-p', '--output-format', 'stream-json', '--force'];
			if (o.model) {
				args.push('--model', o.model);
			}
			args.push(o.prompt);
			return args;
		}
	},
	cline: {
		id: 'cline',
		name: 'Cline',
		binary: 'cline',
		installHint: 'npm i -g cline',
		docsUrl: 'https://docs.cline.bot/usage/cli-overview',
		versionArgs: ['--version'],
		promptChannel: 'argv',
		runArgs: (o) => {
			const args = ['--json', '--auto-approve', 'true', '--timeout', '900'];
			if (o.model) {
				args.push('--model', o.model);
			}
			args.push(o.prompt);
			return args;
		}
	}
};

/**
 * Stable run id for a step, used as the worktree name and the agent's session
 * id so one run can be traced from either side.
 *
 * Shaped as a UUID because Claude Code's `--session-id` requires one, and
 * derived rather than random so a retry of the same step reuses its own id
 * instead of leaving a worktree behind under a name nothing refers to again.
 */
export function deriveRunId(seed: string): string {
	const hex = crypto.createHash('md5').update(seed, 'utf8').digest('hex');
	const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		`4${hex.slice(13, 16)}`,
		`${variant}${hex.slice(17, 20)}`,
		hex.slice(20, 32)
	].join('-');
}

export function localAgentSpec(id: string): LocalAgentSpec | undefined {
	return LOCAL_AGENTS[(id || '').trim().toLowerCase() as LocalAgentId];
}

export interface LocalAgentProbe {
	id: LocalAgentId;
	installed: boolean;
	/** Absolute path we resolved, kept so the run spawns the same file we probed. */
	path?: string;
	/** First line of --version output, for the panel's detail line. */
	version?: string;
	/** Why detection failed, when it did. */
	reason?: string;
}

const PROBE_TIMEOUT_MS = 5000;
/** Detection shells out, so hold the answer briefly rather than probing per render. */
const PROBE_TTL_MS = 30_000;

const probeCache = new Map<LocalAgentId, { at: number; probe: LocalAgentProbe }>();

/**
 * Absolute path of a binary on PATH, or undefined.
 *
 * `where`/`which` are real executables, so they spawn without a shell even on
 * Windows, where an npm-installed `claude` is really `claude.cmd` and Node
 * refuses to spawn a `.cmd` directly. Resolving first means the run can decide
 * how to launch what it found instead of guessing.
 */
function resolveBinary(binary: string): Promise<string | undefined> {
	const finder = process.platform === 'win32' ? 'where' : 'which';
	return new Promise((resolve) => {
		cp.execFile(finder, [binary], { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
			if (err) {
				resolve(undefined);
				return;
			}
			const first = String(stdout || '')
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean)[0];
			resolve(first || undefined);
		});
	});
}

function runVersion(file: string, args: string[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
		cp.execFile(
			file,
			args,
			{ timeout: PROBE_TIMEOUT_MS, windowsHide: true, shell: useShell },
			(err, stdout, stderr) => {
				if (err) {
					resolve(undefined);
					return;
				}
				const text = String(stdout || stderr || '').trim();
				resolve(text.split(/\r?\n/)[0]?.trim() || undefined);
			}
		);
	});
}

/**
 * Is this agent usable on this machine right now?
 *
 * Deliberately only answers "is it installed". Whether the vendor's own login
 * is valid is the vendor's business: the agent reports that itself when it
 * runs, and asking here would mean a second, slower, less reliable copy of a
 * check the agent already does.
 */
export async function probeLocalAgent(id: LocalAgentId, force = false): Promise<LocalAgentProbe> {
	const cached = probeCache.get(id);
	if (!force && cached && Date.now() - cached.at < PROBE_TTL_MS) {
		return cached.probe;
	}

	const spec = LOCAL_AGENTS[id];
	let probe: LocalAgentProbe;

	const resolved = await resolveBinary(spec.binary);
	if (!resolved) {
		probe = {
			id,
			installed: false,
			reason: `${spec.binary} is not on PATH`
		};
	} else {
		const version = await runVersion(resolved, spec.versionArgs);
		probe = { id, installed: true, path: resolved, version };
	}

	probeCache.set(id, { at: Date.now(), probe });
	return probe;
}

export async function probeAllLocalAgents(force = false): Promise<Record<LocalAgentId, LocalAgentProbe>> {
	const ids = Object.keys(LOCAL_AGENTS) as LocalAgentId[];
	const probes = await Promise.all(ids.map((id) => probeLocalAgent(id, force)));
	return Object.fromEntries(probes.map((p) => [p.id, p])) as Record<LocalAgentId, LocalAgentProbe>;
}

/** Drop cached probes so the next read re-checks PATH (after an install). */
export function clearLocalAgentProbes(): void {
	probeCache.clear();
}

/**
 * Offer the install line for an agent the user asked to connect.
 *
 * Nexora does not install it: that is a global package manager write on the
 * user's machine, and it belongs to them. Copying the command is the useful
 * half, and it keeps the decision where it should be.
 */
export async function offerInstall(id: LocalAgentId): Promise<void> {
	const spec = LOCAL_AGENTS[id];
	const choice = await vscode.window.showInformationMessage(
		`${spec.name} is not installed. Nexora runs it as a local command, so there is nothing to sign in to here.`,
		'Copy install command',
		'Open docs'
	);
	if (choice === 'Copy install command') {
		await vscode.env.clipboard.writeText(spec.installHint);
		void vscode.window.showInformationMessage(`Copied: ${spec.installHint}`);
	} else if (choice === 'Open docs') {
		await vscode.env.openExternal(vscode.Uri.parse(spec.docsUrl));
	}
}
