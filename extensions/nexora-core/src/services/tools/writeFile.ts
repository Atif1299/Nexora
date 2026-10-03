/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { getAgentFlag, shouldConfirmFileEdits } from '../agentRunMode';
import type { ToolResult } from './executor';
import { confirmOrPreviewDiff } from './diffProvider';

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

/** Format the written URI. Failures are ignored. */
export async function formatAfterWrite(fullPath: string): Promise<void> {
	if (!getAgentFlag('autoFormat')) {
		return;
	}
	try {
		const uri = vscode.Uri.file(fullPath);
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
		await vscode.commands.executeCommand('editor.action.formatDocument');
		if (doc.isDirty) {
			await doc.save();
		}
	} catch {
		// ignore formatter errors
	}
}

/**
 * Write or create a file in the workspace.
 * Shows a vscode.diff preview with Accept / Reject before writing.
 */
export async function writeFileTool(
	workspaceRoot: string,
	filePath: string,
	content: string,
	requireConfirmation: boolean = true
): Promise<ToolResult> {
	// Validate path is inside workspace
	if (!isPathSafe(workspaceRoot, filePath)) {
		return {
			success: false,
			error: `Path '${filePath}' is outside workspace root`
		};
	}

	// Check for sensitive paths
	if (isSensitivePath(filePath)) {
		return {
			success: false,
			error: `Cannot write to sensitive path: ${filePath}`
		};
	}

	const fullPath = path.resolve(workspaceRoot, filePath);
	const isNewFile = !await fs.access(fullPath).then(() => true).catch(() => false);
	const originalContent = isNewFile ? '' : await fs.readFile(fullPath, 'utf8').catch(() => '');

	const accepted = await confirmOrPreviewDiff({
		filePath,
		fullPath,
		proposedContent: content,
		existsOnDisk: !isNewFile,
		originalContent,
		requireConfirmation
	});
	if (!accepted) {
		return {
			success: false,
			error: 'User rejected'
		};
	}

	try {
		// Ensure parent directory exists
		const dir = path.dirname(fullPath);
		await fs.mkdir(dir, { recursive: true });

		// Write file
		await fs.writeFile(fullPath, content, 'utf8');
		await formatAfterWrite(fullPath);

		if (requireConfirmation && !shouldConfirmFileEdits()) {
			void vscode.window.showInformationMessage(`Applied edit to ${filePath}`);
		}

		return {
			success: true,
			data: {
				path: filePath,
				action: isNewFile ? 'created' : 'overwritten',
				bytes: content.length
			}
		};
	} catch (err: any) {
		return {
			success: false,
			error: err.message || String(err)
		};
	}
}
