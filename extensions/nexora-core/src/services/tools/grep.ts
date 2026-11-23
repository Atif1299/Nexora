/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ToolResult } from './executor';
import { findRipgrep, grepArgs, runRipgrep, tidyLines, type GrepMode } from './ripgrep';

const SKIP_DIRS = ['node_modules', '.git', '__pycache__', 'venv', '.venv', 'dist', 'build'];

export interface GrepOptions {
	mode?: GrepMode;
	context?: number;
	caseInsensitive?: boolean;
}

/**
 * Search file contents with ripgrep (respects .gitignore).
 * mode content: `path:line:text` lines (with `-C` context lines as `path-line-text`);
 * files: matching paths; count: `path:count`.
 */
export async function grepTool(
	workspaceRoot: string,
	pattern: string,
	glob: string = '**/*',
	maxResults: number = 50,
	opts: GrepOptions = {}
): Promise<ToolResult> {
	if (typeof pattern !== 'string' || pattern.length === 0) {
		return { success: false, error: 'pattern is empty.' };
	}
	const limit = Math.max(1, Math.min(500, Math.floor(Number(maxResults) || 50)));
	const rg = findRipgrep(vscode.env.appRoot);
	if (!rg) {
		return grepWithEditorSearch(workspaceRoot, pattern, glob, limit, opts.caseInsensitive !== false);
	}
	const mode: GrepMode = opts.mode === 'files' || opts.mode === 'count' ? opts.mode : 'content';
	const result = await runRipgrep(rg, grepArgs(pattern, { glob, mode, context: opts.context, caseInsensitive: opts.caseInsensitive }), workspaceRoot);
	if (result.code === 2) {
		return { success: false, error: `Search failed: ${result.stderr.split('\n')[0] || 'ripgrep error'}. The pattern is a regular expression; escape characters such as ( [ . * when you mean them literally.` };
	}
	const lines = tidyLines(result.stdout);
	const shown = lines.slice(0, limit);
	return {
		success: true,
		data: {
			pattern,
			mode,
			output: shown.length > 0 ? shown.join('\n') : 'No matches.',
			lines_shown: shown.length,
			note: shown.length === 0
				? 'Nothing matched. Before concluding it is not there, try case_insensitive, a shorter or simpler pattern, or a wider glob.'
				: lines.length > limit || result.cut ? `More results than shown (${result.cut ? 'many' : lines.length}). Narrow the pattern or glob, or raise max_results.` : undefined
		},
		truncated: lines.length > limit || result.cut
	};
}

/** The old search, used only when the editor's ripgrep is missing. */
async function grepWithEditorSearch(
	workspaceRoot: string,
	pattern: string,
	glob: string,
	maxResults: number,
	caseInsensitive: boolean
): Promise<ToolResult> {
	try {
		const workspaceUri = vscode.Uri.file(workspaceRoot);
		const excludePattern = `{${SKIP_DIRS.map(d => `**/${d}/**`).join(',')}}`;
		const results: string[] = [];
		const files = await vscode.workspace.findFiles(
			new vscode.RelativePattern(workspaceUri, glob || '**/*'),
			new vscode.RelativePattern(workspaceUri, excludePattern),
			500
		);
		const regex = new RegExp(pattern, caseInsensitive ? 'i' : '');
		for (const file of files) {
			if (results.length >= maxResults) {
				break;
			}
			try {
				const doc = await vscode.workspace.openTextDocument(file);
				const lines = doc.getText().split('\n');
				for (let i = 0; i < lines.length && results.length < maxResults; i++) {
					if (regex.test(lines[i])) {
						results.push(`${vscode.workspace.asRelativePath(file, false)}:${i + 1}:${lines[i].trim().slice(0, 300)}`);
					}
				}
			} catch {
				// Skip files that can't be read
			}
		}
		return {
			success: true,
			data: { pattern, mode: 'content', output: results.length > 0 ? results.join('\n') : 'No matches.', lines_shown: results.length },
			truncated: results.length >= maxResults
		};
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}
