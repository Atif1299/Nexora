/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import type { ToolResult } from './executor';
import { previewDiffAndConfirm } from './diffProvider';

const SKIP_PATTERNS = ['.env', '.pem', 'credentials', 'secret', '.key', 'node_modules', '.git'];

function isPathSafe(workspaceRoot: string, filePath: string): boolean {
	const resolved = path.resolve(workspaceRoot, filePath);
	const normalizedRoot = path.resolve(workspaceRoot);

	if (process.platform === 'win32') {
		return resolved.toLowerCase().startsWith(normalizedRoot.toLowerCase() + path.sep) ||
			resolved.toLowerCase() === normalizedRoot.toLowerCase();
	}
	return resolved.startsWith(normalizedRoot + path.sep) || resolved === normalizedRoot;
}

function isSensitivePath(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	return SKIP_PATTERNS.some(p => lower.includes(p));
}

/**
 * Apply a patch (find/replace) to a file.
 * Shows confirmation with diff preview before applying.
 */
export async function applyPatchTool(
	workspaceRoot: string,
	filePath: string,
	oldText: string,
	newText: string,
	requireConfirmation: boolean = true
): Promise<ToolResult> {
	// Validate path
	if (!isPathSafe(workspaceRoot, filePath)) {
		return {
			success: false,
			error: `Path '${filePath}' is outside workspace root`
		};
	}

	if (isSensitivePath(filePath)) {
		return {
			success: false,
			error: `Cannot patch sensitive file: ${filePath}`
		};
	}

	const fullPath = path.resolve(workspaceRoot, filePath);

	try {
		// Read current content
		const content = await fs.readFile(fullPath, 'utf8');

		// Check if old text exists
		if (!content.includes(oldText)) {
			return {
				success: false,
				error: `Could not find the text to replace in ${filePath}. The file may have changed.`
			};
		}

		// Check for unique match
		const occurrences = content.split(oldText).length - 1;
		if (occurrences > 1) {
			return {
				success: false,
				error: `Found ${occurrences} occurrences of the text. Patch must match exactly once. Add more context.`
			};
		}

		// Build new content
		const newContent = content.replace(oldText, newText);

		const autoApply = vscode.workspace.getConfiguration('nexora').get<boolean>('agent.autoApply', false);

		if (requireConfirmation && !autoApply) {
			const accepted = await previewDiffAndConfirm({
				filePath,
				fullPath,
				proposedContent: newContent,
				existsOnDisk: true
			});
			if (!accepted) {
				return {
					success: false,
					error: 'User rejected'
				};
			}
		}

		// Write patched content
		await fs.writeFile(fullPath, newContent, 'utf8');

		if (requireConfirmation && autoApply) {
			void vscode.window.showInformationMessage(`Applied edit to ${filePath}`);
		}

		return {
			success: true,
			data: {
				path: filePath,
				action: 'patched',
				replacements: 1
			}
		};
	} catch (err: any) {
		if (err.code === 'ENOENT') {
			return {
				success: false,
				error: `File not found: ${filePath}`
			};
		}
		return {
			success: false,
			error: err.message || String(err)
		};
	}
}

/**
 * Insert lines at a specific position in a file.
 */
export async function insertLinesTool(
	workspaceRoot: string,
	filePath: string,
	lineNumber: number,
	lines: string,
	requireConfirmation: boolean = true
): Promise<ToolResult> {
	if (!isPathSafe(workspaceRoot, filePath)) {
		return {
			success: false,
			error: `Path '${filePath}' is outside workspace root`
		};
	}

	if (isSensitivePath(filePath)) {
		return {
			success: false,
			error: `Cannot modify sensitive file: ${filePath}`
		};
	}

	const fullPath = path.resolve(workspaceRoot, filePath);

	try {
		const content = await fs.readFile(fullPath, 'utf8');
		const contentLines = content.split('\n');

		// Validate line number
		const insertAt = Math.max(0, Math.min(lineNumber - 1, contentLines.length));

		const newLines = lines.split('\n');
		contentLines.splice(insertAt, 0, ...newLines);
		const newContent = contentLines.join('\n');

		const autoApply = vscode.workspace.getConfiguration('nexora').get<boolean>('agent.autoApply', false);

		if (requireConfirmation && !autoApply) {
			const accepted = await previewDiffAndConfirm({
				filePath,
				fullPath,
				proposedContent: newContent,
				existsOnDisk: true
			});
			if (!accepted) {
				return {
					success: false,
					error: 'User rejected'
				};
			}
		}

		await fs.writeFile(fullPath, newContent, 'utf8');

		if (requireConfirmation && autoApply) {
			void vscode.window.showInformationMessage(`Applied edit to ${filePath}`);
		}

		return {
			success: true,
			data: {
				path: filePath,
				action: 'inserted',
				at_line: lineNumber,
				lines_added: newLines.length
			}
		};
	} catch (err: any) {
		if (err.code === 'ENOENT') {
			return {
				success: false,
				error: `File not found: ${filePath}`
			};
		}
		return {
			success: false,
			error: err.message || String(err)
		};
	}
}
