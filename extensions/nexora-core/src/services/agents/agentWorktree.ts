/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A scratch copy of the workspace for a third-party agent to edit.
 *
 * Claude Code, Cursor and Cline all write files on their own: by the time one
 * of them has finished, the edits exist. Letting them loose on the real
 * workspace would mean Nexora silently became the thing its human-in-the-loop
 * promise exists to prevent, so each run happens in a git worktree instead.
 * The agent edits freely there, and what comes back is a diff the user accepts
 * or rejects file by file, through the same preview as any Nexora edit.
 *
 * The worktree lives in the extension's storage, not inside the repository.
 * A folder appearing under someone's project because an agent ran is litter,
 * and worse, it is litter their next commit might pick up.
 *
 * What a worktree carries, and what it does not: the agent starts from HEAD
 * plus whatever the user has changed in tracked files, because an agent that
 * cannot see work in progress will undo it. Untracked files do not come along
 * -- copying unknown files out of someone's workspace is a bigger promise than
 * this needs to make -- so `prepare` reports them and the caller says so.
 */

import * as cp from 'child_process';
import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';

const GIT_TIMEOUT_MS = 60_000;
/** Files above this are reported as changed but never diffed in memory. */
const MAX_DIFF_BYTES = 2 * 1024 * 1024;

export interface GitResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

function git(args: string[], cwd?: string): Promise<GitResult> {
	return new Promise((resolve) => {
		cp.execFile(
			'git',
			args,
			{ cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
			(err, stdout, stderr) => {
				resolve({
					ok: !err,
					stdout: String(stdout || ''),
					stderr: String(stderr || '')
				});
			}
		);
	});
}

/** Absolute repository root for a path, or undefined when it is not a repo. */
export async function findRepoRoot(dir: string): Promise<string | undefined> {
	const result = await git(['rev-parse', '--show-toplevel'], dir);
	if (!result.ok) {
		return undefined;
	}
	const root = result.stdout.trim();
	return root ? path.normalize(root) : undefined;
}

/** Either a worktree ready for the agent, or why one could not be made. */
export type PrepareWorktreeResult =
	| { ok: true; worktree: PreparedWorktree }
	| { ok: false; error: string };

export interface PreparedWorktree {
	/** Absolute path the agent runs in. */
	path: string;
	repoRoot: string;
	/** Tracked edits that were carried in from the user's working tree. */
	carriedUncommitted: boolean;
	/** Untracked files left behind; the agent will not see these. */
	untrackedLeftBehind: string[];
}

/**
 * Create a worktree for one agent run.
 *
 * Detached at HEAD so the run can never move a branch the user is on, and
 * named by the caller's run id so two steps cannot collide.
 */
export async function prepareWorktree(options: {
	workspacePath: string;
	runId: string;
	storageDir: string;
}): Promise<PrepareWorktreeResult> {
	const repoRoot = await findRepoRoot(options.workspacePath);
	if (!repoRoot) {
		return {
			ok: false,
			error:
				'This workspace is not a git repository, so there is nothing to diff an agent run against.'
		};
	}

	const worktreePath = path.join(options.storageDir, options.runId);
	// git refuses an existing directory, and a leftover from a crashed run
	// would otherwise block every later attempt.
	await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
	await fs.mkdir(path.dirname(worktreePath), { recursive: true });

	const add = await git(['worktree', 'add', '--detach', worktreePath, 'HEAD'], repoRoot);
	if (!add.ok) {
		return { ok: false, error: `Could not create a worktree: ${add.stderr.trim() || 'git worktree add failed'}` };
	}

	// Carry the user's uncommitted work across, so the agent edits what they
	// are actually looking at rather than the last commit.
	let carriedUncommitted = false;
	const diff = await git(['diff', 'HEAD', '--binary'], repoRoot);
	if (diff.ok && diff.stdout.trim()) {
		const applied = await applyPatch(worktreePath, diff.stdout);
		carriedUncommitted = applied;
		if (!applied) {
			await removeWorktree(repoRoot, worktreePath);
			return {
				ok: false,
				error: 'Could not copy your uncommitted changes into the agent worktree; nothing was run.'
			};
		}
	}

	// Commit whatever is in the worktree now, so `git status` afterwards shows
	// the agent's work and nothing else. Without this the user's own
	// uncommitted edits -- and on Windows, files git considers modified purely
	// because of line-ending normalization -- would be handed back for review
	// as though the agent had written them.
	//
	// The identity is supplied per command rather than read from config: a
	// developer with no global user.email would otherwise fail here, and the
	// commit only ever exists inside a worktree that is deleted afterwards.
	await git(['add', '-A'], worktreePath);
	const baseline = await git(
		[
			'-c', 'user.email=agent@nexora.local',
			'-c', 'user.name=Nexora',
			'commit', '--allow-empty', '--no-verify', '--quiet',
			'-m', 'nexora: agent run baseline'
		],
		worktreePath
	);
	if (!baseline.ok) {
		await removeWorktree(repoRoot, worktreePath);
		return {
			ok: false,
			error: `Could not snapshot the agent worktree: ${baseline.stderr.trim() || 'git commit failed'}`
		};
	}

	const untracked = await git(['ls-files', '--others', '--exclude-standard'], repoRoot);
	const untrackedLeftBehind = untracked.ok
		? untracked.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
		: [];

	return {
		ok: true,
		worktree: { path: worktreePath, repoRoot, carriedUncommitted, untrackedLeftBehind }
	};
}

/** Feed a patch to `git apply` over stdin so no temp file is needed. */
function applyPatch(cwd: string, patch: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = cp.execFile(
			'git',
			['apply', '--whitespace=nowarn', '-'],
			{ cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true },
			(err) => resolve(!err)
		);
		child.stdin?.end(patch);
	});
}

export interface AgentFileChange {
	/** Path relative to the repository root, with forward slashes. */
	relPath: string;
	status: 'added' | 'modified' | 'deleted';
	/** Absent for a deletion, and for a file too large to review in memory. */
	content?: string;
	tooLarge?: boolean;
}

/**
 * What the agent changed, as content rather than a patch.
 *
 * Content, because the review step writes whole files through Nexora's normal
 * diff preview; a patch would have to be re-applied against a workspace that
 * may have moved on, and would fail in exactly the situation where the user
 * most wants to see what happened.
 */
export async function collectChanges(worktree: PreparedWorktree): Promise<AgentFileChange[]> {
	const status = await git(['status', '--porcelain=v1', '-z'], worktree.path);
	if (!status.ok) {
		return [];
	}

	const changes: AgentFileChange[] = [];
	// -z gives NUL-separated records, so paths with spaces or quotes survive.
	const entries = status.stdout.split('\0').filter((e) => e.length > 0);
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const code = entry.slice(0, 2);
		let relPath = entry.slice(3);
		if (code[0] === 'R' || code[0] === 'C') {
			// A rename record is followed by its source path; the new path is
			// what we review, so skip the extra record.
			i++;
		}
		if (!relPath) {
			continue;
		}
		relPath = relPath.replace(/\\/g, '/');

		const deleted = code.includes('D');
		if (deleted) {
			changes.push({ relPath, status: 'deleted' });
			continue;
		}

		const abs = path.join(worktree.path, relPath);
		try {
			const stat = await fs.stat(abs);
			if (stat.size > MAX_DIFF_BYTES) {
				changes.push({ relPath, status: code.includes('?') ? 'added' : 'modified', tooLarge: true });
				continue;
			}
			const content = await fs.readFile(abs, 'utf8');
			changes.push({
				relPath,
				status: code.includes('?') || code.includes('A') ? 'added' : 'modified',
				content
			});
		} catch {
			// Vanished between status and read; nothing to review.
		}
	}
	return changes;
}

/** Remove the worktree and its registration. Safe to call twice. */
export async function removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
	await git(['worktree', 'remove', '--force', worktreePath], repoRoot);
	// `worktree remove` can refuse (dirty index, a file held open on Windows);
	// drop the directory and let git forget the registration either way.
	await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
	await git(['worktree', 'prune'], repoRoot);
}

/** Directory worktrees live in, created on demand. */
export async function worktreeStorageDir(context: vscode.ExtensionContext): Promise<string> {
	const dir = path.join(context.globalStorageUri.fsPath, 'agent-worktrees');
	await fs.mkdir(dir, { recursive: true });
	return dir;
}
