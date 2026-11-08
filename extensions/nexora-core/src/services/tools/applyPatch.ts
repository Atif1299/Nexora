/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import type { ToolResult } from './executor';
import { confirmOrPreviewDiff } from './diffProvider';
import { formatAfterWrite } from './writeFile';
import { agentCheckpoints } from '../checkpoints';
import { readCurrentText, writeContent } from './documentWrite';
import { agentEditHighlights } from './editHighlights';
import { closestMatch, matchLineEndings, occurrenceLines } from './editMatching';

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
 *
 * The old text must match once, or every match is replaced with replaceAll.
 * Line endings follow the file. When the text is not found, the error shows
 * the closest lines with numbers; with several matches, where they are.
 */
export async function applyPatchTool(
	workspaceRoot: string,
	filePath: string,
	oldText: string,
	newText: string,
	requireConfirmation: boolean = true,
	replaceAll: boolean = false
): Promise<ToolResult> {
	if (typeof oldText !== 'string' || oldText.length === 0) {
		return { success: false, error: 'old_text is empty. Use write_file for a new file, or insert_lines to add lines.' };
	}
	if (typeof newText !== 'string') {
		return { success: false, error: 'new_text is missing.' };
	}
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
		const content = await readCurrentText(fullPath);
		const find = matchLineEndings(content, oldText);
		const replacement = matchLineEndings(content, newText);

		// Check if old text exists
		const at = occurrenceLines(content, find);
		if (at.length === 0) {
			const near = closestMatch(content, oldText);
			return {
				success: false,
				error: near
					? `old_text was not found in ${filePath}. The closest lines are below (line|text); copy them exactly, without the numbers, and try again:\n${near}`
					: `old_text was not found in ${filePath}, and no similar lines were found. Read the file again before editing.`
			};
		}

		// Check for unique match
		if (at.length > 1 && !replaceAll) {
			return {
				success: false,
				error: `old_text matches ${at.length} places in ${filePath} (lines ${at.slice(0, 10).join(', ')}). Add surrounding lines so it matches once, or pass replace_all: true to change every one.`
			};
		}

		// Build new content (a function replacement keeps `$` in the new text literal)
		const newContent = replaceAll ? content.split(find).join(replacement) : content.replace(find, () => replacement);

		const accepted = await confirmOrPreviewDiff({
			filePath,
			fullPath,
			proposedContent: newContent,
			existsOnDisk: true,
			originalContent: content,
			requireConfirmation
		});
		if (!accepted) {
			return {
				success: false,
				error: 'User rejected'
			};
		}

		await agentCheckpoints.recordBeforeWrite(fullPath);
		await writeContent(fullPath, newContent);
		await formatAfterWrite(fullPath);
		await agentEditHighlights.recordEdit(fullPath, content, true);

		return {
			success: true,
			data: {
				path: filePath,
				action: 'patched',
				replacements: replaceAll ? at.length : 1,
				at_lines: replaceAll ? at.slice(0, 20) : at.slice(0, 1)
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
		const content = await readCurrentText(fullPath);
		const contentLines = content.split('\n');

		// Validate line number
		const insertAt = Math.max(0, Math.min(lineNumber - 1, contentLines.length));

		const newLines = lines.split('\n');
		contentLines.splice(insertAt, 0, ...newLines);
		const newContent = contentLines.join('\n');

		const accepted = await confirmOrPreviewDiff({
			filePath,
			fullPath,
			proposedContent: newContent,
			existsOnDisk: true,
			originalContent: content,
			requireConfirmation
		});
		if (!accepted) {
			return {
				success: false,
				error: 'User rejected'
			};
		}

		await agentCheckpoints.recordBeforeWrite(fullPath);
		await writeContent(fullPath, newContent);
		await formatAfterWrite(fullPath);
		await agentEditHighlights.recordEdit(fullPath, content, true);

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
