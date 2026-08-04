/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getOutputWebviewHtml } from './webview/output';

export interface LogEntry {
	timestamp: string;
	level: 'info' | 'warn' | 'error' | 'debug';
	message: string;
}

export interface TaskOutput {
	taskId: string;
	taskName: string;
	platform: string;
	operation: string;
	status: string;
	startedAt?: string;
	completedAt?: string;
	duration?: number;
	result?: unknown;
	error?: string;
	logs: LogEntry[];
}

export class OutputPanelProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexora.outputViewer';

	private _view?: vscode.WebviewView;
	private _taskOutputs: Map<string, TaskOutput> = new Map();
	private _selectedTaskId: string | null = null;

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

		webviewView.webview.html = getOutputWebviewHtml(
			webviewView.webview,
			this._extensionUri
		);

		webviewView.webview.onDidReceiveMessage(async (data) => {
			switch (data.type) {
				case 'selectTask':
					this._selectedTaskId = data.taskId;
					this._updateSelectedTask();
					break;
				case 'copyOutput':
					if (data.content) {
						await vscode.env.clipboard.writeText(data.content);
						vscode.window.showInformationMessage('Output copied to clipboard');
					}
					break;
				case 'ready':
					this._syncState();
					break;
			}
		});

		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this._syncState();
			}
		});
	}

	private _syncState(): void {
		if (!this._view) {
			return;
		}

		this._view.webview.postMessage({
			type: 'updateTaskList',
			tasks: Array.from(this._taskOutputs.values())
		});

		if (this._selectedTaskId) {
			this._updateSelectedTask();
		}
	}

	public showTaskOutput(taskId: string): void {
		this._selectedTaskId = taskId;
		this._updateSelectedTask();

		// Focus the output panel
		vscode.commands.executeCommand('nexora.outputViewer.focus');
	}

	public updateTaskOutput(output: TaskOutput): void {
		this._taskOutputs.set(output.taskId, output);

		if (this._view) {
			this._view.webview.postMessage({
				type: 'updateTaskList',
				tasks: Array.from(this._taskOutputs.values())
			});

			if (this._selectedTaskId === output.taskId) {
				this._updateSelectedTask();
			}
		}
	}

	public addLog(taskId: string, log: LogEntry): void {
		const output = this._taskOutputs.get(taskId);
		if (output) {
			output.logs.push(log);

			if (this._view && this._selectedTaskId === taskId) {
				this._view.webview.postMessage({
					type: 'addLog',
					log
				});
			}
		}
	}

	public clearOutputs(): void {
		this._taskOutputs.clear();
		this._selectedTaskId = null;

		if (this._view) {
			this._view.webview.postMessage({ type: 'clear' });
		}
	}

	private _updateSelectedTask(): void {
		if (!this._view || !this._selectedTaskId) {
			return;
		}

		const output = this._taskOutputs.get(this._selectedTaskId);
		this._view.webview.postMessage({
			type: 'showTaskOutput',
			output
		});
	}

	public getTaskOutput(taskId: string): TaskOutput | undefined {
		return this._taskOutputs.get(taskId);
	}
}
