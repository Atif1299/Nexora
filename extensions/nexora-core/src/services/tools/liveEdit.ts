/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { closeDiffEditors, makeDiffUri, nexoraDiffProvider } from './diffProvider';
import { readCurrentText } from './documentWrite';
import { matchLineEndings } from './editMatching';
import { readPartialJsonStrings } from './partialJson';
import { isPathSafe, isSensitivePath } from './writeFile';

/** At most this many tab refreshes a second while the model writes. */
const REFRESH_MS = 100;

interface ShownCall {
	index: number;
	name: string;
	json: string;
	filePath?: string;
	original?: string;
	originalUri?: vscode.Uri;
	proposedUri?: vscode.Uri;
	opened: boolean;
}

/**
 * Shows a write_file or apply_patch call in a diff tab while the model is
 * still writing it. The file on disk is not touched here: the real edit runs
 * when the finished call arrives, with the usual approvals and checkpoints.
 * One tab at a time, for the call being written.
 */
export class LiveEditView {
	private call: ShownCall | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private loading = false;

	constructor(private readonly workspaceRoot: string) { }

	push(index: number, name: string, piece: string): void {
		if (!this.call || this.call.index !== index) {
			void this.closeTab();
			this.call = { index, name, json: '', opened: false };
		}
		this.call.json += piece;
		if (!this.timer) {
			this.timer = setTimeout(() => {
				this.timer = undefined;
				void this.refresh();
			}, REFRESH_MS);
		}
	}

	/** The model finished the turn (or it failed): close the live tab. */
	async finish(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		await this.closeTab();
	}

	private async closeTab(): Promise<void> {
		const call = this.call;
		this.call = undefined;
		if (!call || !call.originalUri || !call.proposedUri) {
			return;
		}
		if (call.opened) {
			await closeDiffEditors(call.originalUri, call.proposedUri);
		}
		nexoraDiffProvider.clear(call.originalUri);
		nexoraDiffProvider.clear(call.proposedUri);
	}

	private async refresh(): Promise<void> {
		const call = this.call;
		if (!call || this.loading) {
			return;
		}
		const fields = readPartialJsonStrings(call.json);
		const filePath = fields.path;
		if (!filePath || !filePath.complete || !filePath.value) {
			return;
		}
		if (call.original === undefined) {
			if (!isPathSafe(this.workspaceRoot, filePath.value) || isSensitivePath(filePath.value)) {
				return;
			}
			this.loading = true;
			try {
				call.filePath = filePath.value;
				call.original = await readCurrentText(path.resolve(this.workspaceRoot, filePath.value)).catch(() => '');
			} finally {
				this.loading = false;
			}
			if (this.call !== call) {
				return;
			}
		}

		const view = this.proposed(call, fields);
		if (!view) {
			return;
		}
		if (!call.originalUri || !call.proposedUri) {
			call.originalUri = makeDiffUri(call.filePath!, 'original');
			call.proposedUri = makeDiffUri(call.filePath!, 'proposed');
			nexoraDiffProvider.setContent(call.originalUri, call.original);
		}
		nexoraDiffProvider.setContent(call.proposedUri, view.text);
		if (!call.opened) {
			call.opened = true;
			await vscode.commands.executeCommand(
				'vscode.diff',
				call.originalUri,
				call.proposedUri,
				`Nexora is writing ${call.filePath}`,
				{ preview: true, preserveFocus: true }
			);
			if (this.call !== call) {
				await closeDiffEditors(call.originalUri, call.proposedUri);
				return;
			}
		}
		this.reveal(call.proposedUri, view.line);
	}

	/** The file with the edit written so far, and the line the model is writing. */
	private proposed(call: ShownCall, fields: ReturnType<typeof readPartialJsonStrings>): { text: string; line: number } | undefined {
		const original = call.original ?? '';
		if (call.name === 'write_file') {
			const content = fields.content;
			if (!content) {
				return undefined;
			}
			return { text: content.value, line: lineAt(content.value, content.value.length) };
		}
		const oldText = fields.old_text;
		const newText = fields.new_text;
		if (!oldText || !oldText.complete || !oldText.value || !newText) {
			return undefined;
		}
		const find = matchLineEndings(original, oldText.value);
		const at = original.indexOf(find);
		if (at < 0) {
			return undefined;
		}
		const replacement = matchLineEndings(original, newText.value);
		const text = original.slice(0, at) + replacement + original.slice(at + find.length);
		return { text, line: lineAt(text, at + replacement.length) };
	}

	private reveal(uri: vscode.Uri, line: number): void {
		const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
		if (!editor) {
			return;
		}
		const position = new vscode.Position(line, 0);
		editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	}
}

function lineAt(text: string, offset: number): number {
	let line = 0;
	for (let i = 0; i < offset && i < text.length; i++) {
		if (text.charCodeAt(i) === 10) {
			line += 1;
		}
	}
	return line;
}
