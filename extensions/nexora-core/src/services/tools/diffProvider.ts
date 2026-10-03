/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getAgentFlag, shouldConfirmFileEdits } from '../agentRunMode';

export const NEXORA_DIFF_SCHEME = 'nexora-diff';

let diffSeq = 0;

/**
 * In-memory proposed (and empty original) content for vscode.diff previews.
 */
export class NexoraDiffContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
	private readonly contents = new Map<string, string>();
	private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this._onDidChange.event;

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contents.get(uri.toString()) ?? '';
	}

	setContent(uri: vscode.Uri, content: string): void {
		this.contents.set(uri.toString(), content);
		this._onDidChange.fire(uri);
	}

	clear(uri: vscode.Uri): void {
		this.contents.delete(uri.toString());
	}

	dispose(): void {
		this.contents.clear();
		this._onDidChange.dispose();
	}
}

export const nexoraDiffProvider = new NexoraDiffContentProvider();

function toDiffPath(filePath: string): string {
	const posix = filePath.replace(/\\/g, '/');
	return posix.startsWith('/') ? posix : `/${posix}`;
}

function makeDiffUri(filePath: string, side: 'original' | 'proposed'): vscode.Uri {
	diffSeq += 1;
	return vscode.Uri.from({
		scheme: NEXORA_DIFF_SCHEME,
		path: toDiffPath(filePath),
		query: `side=${side}&n=${diffSeq}`
	});
}

async function closeDiffEditors(originalUri: vscode.Uri, proposedUri: vscode.Uri): Promise<void> {
	const toClose: vscode.Tab[] = [];
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			if (!(tab.input instanceof vscode.TabInputTextDiff)) {
				continue;
			}
			const input = tab.input;
			if (
				input.original.toString() === originalUri.toString() &&
				input.modified.toString() === proposedUri.toString()
			) {
				toClose.push(tab);
			}
		}
	}
	if (toClose.length > 0) {
		await vscode.window.tabGroups.close(toClose);
	}
}

/**
 * Open a vscode.diff tab for the proposed file content, then wait for Accept or Reject.
 * Non-modal so the diff stays visible. Returns true only when the user clicks Accept.
 */
export async function previewDiffAndConfirm(options: {
	filePath: string;
	fullPath: string;
	proposedContent: string;
	existsOnDisk: boolean;
}): Promise<boolean> {
	const proposedUri = makeDiffUri(options.filePath, 'proposed');
	nexoraDiffProvider.setContent(proposedUri, options.proposedContent);

	let originalUri: vscode.Uri;
	let ownsOriginal = false;
	if (options.existsOnDisk) {
		originalUri = vscode.Uri.file(options.fullPath);
	} else {
		originalUri = makeDiffUri(options.filePath, 'original');
		nexoraDiffProvider.setContent(originalUri, '');
		ownsOriginal = true;
	}

	try {
		const title = `Nexora: ${options.filePath} (Accept / Reject)`;
		await vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, title);

		const choice = await vscode.window.showInformationMessage(
			`Apply changes to ${options.filePath}?`,
			'Accept',
			'Reject'
		);
		return choice === 'Accept';
	} finally {
		await closeDiffEditors(originalUri, proposedUri);
		nexoraDiffProvider.clear(proposedUri);
		if (ownsOriginal) {
			nexoraDiffProvider.clear(originalUri);
		}
	}
}

/** Non-blocking diff tab. Does not wait for Accept/Reject. */
export function previewInlineDiff(filePath: string, originalContent: string, proposedContent: string): void {
	const originalUri = makeDiffUri(filePath, 'original');
	const proposedUri = makeDiffUri(filePath, 'proposed');
	nexoraDiffProvider.setContent(originalUri, originalContent);
	nexoraDiffProvider.setContent(proposedUri, proposedContent);
	void vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, `Nexora: ${filePath}`);
}

/** Ask mode: blocking Accept/Reject. Auto-edit: optional inline preview, never waits. */
export async function confirmOrPreviewDiff(options: {
	filePath: string;
	fullPath: string;
	proposedContent: string;
	existsOnDisk: boolean;
	originalContent: string;
	requireConfirmation: boolean;
}): Promise<boolean> {
	const askToApply = options.requireConfirmation && shouldConfirmFileEdits();
	if (askToApply) {
		return previewDiffAndConfirm({
			filePath: options.filePath,
			fullPath: options.fullPath,
			proposedContent: options.proposedContent,
			existsOnDisk: options.existsOnDisk
		});
	}
	if (options.requireConfirmation && getAgentFlag('inlineDiffs')) {
		previewInlineDiff(options.filePath, options.originalContent, options.proposedContent);
	}
	return true;
}
