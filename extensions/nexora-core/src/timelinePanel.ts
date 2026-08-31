/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getTimelineWebviewHtml } from './webview/timeline';
import { getBackendClient } from './services/backendClient';
import type { TimelineEntry } from './services/backend/memory';

export class TimelinePanelProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexora.timeline';

	private _view?: vscode.WebviewView;
	private _workspaceId?: string;
	private _snapshots: TimelineEntry[] = [];

	constructor(private readonly _extensionUri: vscode.Uri) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;

		const webviewOpts: vscode.WebviewOptions & { retainContextWhenHidden?: boolean } = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
			retainContextWhenHidden: true
		};
		webviewView.webview.options = webviewOpts;
		webviewView.webview.html = getTimelineWebviewHtml(webviewView.webview, this._extensionUri);

		const disposables: vscode.Disposable[] = [
			webviewView.webview.onDidReceiveMessage(async (msg) => {
				if (msg.type === 'ready' || msg.type === 'refresh') {
					await this._pushState();
				} else if (msg.type === 'selectSnapshot') {
					await this._pushDetail(String(msg.id || ''));
				}
			}),
			webviewView.onDidChangeVisibility(() => {
				if (webviewView.visible) {
					void this._pushState();
				}
			})
		];

		webviewView.onDidDispose(() => {
			for (const disposable of disposables) {
				disposable.dispose();
			}
			this._view = undefined;
		});
	}

	public async refresh(): Promise<void> {
		await this._pushState();
	}

	private async _resolveWorkspaceId(): Promise<string | undefined> {
		const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspacePath) {
			return undefined;
		}
		try {
			const mapped = await getBackendClient().getWorkspaceIdForPath(workspacePath);
			return mapped?.workspace_id;
		} catch {
			return undefined;
		}
	}

	private async _pushState(): Promise<void> {
		if (!this._view) {
			return;
		}
		try {
			this._workspaceId = await this._resolveWorkspaceId();
			if (!this._workspaceId) {
				this._snapshots = [];
				this._view.webview.postMessage({
					type: 'updateData',
					data: { available: true, workspaceId: '', snapshots: [] }
				});
				return;
			}
			const listed = await getBackendClient().getTimeline(this._workspaceId);
			this._snapshots = listed.snapshots || [];
			this._view.webview.postMessage({
				type: 'updateData',
				data: {
					available: true,
					workspaceId: this._workspaceId,
					snapshots: this._snapshots
				}
			});
		} catch (error) {
			this._snapshots = [];
			this._view.webview.postMessage({
				type: 'updateData',
				data: {
					available: false,
					error: error instanceof Error ? error.message : String(error),
					workspaceId: this._workspaceId || '',
					snapshots: []
				}
			});
		}
	}

	private async _pushDetail(snapshotId: string): Promise<void> {
		if (!this._view || !snapshotId) {
			return;
		}
		try {
			const detail = await getBackendClient().getTimelineSnapshot(snapshotId, this._workspaceId);
			const newest = this._snapshots.find(s => s.is_newest) || this._snapshots[0];
			let diff = undefined;
			if (newest && newest.id !== snapshotId) {
				diff = await getBackendClient().getTimelineDiff(snapshotId, newest.id, this._workspaceId);
			}
			this._view.webview.postMessage({
				type: 'updateDetail',
				detail: { ...detail, diff }
			});
		} catch (error) {
			this._view.webview.postMessage({
				type: 'updateDetail',
				detail: {
					id: snapshotId,
					summary: error instanceof Error ? error.message : String(error),
					events: [],
					files: []
				}
			});
		}
	}
}
