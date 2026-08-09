/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Centralized toast / progress notifications for Week 12.
 * Wraps VS Code window notification APIs for consistent UX across panels.
 */
export class NotificationService {
	showInfo(message: string, ...actions: string[]): Thenable<string | undefined> {
		return vscode.window.showInformationMessage(message, ...actions);
	}

	showSuccess(message: string, ...actions: string[]): Thenable<string | undefined> {
		return vscode.window.showInformationMessage(`✓ ${message}`, ...actions);
	}

	showWarning(message: string, ...actions: string[]): Thenable<string | undefined> {
		return vscode.window.showWarningMessage(message, ...actions);
	}

	showError(message: string, ...actions: string[]): Thenable<string | undefined> {
		return vscode.window.showErrorMessage(message, ...actions);
	}

	async showProgress<T>(
		title: string,
		task: (
			progress: vscode.Progress<{ message?: string; increment?: number }>,
			token: vscode.CancellationToken
		) => Thenable<T>,
		cancellable: boolean = false
	): Promise<T> {
		return vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title,
				cancellable
			},
			task
		);
	}

	/** Handle common orchestration WebSocket events. */
	handleOrchestrationEvent(message: {
		type: string;
		task_name?: string;
		task_id?: string;
		plan_id?: string;
		status?: string;
		error?: string;
		result?: unknown;
	}): void {
		switch (message.type) {
			case 'task_success':
				void this.showSuccess(`Task completed: ${message.task_name || message.task_id}`);
				break;
			case 'task_failed':
				void this.showError(
					`Task failed: ${message.task_name || message.task_id}${message.error ? ` - ${message.error}` : ''}`
				);
				break;
			case 'plan_completed': {
				const status = message.status || 'completed';
				if (status === 'failed' || status === 'cancelled') {
					void this.showWarning(`Workflow ${status}${message.plan_id ? ` (${message.plan_id})` : ''}`);
				} else {
					void this.showSuccess(
						`Workflow completed${message.plan_id ? ` (${message.plan_id})` : ''}`,
						'View Output'
					).then(action => {
						if (action === 'View Output') {
							void vscode.commands.executeCommand('nexora.openOutput');
						}
					});
				}
				break;
			}
			default:
				break;
		}
	}
}

let _instance: NotificationService | undefined;

export function getNotificationService(): NotificationService {
	if (!_instance) {
		_instance = new NotificationService();
	}
	return _instance;
}
