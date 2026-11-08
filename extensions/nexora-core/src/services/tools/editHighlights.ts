/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { getAgentFlag } from '../agentRunMode';
import { diffLines, type LineChange } from './lineDiff';
import { readCurrentText, writeContent } from './documentWrite';

const KEEP_COMMAND = 'nexora.agentEdits.keep';
const UNDO_COMMAND = 'nexora.agentEdits.undo';
const REFRESH_MS = 150;

interface EditedFile {
	uri: vscode.Uri;
	/** The file before the agent's first edit since the marks were last cleared. */
	original: string;
	existed: boolean;
	changes: LineChange[];
}

/**
 * Marks what the agent changed in each file: added lines in green, a red
 * line where lines were removed (hover shows them), and Keep / Undo above
 * the first change. The marks are worked out again from the text whenever
 * the file changes, so they follow the user's typing. They go on Keep, Undo,
 * or when the next message starts.
 */
class AgentEditHighlights implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly files = new Map<string, EditedFile>();
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly lensesChanged = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.lensesChanged.event;

	private readonly added = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
		borderColor: new vscode.ThemeColor('editorGutter.addedBackground'),
		borderStyle: 'solid',
		borderWidth: '0 0 0 3px',
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Left
	});

	private readonly removed = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderColor: new vscode.ThemeColor('editorGutter.deletedBackground'),
		borderStyle: 'solid',
		borderWidth: '2px 0 0 0',
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Left
	});

	register(context: vscode.ExtensionContext): void {
		context.subscriptions.push(
			this,
			vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this),
			vscode.commands.registerCommand(KEEP_COMMAND, (uri: vscode.Uri) => this.keep(uri)),
			vscode.commands.registerCommand(UNDO_COMMAND, (uri: vscode.Uri) => this.undo(uri)),
			vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(e => this.paint(e))),
			vscode.workspace.onDidChangeTextDocument(e => this.scheduleRefresh(e.document.uri))
		);
	}

	/**
	 * Call after the agent wrote a file. `before` is the text it had before
	 * this write ('' for a new file). Opens the file and shows the first change.
	 */
	async recordEdit(fullPath: string, before: string, existed: boolean): Promise<void> {
		if (!getAgentFlag('inlineDiffs')) {
			return;
		}
		const uri = vscode.Uri.file(fullPath);
		const key = keyOf(uri);
		if (!this.files.has(key)) {
			this.files.set(key, { uri, original: before, existed, changes: [] });
		}
		await this.refresh(key);
		const file = this.files.get(key);
		if (!file) {
			return;
		}
		try {
			const editor = await vscode.window.showTextDocument(uri, { preview: true, preserveFocus: true });
			const first = file.changes[0];
			if (first) {
				const line = Math.min(first.start, editor.document.lineCount - 1);
				editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			}
		} catch {
			// A file the editor cannot show (binary, too large) keeps its marks for later.
		}
	}

	/** The next message starts: the edits so far count as seen. */
	clearAll(): void {
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		this.files.clear();
		vscode.window.visibleTextEditors.forEach(e => this.paint(e));
		this.lensesChanged.fire();
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const file = this.files.get(keyOf(document.uri));
		if (!file || file.changes.length === 0) {
			return [];
		}
		const line = Math.min(file.changes[0].start, Math.max(0, document.lineCount - 1));
		const range = new vscode.Range(line, 0, line, 0);
		const lines = file.changes.reduce((sum, c) => sum + c.added + c.removed.length, 0);
		return [
			new vscode.CodeLens(range, { title: `$(check) Keep`, command: KEEP_COMMAND, arguments: [document.uri], tooltip: 'Keep the agent\'s changes to this file' }),
			new vscode.CodeLens(range, { title: `$(discard) Undo`, command: UNDO_COMMAND, arguments: [document.uri], tooltip: 'Put this file back as it was before the agent changed it' }),
			new vscode.CodeLens(range, { title: `Nexora changed ${lines} line${lines === 1 ? '' : 's'}`, command: '' })
		];
	}

	dispose(): void {
		this.clearAll();
		this.added.dispose();
		this.removed.dispose();
		this.lensesChanged.dispose();
	}

	private keep(uri: vscode.Uri): void {
		this.forget(keyOf(uri));
	}

	private async undo(uri: vscode.Uri): Promise<void> {
		const key = keyOf(uri);
		const file = this.files.get(key);
		if (!file) {
			return;
		}
		this.forget(key);
		try {
			if (file.existed) {
				await writeContent(uri.fsPath, file.original);
			} else {
				const edit = new vscode.WorkspaceEdit();
				edit.deleteFile(uri, { ignoreIfNotExists: true });
				await vscode.workspace.applyEdit(edit);
			}
		} catch (err) {
			void vscode.window.showErrorMessage(`Could not undo the changes to ${path.basename(uri.fsPath)}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private forget(key: string): void {
		const timer = this.timers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(key);
		}
		const file = this.files.get(key);
		this.files.delete(key);
		if (file) {
			vscode.window.visibleTextEditors.filter(e => keyOf(e.document.uri) === key).forEach(e => this.paint(e));
		}
		this.lensesChanged.fire();
	}

	private scheduleRefresh(uri: vscode.Uri): void {
		const key = keyOf(uri);
		if (!this.files.has(key) || this.timers.has(key)) {
			return;
		}
		this.timers.set(key, setTimeout(() => {
			this.timers.delete(key);
			void this.refresh(key);
		}, REFRESH_MS));
	}

	private async refresh(key: string): Promise<void> {
		const file = this.files.get(key);
		if (!file) {
			return;
		}
		const now = await readCurrentText(file.uri.fsPath).catch(() => undefined);
		if (now === undefined) {
			this.forget(key);
			return;
		}
		file.changes = diffLines(file.original, now);
		if (file.changes.length === 0) {
			this.forget(key);
			return;
		}
		vscode.window.visibleTextEditors.filter(e => keyOf(e.document.uri) === key).forEach(e => this.paint(e));
		this.lensesChanged.fire();
	}

	private paint(editor: vscode.TextEditor): void {
		if (editor.document.uri.scheme !== 'file') {
			return;
		}
		const file = this.files.get(keyOf(editor.document.uri));
		const added: vscode.DecorationOptions[] = [];
		const removed: vscode.DecorationOptions[] = [];
		const lastLine = Math.max(0, editor.document.lineCount - 1);
		for (const change of file?.changes ?? []) {
			const hover = change.removed.length > 0 ? removedHover(change.removed) : undefined;
			if (change.added > 0) {
				const end = Math.min(change.start + change.added - 1, lastLine);
				added.push({ range: new vscode.Range(change.start, 0, end, 0), hoverMessage: hover });
			} else {
				const line = Math.min(change.start, lastLine);
				removed.push({ range: new vscode.Range(line, 0, line, 0), hoverMessage: hover });
			}
		}
		editor.setDecorations(this.added, added);
		editor.setDecorations(this.removed, removed);
	}
}

function keyOf(uri: vscode.Uri): string {
	return path.resolve(uri.fsPath).toLowerCase();
}

function removedHover(lines: string[]): vscode.MarkdownString {
	const shown = lines.slice(0, 30);
	const more = lines.length > shown.length ? `\n\n...and ${lines.length - shown.length} more lines` : '';
	const md = new vscode.MarkdownString(`**Removed by Nexora**\n\n`);
	md.appendCodeblock(shown.join('\n'));
	md.appendMarkdown(more);
	return md;
}

export const agentEditHighlights = new AgentEditHighlights();
