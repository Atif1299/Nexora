/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Constellation: one editor tab holding the workspace as a graph, with the files each
// running plan step reports changing lit up on it.
//
// It owns no state of its own. The graph comes from the engine
// (GET /api/memory/graph), the plan arrives through nexora.updateConstellationPlan,
// the same command the chat panel already uses to feed the task tree and the workflow
// view, and step progress arrives on the orchestration websocket the chat panel
// subscribes to. Nothing here has to be kept in step with the executor by hand.

import * as path from 'path';
import * as vscode from 'vscode';
import { acquireEditorPanel, gateEditorPanel } from './services/editorPage';
import { getBackendClient } from './services/backendClient';
import { getOrchestrationWebSocket, type WebSocketMessage } from './services/websocketClient';
import { getConstellationWebviewHtml } from './webview/constellation';

/** Status changes the executor broadcasts for one task. */
const TASK_EVENTS = new Set([
	'task_pending', 'task_queued', 'task_running', 'task_success',
	'task_failed', 'task_cancelled', 'task_skipped', 'task_timeout'
]);

export class ConstellationPanelProvider {
	public static readonly viewType = 'nexora.constellation';

	private _panel?: vscode.WebviewPanel;
	private _attached = false;
	private _plan: unknown;
	private _wsUnsubscribe?: () => void;
	private _disposables: vscode.Disposable[] = [];
	private _reloadTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly _extensionUri: vscode.Uri) { }

	public async open(): Promise<void> {
		const panel = acquireEditorPanel({
			viewType: ConstellationPanelProvider.viewType,
			title: 'Nexora Constellation',
			extensionUri: this._extensionUri,
			icon: 'constellation.svg'
		});
		if (this._panel === panel) {
			if (this._attached) {
				panel.reveal(vscode.ViewColumn.Active);
			}
			return;
		}
		this._panel = panel;
		this._attached = false;
		panel.onDidDispose(() => {
			if (this._panel !== panel) {
				return;
			}
			this._panel = undefined;
			this._attached = false;
			this._teardown();
		});
		gateEditorPanel(panel, (ready) => this._attach(ready));
	}

	/** The plan the chat panel is showing. Sent on to the page, and kept for a later open. */
	public setPlan(plan: unknown): void {
		this._plan = plan;
		this._post({ type: 'plan', plan });
	}

	public dispose(): void {
		this._teardown();
		this._panel?.dispose();
		this._panel = undefined;
	}

	private _teardown(): void {
		if (this._reloadTimer) {
			clearTimeout(this._reloadTimer);
			this._reloadTimer = undefined;
		}
		this._wsUnsubscribe?.();
		this._wsUnsubscribe = undefined;
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
		this._disposables = [];
	}

	private _attach(panel: vscode.WebviewPanel): void {
		this._attached = true;
		panel.webview.html = getConstellationWebviewHtml(
			panel.webview,
			this._extensionUri,
			this._workspaceLabel()
		);
		this._disposables.push(
			panel.webview.onDidReceiveMessage((message: { type?: string; path?: string }) => {
				void this._onMessage(message);
			})
		);
		this._listenForTaskEvents();
	}

	private async _onMessage(message: { type?: string; path?: string }): Promise<void> {
		if (message?.type === 'ready') {
			if (this._plan) {
				this._post({ type: 'plan', plan: this._plan });
			}
			await this._loadGraph();
		} else if (message?.type === 'refresh') {
			await this._loadGraph();
		} else if (message?.type === 'openFile' && typeof message.path === 'string') {
			await this._openFile(message.path);
		}
	}

	private _workspaceFolder(): vscode.WorkspaceFolder | undefined {
		return vscode.workspace.workspaceFolders?.[0];
	}

	private _workspaceLabel(): string {
		const folder = this._workspaceFolder();
		return folder ? folder.name : 'No folder open';
	}

	private async _loadGraph(options: { quiet?: boolean } = {}): Promise<void> {
		const folder = this._workspaceFolder();
		if (!folder) {
			this._post({ type: 'error', text: 'Open a folder to see its constellation.' });
			return;
		}
		if (!options.quiet) {
			this._post({ type: 'loading', text: 'Reading the workspace...' });
		}
		try {
			const graph = await getBackendClient().getCodeGraph(folder.uri.fsPath);
			if (!graph?.nodes?.length) {
				// An empty folder is not a failure, and a blank canvas looks like one.
				this._post({
					type: 'error',
					text: `${folder.name} has no files Nexora can read yet. Build something and the graph draws itself.`
				});
				this._post({ type: 'graph', graph: { nodes: [], folders: [], edges: [], counts: { files: 0, folders: 0, edges: 0 } }, keepOverlay: true });
				return;
			}
			this._post({ type: 'graph', graph });
			if (graph?.truncated) {
				void vscode.window.showInformationMessage(
					`This workspace is larger than the constellation draws at once, so it shows the first ${graph.counts?.files ?? 0} files.`
				);
			}
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this._post({ type: 'error', text: `The workspace graph could not be built. ${reason}` });
		}
	}

	private async _openFile(relative: string): Promise<void> {
		const folder = this._workspaceFolder();
		if (!folder) {
			return;
		}
		// The page only ever sends ids the engine put in the graph, which are workspace
		// relative; joining and then checking keeps a crafted one inside the folder.
		const target = vscode.Uri.file(path.resolve(folder.uri.fsPath, relative));
		const root = path.resolve(folder.uri.fsPath);
		if (target.fsPath !== root && !target.fsPath.startsWith(root + path.sep)) {
			return;
		}
		try {
			const document = await vscode.workspace.openTextDocument(target);
			await vscode.window.showTextDocument(document, { preview: true, viewColumn: vscode.ViewColumn.Beside });
		} catch {
			void vscode.window.showWarningMessage(`Could not open ${relative}.`);
		}
	}

	private _listenForTaskEvents(): void {
		if (this._wsUnsubscribe) {
			return;
		}
		const client = getOrchestrationWebSocket('default');
		this._wsUnsubscribe = client.onMessage((message: WebSocketMessage) => {
			if (!message?.type) {
				return;
			}
			if (TASK_EVENTS.has(message.type)) {
				this._post({ type: 'taskUpdate', update: message });
			}
			// A step that finished has usually written files, and the graph was read
			// before they existed. Re-read it so new files appear on the map instead of
			// waiting for someone to press Refresh.
			if (message.type === 'task_success' || message.type === 'plan_completed') {
				this._scheduleReload();
			}
		});
	}

	/** Several steps finish together; read the workspace once after they settle. */
	private _scheduleReload(): void {
		if (this._reloadTimer) {
			clearTimeout(this._reloadTimer);
		}
		this._reloadTimer = setTimeout(() => {
			this._reloadTimer = undefined;
			void this._loadGraph({ quiet: true });
		}, 1500);
	}

	private _post(message: Record<string, unknown>): void {
		if (this._panel && this._attached) {
			void this._panel.webview.postMessage(message);
		}
	}
}
