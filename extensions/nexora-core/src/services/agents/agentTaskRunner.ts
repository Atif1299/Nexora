/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hand one workspace step to a third-party coding agent.
 *
 * The shape of a step is the same whichever agent runs it: a prompt and a
 * directory go in, edited files come out. That is why this slots into the
 * existing workspace_task contract rather than inventing a second one -- the
 * engine already emits those steps and waits for a result, and it does not
 * need to know who did the work.
 *
 * What it adds is the part Nexora cannot delegate: the agent edits a worktree,
 * and every file it touched is offered to the user through the same diff
 * preview as any Nexora edit. An agent that writes straight into someone's
 * project would make the approval step decorative, and the approval step is
 * the reason to use Nexora rather than the agent on its own.
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';

import { previewDiffAndConfirm } from '../tools/diffProvider';
import { formatAfterWrite } from '../tools/writeFile';
import {
	collectChanges,
	prepareWorktree,
	removeWorktree,
	worktreeStorageDir,
	type AgentFileChange
} from './agentWorktree';
import { localAgentSpec, probeLocalAgent, type LocalAgentId } from './localAgents';
import { runLocalAgent, type LocalAgentProgress } from './runLocalAgent';

export interface AgentTaskOutcome {
	success: boolean;
	summary: string;
	/** Workspace-relative paths the user accepted. */
	files: string[];
	costUsd?: number;
	error?: string;
}

export interface AgentTaskOptions {
	agentId: LocalAgentId;
	instruction: string;
	workspacePath: string;
	/** Stable id for this run; also the worktree name and the agent session id. */
	runId: string;
	context: vscode.ExtensionContext;
	model?: string;
	maxTurns?: number;
	maxBudgetUsd?: number;
	token?: vscode.CancellationToken;
	onProgress?: (progress: LocalAgentProgress) => void;
}

const DEFAULT_MAX_TURNS = 25;

/**
 * Review one file the agent changed and, if accepted, write it for real.
 *
 * Deletions are confirmed in a message box rather than a diff: there is no
 * "after" to show, and a diff of a file against nothing reads as if the whole
 * file were being rewritten.
 */
async function applyChange(
	change: AgentFileChange,
	workspacePath: string
): Promise<boolean> {
	const fullPath = path.join(workspacePath, change.relPath);

	if (change.tooLarge) {
		const choice = await vscode.window.showWarningMessage(
			`${change.relPath} is too large to preview. Apply it anyway?`,
			{ modal: true },
			'Apply'
		);
		return choice === 'Apply';
	}

	if (change.status === 'deleted') {
		const choice = await vscode.window.showWarningMessage(
			`The agent deleted ${change.relPath}. Delete it from your workspace?`,
			{ modal: true },
			'Delete'
		);
		if (choice !== 'Delete') {
			return false;
		}
		await fs.rm(fullPath, { force: true });
		return true;
	}

	if (typeof change.content !== 'string') {
		return false;
	}

	let existsOnDisk = true;
	try {
		await fs.access(fullPath);
	} catch {
		existsOnDisk = false;
	}

	const accepted = await previewDiffAndConfirm({
		filePath: change.relPath,
		fullPath,
		proposedContent: change.content,
		existsOnDisk
	});
	if (!accepted) {
		return false;
	}

	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	await fs.writeFile(fullPath, change.content, 'utf8');
	await formatAfterWrite(fullPath).catch(() => undefined);
	return true;
}

/**
 * Run a workspace step with a local agent, then review what it produced.
 *
 * The worktree is removed whatever happens. Leaving one behind would quietly
 * fill the user's storage with copies of their repository, and a stale one
 * blocks the next run under the same id.
 */
export async function runWorkspaceTaskWithAgent(
	options: AgentTaskOptions
): Promise<AgentTaskOutcome> {
	const spec = localAgentSpec(options.agentId);
	if (!spec) {
		return { success: false, summary: 'Unknown agent', files: [], error: `No such agent: ${options.agentId}` };
	}

	const probe = await probeLocalAgent(options.agentId);
	if (!probe.installed) {
		return {
			success: false,
			summary: `${spec.name} is not installed`,
			files: [],
			error: `Install it with: ${spec.installHint}`
		};
	}

	const storageDir = await worktreeStorageDir(options.context);
	const prepareResult = await prepareWorktree({
		workspacePath: options.workspacePath,
		runId: options.runId,
		storageDir
	});
	if (!prepareResult.ok) {
		return {
			success: false,
			summary: prepareResult.error,
			files: [],
			error: prepareResult.error
		};
	}
	const prepared = prepareResult.worktree;

	try {
		const run = await runLocalAgent({
			spec,
			probe,
			cwd: prepared.path,
			prompt: options.instruction,
			runId: options.runId,
			model: options.model,
			maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
			maxBudgetUsd: options.maxBudgetUsd,
			token: options.token,
			onProgress: options.onProgress
		});

		const changes = await collectChanges(prepared);

		if (!run.success && changes.length === 0) {
			return {
				success: false,
				summary: run.summary || `${spec.name} failed`,
				files: [],
				costUsd: run.costUsd,
				error: run.error
			};
		}

		if (changes.length === 0) {
			return {
				success: run.success,
				summary: run.summary || `${spec.name} made no file changes`,
				files: [],
				costUsd: run.costUsd
			};
		}

		// A failed run that still edited files is worth reviewing: the user may
		// want a partial result rather than losing the work outright.
		const accepted: string[] = [];
		for (const change of changes) {
			if (options.token?.isCancellationRequested) {
				break;
			}
			if (await applyChange(change, options.workspacePath)) {
				accepted.push(change.relPath);
			}
		}

		const rejected = changes.length - accepted.length;
		const detail = rejected > 0 ? ` (${accepted.length} of ${changes.length} applied)` : '';
		const headline = (run.summary.split(/\r?\n/).find((l) => l.trim()) || `${spec.name} finished`).trim();

		let summary = `${headline}${detail}`;
		if (prepared.untrackedLeftBehind.length > 0) {
			// Said once, plainly: the agent could not see these, so a confusing
			// result has an explanation rather than looking like a bad answer.
			summary += ` [${prepared.untrackedLeftBehind.length} untracked file(s) were not visible to the agent]`;
		}

		return {
			success: run.success && accepted.length > 0,
			summary: summary.slice(0, 400),
			files: accepted,
			costUsd: run.costUsd,
			error: run.success ? undefined : run.error
		};
	} finally {
		await removeWorktree(prepared.repoRoot, prepared.path);
	}
}
