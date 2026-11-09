/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

import type { SSEEvent, Transport } from './transport';
import type { Effort } from '../../webview/chat/types';
import { agentCwd, agentShell, backgroundCommands } from '../tools/terminalCommand';
import { ensureRuntimeProbe, runtimesForPrompt } from '../tools/runtimeProbe';

/** Agent turns call LiteLLM with tools; 30s aborts a healthy first completion. */
const AGENT_TURN_TIMEOUT_MS = 120000;
/** Room for a whole file in one write_file call; the engine caps it at the model's own limit. */
const AGENT_MAX_TOKENS = 8192;

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
	/** What this turn cost, as the engine priced it (done event). */
	cost_usd?: number;
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
	return agentShell().kind;
}

const GIT_TIMEOUT_MS = 1500;
const ENV_CACHE_MS = 20_000;
const MAX_TOP_LEVEL = 60;

type GitFacts = { repo: boolean; branch?: string; remote?: string; user_name?: string };
const gitCache = new Map<string, { at: number; facts: GitFacts }>();

function git(cwd: string, args: string[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		cp.execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
			resolve(err ? undefined : String(stdout).trim() || undefined);
		});
	});
}

async function gitFacts(workspacePath: string): Promise<GitFacts> {
	const cached = gitCache.get(workspacePath);
	if (cached && Date.now() - cached.at < ENV_CACHE_MS) {
		return cached.facts;
	}
	const [inside, branch, remote, userName] = await Promise.all([
		git(workspacePath, ['rev-parse', '--is-inside-work-tree']),
		git(workspacePath, ['branch', '--show-current']),
		git(workspacePath, ['remote', 'get-url', 'origin']),
		git(workspacePath, ['config', 'user.name'])
	]);
	const facts: GitFacts = inside === 'true'
		? { repo: true, branch, remote, user_name: userName }
		: { repo: false, user_name: userName };
	gitCache.set(workspacePath, { at: Date.now(), facts });
	return facts;
}

function topLevel(workspacePath: string): string[] {
	try {
		const entries = fs.readdirSync(workspacePath, { withFileTypes: true })
			.filter((e) => e.name !== '.git')
			.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
			.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
		return entries.length > MAX_TOP_LEVEL
			? [...entries.slice(0, MAX_TOP_LEVEL), `... (${entries.length - MAX_TOP_LEVEL} more)`]
			: entries;
	} catch {
		return [];
	}
}

/**
 * "Windows 11 (build 26200, x64)": Windows 11 still reports version 10.0, so
 * the raw os.release() made the model say "Windows 10". Build 22000+ is 11.
 */
function osLabel(): string {
	if (process.platform === 'win32') {
		const build = Number(os.release().split('.')[2]) || 0;
		const name = build >= 22000 ? 'Windows 11' : 'Windows 10';
		return `${name} (build ${build || os.release()}, ${os.arch()})`;
	}
	return `${os.type()} ${os.release()} (${process.platform}, ${os.arch()})`;
}

function localDate(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Facts about the machine the agent works on, for the engine's environment
 * block. Without them the model guessed: bash syntax in PowerShell, a
 * `yourusername` placeholder for the GitHub remote, the wrong current folder.
 */
export async function agentEnvironment(workspacePath?: string): Promise<Record<string, unknown>> {
	const shell = agentShell();
	const env: Record<string, unknown> = {
		os: osLabel(),
		shell: shell.label,
		shell_kind: shell.kind,
		date: localDate(),
		background_commands: backgroundCommands().filter((c) => c.status === 'running')
	};
	if (workspacePath) {
		env.workspace = workspacePath;
		env.cwd = agentCwd(workspacePath);
		env.git = await gitFacts(workspacePath);
		env.top_level = topLevel(workspacePath);
		// Checked by running each tool (cached 2 min); a failed check just leaves it out.
		const runtimes = await ensureRuntimeProbe(workspacePath).catch(() => undefined);
		if (runtimes) {
			env.runtimes = runtimesForPrompt(runtimes);
		}
	}
	return env;
}

/** nexora.agent.projectRules: whether Ask, Agent and Chat requests carry the project rule files. */
export function projectRulesEnabled(): boolean {
	return vscode.workspace.getConfiguration('nexora.agent').get<boolean>('projectRules', true);
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
			signal?: AbortSignal,
			effort?: Effort
		): Promise<AgentTurnResponse> => {
			return await transport.post('/api/agent/turn', {
				messages,
				workspace_id: workspaceId,
				workspace_path: workspacePath,
				model,
				mode,
				max_tokens: AGENT_MAX_TOKENS,
				effort,
				session_id: sessionId,
				shell: currentShell(),
				environment: await agentEnvironment(workspacePath)
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
			signal?: AbortSignal,
			effort?: Effort,
			subagent?: string
		): AsyncIterable<SSEEvent> => {
			return (async function* () {
				const environment = await agentEnvironment(workspacePath);
				yield* transport.postStream('/api/agent/turn/stream', {
					messages,
					workspace_id: workspaceId,
					workspace_path: workspacePath,
					model,
					mode,
					max_tokens: AGENT_MAX_TOKENS,
					effort,
					session_id: sessionId,
					shell: currentShell(),
					environment,
					project_rules: projectRulesEnabled(),
					// A subagent run (delegate): the engine uses that agent's prompt and tools.
					subagent
				}, signal, AGENT_TURN_TIMEOUT_MS);
			})();
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
