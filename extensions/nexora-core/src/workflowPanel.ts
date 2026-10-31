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

/**
 * A WorkflowPlan from a plan_snapshot, which carries the GET /api/orchestrate/plan
 * response. That response names the plan total actual_cost, not actual_total_cost.
 */
export function workflowPlanFromSnapshot(planId: string, snapshot: unknown): WorkflowPlan | null {
	const raw = snapshot as Record<string, any> | null;
	if (!raw || !Array.isArray(raw.tasks)) {
		return null;
	}
	return {
		plan_id: planId || String(raw.plan_id || ''),
		user_request: String(raw.user_request || ''),
		status: String(raw.status || ''),
		tasks: raw.tasks as WorkflowTask[],
		estimated_total_cost: Number(raw.estimated_total_cost ?? raw.estimated_cost ?? 0),
		actual_total_cost: Number(raw.actual_total_cost ?? raw.actual_cost ?? 0)
	};
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
					this._postCurrentPlan();
					break;
			}
		});

		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible && this._currentPlan) {
				this._postCurrentPlan();
			}
		});

		// If the webview was already shown and a plan arrived earlier, push it once
		// the view handle exists (ready handler will also repost when the script loads).
		if (this._currentPlan) {
			this._postCurrentPlan();
		}
	}

	private _postCurrentPlan(): void {
		if (!this._view || !this._currentPlan) {
			return;
		}
		this._view.webview.postMessage({
			type: 'updatePlan',
			plan: this._currentPlan
		});
	}

	public updatePlan(plan: WorkflowPlan): void {
		this._currentPlan = plan;
		this._postCurrentPlan();
	}

	public updateTaskStatus(taskId: string, status: string, result?: unknown, error?: string, cost?: number): void {
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
