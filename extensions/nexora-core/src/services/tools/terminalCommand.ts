/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import type { ToolResult } from './executor';

/** Maximum bytes returned to the LLM (8 KB per stream). */
const MAX_OUTPUT_BYTES = 8 * 1024;

/** Default and maximum allowed timeouts. */
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;

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

/**
 * Truncate a string to MAX_OUTPUT_BYTES at a UTF-8 boundary.
 */
function truncateOutput(text: string): { text: string; truncated: boolean } {
	const buf = Buffer.from(text, 'utf8');
	if (buf.length <= MAX_OUTPUT_BYTES) {
		return { text, truncated: false };
	}
	return { text: buf.slice(0, MAX_OUTPUT_BYTES).toString('utf8'), truncated: true };
}

/**
 * Run a terminal command inside the workspace.
 *
 * Security guarantees:
 * - Checks command against a denylist before showing the confirmation dialog.
 * - Validates that cwd resolves inside the workspace root.
 * - Uses execFile with an explicit shell binary (not exec) to avoid PATH injection
 *   through the file argument.
 * - Truncates stdout and stderr to 8 KB before returning to the LLM.
 * - Enforces a configurable timeout (default 60 s, max 300 s).
 */
export async function runTerminalCommandTool(
	workspaceRoot: string,
	command: string,
	cwd?: string,
	timeoutMs?: number
): Promise<ToolResult> {
	// Security: denylist check before showing any dialog
	for (const pattern of DENYLIST) {
		if (pattern.test(command)) {
			return {
				success: false,
				error: `Command blocked by security policy: "${command}"`
			};
		}
	}

	// Validate and resolve cwd
	const rawCwd = cwd ? path.resolve(workspaceRoot, cwd) : workspaceRoot;
	// Normalise with a trailing sep to prevent "/workspace-extra" matching "/workspace"
	const rootNorm = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
	const cwdNorm = rawCwd.endsWith(path.sep) ? rawCwd : rawCwd + path.sep;
	if (!cwdNorm.startsWith(rootNorm) && rawCwd !== workspaceRoot) {
		return {
			success: false,
			error: `cwd must be inside the workspace root ("${workspaceRoot}")`
		};
	}
	const effectiveCwd = rawCwd;

	// Clamp timeout
	const effectiveTimeout = Math.min(
		timeoutMs !== undefined && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
		MAX_TIMEOUT_MS
	);

	// Show non-modal confirmation dialog
	const displayCmd = command.length > 80 ? command.slice(0, 77) + '...' : command;
	const choice = await vscode.window.showWarningMessage(
		`Nexora wants to run: \`${displayCmd}\``,
		'Allow',
		'Deny'
	);
	if (choice !== 'Allow') {
		return { success: false, error: 'User denied terminal command execution.' };
	}

	// Execute via execFile with an explicit shell so compound commands work
	// while still avoiding exec's implicit PATH lookup for the shell binary.
	const isWindows = process.platform === 'win32';
	const shellBin = isWindows ? 'cmd.exe' : '/bin/sh';
	const shellArgs = isWindows ? ['/c', command] : ['-c', command];

	return new Promise<ToolResult>((resolve) => {
		cp.execFile(
			shellBin,
			shellArgs,
			{
				cwd: effectiveCwd,
				timeout: effectiveTimeout,
				maxBuffer: MAX_OUTPUT_BYTES * 4,
			},
			(err, stdout, stderr) => {
				const stdoutResult = truncateOutput(stdout ?? '');
				const stderrResult = truncateOutput(stderr ?? '');
				const isTruncated = stdoutResult.truncated || stderrResult.truncated;

				if (err && (err as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
					resolve({
						success: false,
						error: `Command timed out after ${effectiveTimeout} ms`,
						data: {
							stdout: stdoutResult.text,
							stderr: stderrResult.text,
							exitCode: -1
						},
						truncated: isTruncated
					});
					return;
				}

				const exitCode = err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? -1 : 0;
				// err.code for process exit is the numeric exit status
				const numericExit = typeof exitCode === 'number' ? exitCode : -1;

				resolve({
					success: !err || numericExit === 0,
					data: {
						stdout: stdoutResult.text,
						stderr: stderrResult.text,
						exitCode: err ? (err as NodeJS.ErrnoException).code ?? -1 : 0
					},
					truncated: isTruncated
				});
			}
		);
	});
}
