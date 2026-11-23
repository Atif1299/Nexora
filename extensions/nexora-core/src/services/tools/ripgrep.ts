/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The ripgrep that ships with the editor (`@vscode/ripgrep`), for the agent's
 * grep and list_files: fast, and it skips what .gitignore skips. Callers fall
 * back to the slower VS Code search when it is missing.
 */

// Heavy folders skipped even without a .gitignore (a fresh project often has none yet).
export const ALWAYS_SKIPPED = ['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.cache'];
const MAX_OUTPUT_BYTES = 512 * 1024;
const RG_TIMEOUT_MS = 20_000;

let cachedPath: string | null | undefined;

/** Path of rg under the editor's install folder (`vscode.env.appRoot`), or undefined. */
export function findRipgrep(appRoot: string): string | undefined {
	if (cachedPath !== undefined) {
		return cachedPath || undefined;
	}
	const exe = process.platform === 'win32' ? 'rg.exe' : 'rg';
	const candidates = [
		path.join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', exe),
		path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', exe)
	];
	cachedPath = candidates.find((file) => {
		try {
			return fs.statSync(file).isFile();
		} catch {
			return false;
		}
	}) || null;
	return cachedPath || undefined;
}

export interface RgResult {
	/** 0 = found, 1 = nothing found, 2 = error (bad pattern, unreadable path). */
	code: number;
	stdout: string;
	stderr: string;
	/** Output passed MAX_OUTPUT_BYTES and the search was stopped. */
	cut: boolean;
}

export function runRipgrep(rg: string, args: string[], cwd: string): Promise<RgResult> {
	return new Promise((resolve) => {
		const child = cp.spawn(rg, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
		const out: Buffer[] = [];
		let size = 0;
		let cut = false;
		let stderr = '';
		const timer = setTimeout(() => child.kill(), RG_TIMEOUT_MS);
		child.stdout.on('data', (chunk: Buffer) => {
			if (cut) {
				return;
			}
			size += chunk.length;
			out.push(chunk);
			if (size > MAX_OUTPUT_BYTES) {
				cut = true;
				child.kill();
			}
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});
		const finish = (code: number) => {
			clearTimeout(timer);
			resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: stderr.trim(), cut });
		};
		child.on('error', (err) => {
			stderr += err.message;
			finish(2);
		});
		child.on('close', (code) => finish(cut ? 0 : (code ?? 2)));
	});
}

export type GrepMode = 'content' | 'files' | 'count';

/** Arguments for a search, relative to the workspace root (run with cwd = root). */
export function grepArgs(pattern: string, opts: { glob?: string; mode?: GrepMode; context?: number; caseInsensitive?: boolean }): string[] {
	// --no-require-git: honour .gitignore in folders that are not git repositories yet.
	const args = ['--no-heading', '--color', 'never', '--hidden', '--no-require-git', '--path-separator', '/', '--max-columns', '300', '--max-columns-preview'];
	for (const dir of ALWAYS_SKIPPED) {
		args.push('-g', `!${dir}`);
	}
	if (opts.caseInsensitive) {
		args.push('-i');
	}
	if (opts.glob && opts.glob !== '**/*' && opts.glob !== '*') {
		args.push('-g', opts.glob);
	}
	if (opts.mode === 'files') {
		args.push('-l');
	} else if (opts.mode === 'count') {
		args.push('--count');
	} else {
		args.push('--line-number');
		const context = Math.max(0, Math.min(10, Math.floor(Number(opts.context) || 0)));
		if (context > 0) {
			args.push('-C', String(context));
		}
	}
	args.push('-e', pattern, '--', '.');
	return args;
}

export function listArgs(glob?: string): string[] {
	const args = ['--files', '--hidden', '--no-require-git', '--path-separator', '/'];
	for (const dir of ALWAYS_SKIPPED) {
		args.push('-g', `!${dir}`);
	}
	if (glob && glob !== '**/*' && glob !== '*') {
		args.push('-g', glob);
	}
	args.push('--', '.');
	return args;
}

/** rg output lines without the leading "./" (paths already use "/", see --path-separator). */
export function tidyLines(stdout: string): string[] {
	return stdout
		.split(/\r?\n/)
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/^\.\//, ''));
}
