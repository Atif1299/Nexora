/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import type { ToolResult } from './executor';

/**
 * Editor errors for the agent, like Cursor's lint loop: after each edit the
 * new errors in that file come back with the tool result, and get_diagnostics
 * reads them on request.
 */

// Languages whose checkers report problems; others (HTML, Markdown, text) are not waited on.
const CHECKED_LANGUAGES = new Set([
	'typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'python', 'json', 'jsonc',
	'css', 'scss', 'less', 'go', 'rust', 'java', 'csharp', 'c', 'cpp', 'php', 'vue', 'svelte', 'dart', 'kotlin'
]);
// How long an edit waits for the checker to report (it analyses the new text first).
const AFTER_EDIT_WAIT_MS = 1500;
const MAX_AFTER_EDIT = 10;
const MAX_LISTED = 50;

function severityName(severity: vscode.DiagnosticSeverity): string {
	switch (severity) {
		case vscode.DiagnosticSeverity.Error: return 'error';
		case vscode.DiagnosticSeverity.Warning: return 'warning';
		case vscode.DiagnosticSeverity.Information: return 'info';
		default: return 'hint';
	}
}

function describe(d: vscode.Diagnostic, file?: string): string {
	const where = `${file ? file + ':' : 'line '}${d.range.start.line + 1}`;
	const source = d.source ? ` (${d.source}${d.code !== undefined && typeof d.code !== 'object' ? ' ' + d.code : ''})` : '';
	return `${where} ${severityName(d.severity)}: ${d.message.split('\n')[0]}${source}`;
}

/** Resolves when the checker reports for `uri`, or after `ms`. */
function waitForReport(uri: vscode.Uri, ms: number): Promise<void> {
	return new Promise((resolve) => {
		const key = uri.toString();
		const timer = setTimeout(done, ms);
		const sub = vscode.languages.onDidChangeDiagnostics((e) => {
			if (e.uris.some((u) => u.toString() === key)) {
				done();
			}
		});
		function done(): void {
			clearTimeout(timer);
			sub.dispose();
			resolve();
		}
	});
}

/**
 * Errors in a file the agent just wrote, one line each; undefined when the
 * language has no checker. Opening the document makes the checker look at it.
 */
export async function errorsAfterEdit(fullPath: string): Promise<string[] | undefined> {
	try {
		const uri = vscode.Uri.file(fullPath);
		const doc = await vscode.workspace.openTextDocument(uri);
		if (!CHECKED_LANGUAGES.has(doc.languageId)) {
			return undefined;
		}
		await waitForReport(uri, AFTER_EDIT_WAIT_MS);
		return vscode.languages.getDiagnostics(uri)
			.filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
			.slice(0, MAX_AFTER_EDIT)
			.map((d) => describe(d));
	} catch {
		return undefined;
	}
}

/** Adds the after-edit check to a successful write/patch result. */
export async function withErrorsAfterEdit(result: ToolResult, fullPath: string): Promise<ToolResult> {
	if (!result.success || !result.data) {
		return result;
	}
	const errors = await errorsAfterEdit(fullPath);
	if (errors === undefined) {
		return result;
	}
	result.data.errors_after_edit = errors.length > 0 ? errors : 'none';
	if (errors.length > 0) {
		result.data.note = 'The editor reports these errors in the file now. Fix them before moving on, unless they were there before your edit.';
	}
	return result;
}

/** get_diagnostics: problems in one file, or in the whole workspace. */
export async function getDiagnosticsTool(workspaceRoot: string, filePath?: string, includeWarnings: boolean = true): Promise<ToolResult> {
	const keep = (d: vscode.Diagnostic) =>
		d.severity === vscode.DiagnosticSeverity.Error || (includeWarnings && d.severity === vscode.DiagnosticSeverity.Warning);
	if (filePath) {
		const fullPath = path.resolve(workspaceRoot, filePath);
		const rel = path.relative(path.resolve(workspaceRoot), fullPath);
		if (rel.startsWith('..') || path.isAbsolute(rel)) {
			return { success: false, error: `Path '${filePath}' is outside workspace root` };
		}
		const uri = vscode.Uri.file(fullPath);
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			if (vscode.languages.getDiagnostics(uri).length === 0 && CHECKED_LANGUAGES.has(doc.languageId)) {
				await waitForReport(uri, AFTER_EDIT_WAIT_MS);
			}
		} catch {
			return { success: false, error: `File not found: ${filePath}` };
		}
		const found = vscode.languages.getDiagnostics(uri).filter(keep);
		return {
			success: true,
			data: { path: filePath, problems: found.slice(0, MAX_LISTED).map((d) => describe(d)), total: found.length },
			truncated: found.length > MAX_LISTED
		};
	}
	const root = path.resolve(workspaceRoot);
	const listed: string[] = [];
	let total = 0;
	for (const [uri, diags] of vscode.languages.getDiagnostics()) {
		const rel = path.relative(root, uri.fsPath);
		if (uri.scheme !== 'file' || rel.startsWith('..') || path.isAbsolute(rel)) {
			continue;
		}
		for (const d of diags.filter(keep)) {
			total++;
			if (listed.length < MAX_LISTED) {
				listed.push(describe(d, rel.replace(/\\/g, '/')));
			}
		}
	}
	return {
		success: true,
		data: {
			problems: listed,
			total,
			note: 'Only files the editor has checked are listed (open files, and whole projects for languages such as TypeScript). Pass path to check one file.'
		},
		truncated: total > listed.length
	};
}
