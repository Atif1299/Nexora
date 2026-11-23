/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';

function openFileDocument(fullPath: string): vscode.TextDocument | undefined {
	const target = path.resolve(fullPath).toLowerCase();
	return vscode.workspace.textDocuments.find(doc => doc.uri.scheme === 'file' && path.resolve(doc.uri.fsPath).toLowerCase() === target);
}

/** The file as the editor shows it (unsaved typing included), else as on disk. Throws ENOENT like fs. */
export async function readCurrentText(fullPath: string): Promise<string> {
	const doc = openFileDocument(fullPath);
	return doc ? doc.getText() : fs.readFile(fullPath, 'utf8');
}

/**
 * Write a file the way the user would. An open file is changed in the editor,
 * replacing only the part that differs (so the cursor and scroll stay put and
 * unsaved typing is kept), then saved; a closed file is written to disk.
 */
export async function writeContent(fullPath: string, content: string): Promise<void> {
	const doc = openFileDocument(fullPath);
	if (!doc) {
		await fs.mkdir(path.dirname(fullPath), { recursive: true });
		await fs.writeFile(fullPath, content, 'utf8');
		return;
	}
	const current = doc.getText();
	if (current !== content) {
		let start = 0;
		while (start < current.length && start < content.length && current[start] === content[start]) {
			start++;
		}
		let endCurrent = current.length;
		let endNew = content.length;
		while (endCurrent > start && endNew > start && current[endCurrent - 1] === content[endNew - 1]) {
			endCurrent--;
			endNew--;
		}
		// Never split a CRLF pair: the editor has no position between its two characters.
		if (start > 0 && current[start - 1] === '\r') {
			start--;
		}
		if (current[endCurrent] === '\n' && current[endCurrent - 1] === '\r' && endCurrent > start) {
			endCurrent++;
			endNew++;
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, new vscode.Range(doc.positionAt(start), doc.positionAt(endCurrent)), content.slice(start, endNew));
		if (!await vscode.workspace.applyEdit(edit)) {
			throw new Error(`The editor did not accept the edit to ${path.basename(fullPath)}`);
		}
	}
	if (doc.isDirty) {
		await doc.save();
	}
}
