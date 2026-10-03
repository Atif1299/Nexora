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
	private _attached = false;
	private _workspaceId?: string;
	private _snapshots: TimelineEntry[] = [];
	private _disposables: vscode.Disposable[] = [];

	constructor(private readonly _extensionUri: vscode.Uri) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;
		this._attach(webviewView);
	}

	public async open(): Promise<void> {
		await vscode.commands.executeCommand(`${TimelinePanelProvider.viewType}.focus`);
		if (this._attached) {
			void this._pushState();
		}
	}

	public async refresh(): Promise<void> {
		await this._pushState();
	}

	private _attach(view: vscode.WebviewView): void {
		if (this._attached && this._view === view) {
			void this._pushState();
			return;
		}
		this._disposeBindings();
		this._attached = true;
		this._view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};
		view.webview.html = getTimelineWebviewHtml(view.webview, this._extensionUri);

		this._disposables = [
			view.webview.onDidReceiveMessage(async (msg) => {
				if (msg.type === 'ready' || msg.type === 'refresh') {
					await this._pushState();
				} else if (msg.type === 'selectSnapshot') {
					await this._pushDetail(String(msg.id || ''));
				}
			}),
			view.onDidChangeVisibility(() => {
				if (view.visible) {
					void this._pushState();
				}
			}),
			view.onDidDispose(() => {
				this._disposeBindings();
				this._view = undefined;
				this._attached = false;
			})
		];
	}

	private _disposeBindings(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
		this._disposables = [];
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
		if (!this._view || !this._attached) {
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
		if (!this._view || !this._attached || !snapshotId) {
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
