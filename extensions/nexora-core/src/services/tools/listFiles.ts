/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ToolResult } from './executor';
import { findRipgrep, listArgs, runRipgrep, tidyLines } from './ripgrep';

const SKIP_DIRS = ['node_modules', '.git', '__pycache__', 'venv', '.venv', 'dist', 'build', '.next', '.cache'];
// Files whose modification time is read to sort newest first; past this, name order.
const MAX_STAT = 2000;

/**
 * List files matching a glob with ripgrep (respects .gitignore), newest first,
 * so the files being worked on come up before old ones.
 */
export async function listFilesTool(
	workspaceRoot: string,
	glob: string = '**/*',
	maxResults: number = 100
): Promise<ToolResult> {
	const limit = Math.max(1, Math.min(1000, Math.floor(Number(maxResults) || 100)));
	const wantsFolders = glob.endsWith('/');
	const rg = findRipgrep(vscode.env.appRoot);
	if (!rg) {
		return listWithEditorSearch(workspaceRoot, wantsFolders ? '**/*' : glob, limit, wantsFolders ? glob : undefined);
	}
	const result = await runRipgrep(rg, listArgs(wantsFolders ? '**/*' : glob), workspaceRoot);
	if (result.code === 2) {
		return { success: false, error: `Listing failed: ${result.stderr.split('\n')[0] || 'ripgrep error'}` };
	}
	const all = tidyLines(result.stdout);
	if (wantsFolders) {
		return listFolders(glob, all, limit);
	}
	if (all.length === 0) {
		return { success: true, data: { glob, files: [], total: 0, note: noFilesNote(glob) }, truncated: false };
	}
	let ordered = all;
	if (all.length <= MAX_STAT) {
		const withTimes = await Promise.all(all.map(async (rel) => {
			try {
				return { rel, mtime: (await fs.stat(path.join(workspaceRoot, rel))).mtimeMs };
			} catch {
				return { rel, mtime: 0 };
			}
		}));
		ordered = withTimes.sort((a, b) => b.mtime - a.mtime).map((f) => f.rel);
	} else {
		ordered = [...all].sort();
	}
	const files = ordered.slice(0, limit);
	return {
		success: true,
		data: {
			glob,
			files,
			total: all.length,
			order: all.length <= MAX_STAT ? 'newest first' : 'by name',
			note: all.length > limit ? `${all.length} files match; showing ${limit}. Use a narrower glob.` : undefined
		},
		truncated: all.length > limit || result.cut
	};
}

/** For an empty result: what to try next, so a model does not stop at "nothing here". */
function noFilesNote(glob: string): string {
	const base = glob.split('/').pop() || '';
	const stem = base.replace(/\.[^.]*$/, '');
	const broader = stem && !/[*?[{]/.test(stem) ? ` such as "**/${stem}*"` : '';
	return `No files match "${glob}". To list folders, end the glob with "/" (e.g. "*/"). ` +
		`Before concluding it does not exist, try a broader glob${broader} or grep.`;
}

/** A glob (*, **, ?) as a regular expression over "/"-separated relative paths. */
function globToRegExp(glob: string): RegExp {
	let out = '';
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === '*' && glob[i + 1] === '*') {
			if (glob[i + 2] === '/') {
				out += '(?:.*/)?';
				i += 2;
			} else {
				out += '.*';
				i += 1;
			}
		} else if (ch === '*') {
			out += '[^/]*';
		} else if (ch === '?') {
			out += '[^/]';
		} else {
			out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${out}$`, process.platform === 'win32' ? 'i' : '');
}

/** Folders matching a glob that ends in "/", found from the listed files. Folders with no files are not seen. */
function listFolders(glob: string, files: string[], limit: number): ToolResult {
	const matcher = globToRegExp(glob.slice(0, -1) || '*');
	const folders = new Set<string>();
	for (const file of files) {
		const parts = file.split('/');
		for (let depth = 1; depth < parts.length; depth++) {
			const folder = parts.slice(0, depth).join('/');
			if (matcher.test(folder)) {
				folders.add(`${folder}/`);
			}
		}
	}
	const all = [...folders].sort();
	return {
		success: true,
		data: {
			glob,
			folders: all.slice(0, limit),
			total: all.length,
			note: all.length === 0
				? `No folders match "${glob}" (folders that hold no files are not listed). Try "*/" for the top level or "**/" for all folders.`
				: all.length > limit ? `${all.length} folders match; showing ${limit}. Use a narrower glob.` : undefined
		},
		truncated: all.length > limit
	};
}

/** The old listing, used only when the editor's ripgrep is missing. */
async function listWithEditorSearch(workspaceRoot: string, glob: string, maxResults: number, folderGlob?: string): Promise<ToolResult> {
	try {
		const workspaceUri = vscode.Uri.file(workspaceRoot);
		const excludePattern = `{${SKIP_DIRS.map(d => `**/${d}/**`).join(',')}}`;
		const found = await vscode.workspace.findFiles(
			new vscode.RelativePattern(workspaceUri, glob || '**/*'),
			new vscode.RelativePattern(workspaceUri, excludePattern),
			folderGlob ? undefined : maxResults + 1
		);
		const relative = found.map(f => vscode.workspace.asRelativePath(f, false).replace(/\\/g, '/'));
		if (folderGlob) {
			return listFolders(folderGlob, relative, maxResults);
		}
		const files = relative.slice(0, maxResults).sort();
		const note = files.length === 0 ? noFilesNote(glob) : undefined;
		return { success: true, data: { glob, files, total: files.length, note }, truncated: found.length > maxResults };
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}
