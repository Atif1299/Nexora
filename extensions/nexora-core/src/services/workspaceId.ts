/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Match backend `app.memory.indexer.get_workspace_id` so every panel reads the
 * same `NEXORA_HOME/projects/<workspace_id>/` directory. Chat writes the
 * transcript there; Settings lists the facts from there. If these two ever
 * disagree, project memory silently splits in two.
 */
export function deriveWorkspaceId(workspacePath: string): string {
	const pathHash = crypto.createHash('md5').update(workspacePath, 'utf8').digest('hex').slice(0, 8);
	const base = path.basename(workspacePath).replace(/ /g, '_').toLowerCase();
	const name = Array.from(base).filter((c) => /[a-z0-9_]/.test(c)).join('');
	return `${name}_${pathHash}`;
}

/** Workspace id for the open folder, or undefined when no folder is open. */
export function currentWorkspaceId(): string | undefined {
	const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	return workspacePath ? deriveWorkspaceId(workspacePath) : undefined;
}
