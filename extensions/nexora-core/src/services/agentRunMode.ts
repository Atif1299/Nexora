/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export type AgentRunMode = 'ask' | 'auto-edit' | 'allowlist' | 'run-everything';

const RUN_MODES: readonly AgentRunMode[] = ['ask', 'auto-edit', 'allowlist', 'run-everything'];

/** Cheap terminal allowlist: first token only. Denylist still always wins. */
const ALLOWLIST_PREFIXES = new Set([
	'npm', 'npx', 'yarn', 'pnpm', 'bun',
	'git', 'python', 'python3', 'py', 'pip', 'pip3'
]);

function asRunMode(value: unknown): AgentRunMode | undefined {
	return typeof value === 'string' && (RUN_MODES as readonly string[]).includes(value)
		? value as AgentRunMode
		: undefined;
}

function firstExplicit<T>(inspect: { workspaceFolderValue?: T; workspaceValue?: T; globalValue?: T } | undefined): T | undefined {
	if (!inspect) {
		return undefined;
	}
	if (inspect.workspaceFolderValue !== undefined) {
		return inspect.workspaceFolderValue;
	}
	if (inspect.workspaceValue !== undefined) {
		return inspect.workspaceValue;
	}
	return inspect.globalValue;
}

/**
 * Resolve run mode. `nexora.agent.runMode` wins.
 * Legacy `nexora.agent.autoApply`: explicit true → auto-edit, explicit false → ask.
 * Unset → auto-edit (demo default so file edits do not stall).
 */
export function getAgentRunMode(): AgentRunMode {
	const cfg = vscode.workspace.getConfiguration('nexora');
	const fromRunMode = asRunMode(firstExplicit(cfg.inspect<string>('agent.runMode')));
	if (fromRunMode) {
		return fromRunMode;
	}

	const autoApply = firstExplicit(cfg.inspect<boolean>('agent.autoApply'));
	if (autoApply === true) {
		return 'auto-edit';
	}
	if (autoApply === false) {
		return 'ask';
	}

	return asRunMode(cfg.get<string>('agent.runMode')) ?? 'auto-edit';
}

export function shouldConfirmFileEdits(): boolean {
	return getAgentRunMode() === 'ask';
}

export function isAllowlistedCommand(command: string): boolean {
	const token = command.trim().split(/\s+/)[0] || '';
	const base = token.replace(/^["']|["']$/g, '').replace(/\\/g, '/').split('/').pop() || '';
	const name = base.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
	return ALLOWLIST_PREFIXES.has(name);
}

export function shouldConfirmTerminal(command: string): boolean {
	const mode = getAgentRunMode();
	if (mode === 'run-everything') {
		return false;
	}
	if (mode === 'allowlist') {
		return !isAllowlistedCommand(command);
	}
	return true;
}

const MAX_TURNS = [10, 15, 25, 40] as const;

export type AgentUiSettings = {
	runMode: AgentRunMode;
	maxTurns: number;
	includeOpenEditors: boolean;
	inlineDiffs: boolean;
	autoFormat: boolean;
	autoApproveModeSwitch: boolean;
	autoCloseTerminal: boolean;
	submitWithCtrlEnter: boolean;
};

function agentCfg(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration('nexora');
}

export function getAgentMaxTurns(): number {
	const n = agentCfg().get<number>('agent.maxTurns', 25);
	return (MAX_TURNS as readonly number[]).includes(n) ? n : 25;
}

/** 'nexora' means the built-in loop; anything else is a local agent id. */
export type CodeExecutor = 'nexora' | 'claude-code' | 'cursor' | 'cline';

const CODE_EXECUTORS: readonly CodeExecutor[] = ['nexora', 'claude-code', 'cursor', 'cline'];

/**
 * Who runs a workspace step.
 *
 * A plan step may name an executor, and that wins: the plan knows what the
 * task needs. Otherwise the user's setting decides, and an unrecognised value
 * from either falls back to Nexora's own loop rather than silently handing the
 * user's workspace to something they did not choose.
 */
export function getCodeExecutor(override?: string): CodeExecutor {
	const requested = (override || '').trim().toLowerCase();
	if ((CODE_EXECUTORS as readonly string[]).includes(requested)) {
		return requested as CodeExecutor;
	}
	const configured = (agentCfg().get<string>('agent.codeExecutor', 'nexora') || '').trim().toLowerCase();
	return (CODE_EXECUTORS as readonly string[]).includes(configured)
		? (configured as CodeExecutor)
		: 'nexora';
}

/** Spend cap per third-party agent step, in USD. 0 means no cap. */
export function getAgentMaxBudgetUsd(): number {
	const n = agentCfg().get<number>('agent.maxBudgetUsd', 0);
	return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

export function getAgentFlag(
	name: 'includeOpenEditors' | 'inlineDiffs' | 'autoFormat' | 'autoApproveModeSwitch' | 'autoCloseTerminal'
): boolean {
	const fallback = name !== 'autoApproveModeSwitch';
	return agentCfg().get<boolean>(`agent.${name}`, fallback) ?? fallback;
}

export function getSubmitWithCtrlEnter(): boolean {
	return agentCfg().get<boolean>('chat.submitWithCtrlEnter', false) === true;
}

export function getAgentUiSettings(): AgentUiSettings {
	return {
		runMode: getAgentRunMode(),
		maxTurns: getAgentMaxTurns(),
		includeOpenEditors: getAgentFlag('includeOpenEditors'),
		inlineDiffs: getAgentFlag('inlineDiffs'),
		autoFormat: getAgentFlag('autoFormat'),
		autoApproveModeSwitch: getAgentFlag('autoApproveModeSwitch'),
		autoCloseTerminal: getAgentFlag('autoCloseTerminal'),
		submitWithCtrlEnter: getSubmitWithCtrlEnter()
	};
}
