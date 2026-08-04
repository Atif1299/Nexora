/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getWorkflowWebviewHtml } from './webview/workflow';

export interface WorkflowTask {
	task_id: string;
	name: string;
	platform: string;
	operation: string;
	dependencies: string[];
	status: string;
	estimated_cost: number;
	actual_cost: number;
	error?: string;
	result?: unknown;
}

export interface WorkflowPlan {
	plan_id: string;
	user_request: string;
	status: string;
	tasks: WorkflowTask[];
	estimated_total_cost: number;
	actual_total_cost: number;
}

export class WorkflowPanelProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexora.workflowViewer';

	private _view?: vscode.WebviewView;
	private _currentPlan: WorkflowPlan | null = null;

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

		webviewView.webview.html = getWorkflowWebviewHtml(
			webviewView.webview,
			this._extensionUri
		);

		webviewView.webview.onDidReceiveMessage(async (data) => {
			switch (data.type) {
				case 'taskClicked':
					vscode.commands.executeCommand('nexora.showTaskOutput', data.taskId);
					break;
				case 'ready':
					if (this._currentPlan) {
						this.updatePlan(this._currentPlan);
					}
					break;
			}
		});

		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible && this._currentPlan) {
				this.updatePlan(this._currentPlan);
			}
		});
	}

	public updatePlan(plan: WorkflowPlan): void {
		this._currentPlan = plan;
		if (this._view) {
			this._view.webview.postMessage({
				type: 'updatePlan',
				plan
			});
		}
	}

	public updateTaskStatus(taskId: string, status: string, result?: unknown, error?: string, cost?: number): void {
		if (this._view) {
			this._view.webview.postMessage({
				type: 'updateTaskStatus',
				taskId,
				status,
				result,
				error,
				cost
			});
		}

		// Also update in-memory plan
		if (this._currentPlan) {
			const task = this._currentPlan.tasks.find(t => t.task_id === taskId);
			if (task) {
				task.status = status;
				if (result !== undefined) {
					task.result = result;
				}
				if (error !== undefined) {
					task.error = error;
				}
				if (cost !== undefined) {
					task.actual_cost = cost;
				}
			}
		}
	}

	public clearPlan(): void {
		this._currentPlan = null;
		if (this._view) {
			this._view.webview.postMessage({
				type: 'clearPlan'
			});
		}
	}

	public getCurrentPlan(): WorkflowPlan | null {
		return this._currentPlan;
	}
}
