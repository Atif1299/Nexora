/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatPanelProvider } from './chatPanel';
import { PlatformBrowserProvider } from './platformPanel';
import { TaskTreeProvider } from './taskTreeProvider';
import { WorkflowPanelProvider } from './workflowPanel';
import { OutputPanelProvider, type TaskOutput } from './outputPanel';
import { getBackendClient } from './services/backendClient';
import { getOrchestrationWebSocket, disposeWebSocket, type WebSocketMessage } from './services/websocketClient';

export function activate(context: vscode.ExtensionContext) {
	console.log('Nexora Core extension is now active!');

	// Initialize WebSocket connection for real-time updates
	const wsClient = getOrchestrationWebSocket('default');
	wsClient.connect().then(connected => {
		if (connected) {
			console.log('[Nexora] WebSocket connected for real-time updates');
		} else {
			console.log('[Nexora] WebSocket connection failed - will retry on plan execution');
		}
	});

	const chatProvider = new ChatPanelProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('nexora.chatPanel', chatProvider)
	);

	// Week 11: Workflow Panel (DAG visualization)
	const workflowProvider = new WorkflowPanelProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('nexora.workflowViewer', workflowProvider)
	);

	// Week 11: Output Panel (task results and logs)
	const outputProvider = new OutputPanelProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('nexora.outputViewer', outputProvider)
	);

	const platformProvider = new PlatformBrowserProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('nexora.platformBrowser', platformProvider)
	);

	// Task Tree View (Week 6)
	const taskTreeProvider = new TaskTreeProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('nexora.taskTree', taskTreeProvider)
	);

	// Week 11: Wire WebSocket updates to workflow and output panels
	wsClient.onMessage((message: WebSocketMessage) => {
		// Update workflow panel with task status changes
		if (message.type === 'task_running' || message.type === 'task_success' ||
			message.type === 'task_failed' || message.type === 'task_skipped') {
			const status = message.type.replace('task_', '');
			workflowProvider.updateTaskStatus(
				message.task_id || '',
				status,
				message.result,
				message.error,
				message.cost
			);

			// Update output panel
			const taskOutput: TaskOutput = {
				taskId: message.task_id || '',
				taskName: message.task_name || message.task_id || 'Unknown',
				platform: message.platform || 'unknown',
				operation: message.operation || 'unknown',
				status: status,
				result: message.result,
				error: message.error,
				logs: []
			};
			outputProvider.updateTaskOutput(taskOutput);

			// Add log entry for this status change
			outputProvider.addLog(message.task_id || '', {
				timestamp: new Date().toISOString(),
				level: status === 'failed' ? 'error' : 'info',
				message: `Task ${status}: ${message.task_name || message.task_id}`
			});
		}

		// Handle plan updates for workflow panel
		if (message.type === 'plan_completed') {
			// The workflow panel will reflect completion via task status updates
			console.log(`[Nexora] Plan ${message.plan_id} completed with status: ${message.status}`);
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('nexora.openChat', () => {
			vscode.commands.executeCommand('nexora.chatPanel.focus');
		}),
		vscode.commands.registerCommand('nexora.openTaskPlan', () => {
			vscode.commands.executeCommand('nexora.taskTree.focus');
		}),
		vscode.commands.registerCommand('nexora.openPlatformBrowser', () => {
			vscode.commands.executeCommand('nexora.platformBrowser.focus');
		}),
		vscode.commands.registerCommand('nexora.refreshPlatforms', async () => {
			await platformProvider.refresh();
			const count = platformProvider.getPlatformCount();
			const connected = platformProvider.isBackendConnected();
			if (connected) {
				vscode.window.showInformationMessage(`Platforms refreshed! (${count} platforms from backend)`);
			} else {
				vscode.window.showWarningMessage(`Using cached platforms (${count}). Backend offline.`);
			}
		}),
		vscode.commands.registerCommand('nexora.checkBackend', async () => {
			const client = getBackendClient();
			const isConnected = await client.checkHealth();
			if (isConnected) {
				vscode.window.showInformationMessage('Backend is connected! API docs: http://localhost:8000/docs');
			} else {
				vscode.window.showErrorMessage('Backend is offline. Start it with: uvicorn app.main:app --reload --port 8000');
			}
		}),
		vscode.commands.registerCommand('nexora.decomposeRequest', async () => {
			const request = await vscode.window.showInputBox({
				prompt: 'What do you want to build?',
				placeHolder: 'e.g., Build a blog with user authentication'
			});

			if (request) {
				try {
					const client = getBackendClient();
					const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
					const result = await client.decomposeRequest(request, workspacePath);

					if (result.tasks && result.tasks.length > 0) {
						taskTreeProvider.setDecomposition(result);
						vscode.window.showInformationMessage(
							`Decomposed into ${result.tasks.length} tasks`
						);
					} else if (result.error) {
						vscode.window.showErrorMessage(`Decomposition failed: ${result.error}`);
					} else {
						vscode.window.showWarningMessage('No tasks generated for this request');
					}
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to decompose request: ${error}`);
				}
			}
		}),
		vscode.commands.registerCommand('nexora.clearTasks', () => {
			taskTreeProvider.clear();
			vscode.window.showInformationMessage('Task plan cleared');
		}),
		vscode.commands.registerCommand('nexora.updateTaskTree', (result: any) => {
			if (result && result.tasks && result.tasks.length > 0) {
				taskTreeProvider.setDecomposition(result);
			}
		}),
		vscode.commands.registerCommand('nexora.updateTaskTreeFromPlan', (plan: any) => {
			if (plan && plan.tasks && plan.tasks.length > 0) {
				taskTreeProvider.setPlan(plan);
				vscode.commands.executeCommand('nexora.taskTree.focus');
			}
		}),
		vscode.commands.registerCommand('nexora.updateTaskStatus', (taskId: string, status: string) => {
			taskTreeProvider.updateTaskStatus(taskId, status);
		}),
		// Week 11: Show task output command
		vscode.commands.registerCommand('nexora.showTaskOutput', (taskId: string) => {
			outputProvider.showTaskOutput(taskId);
		}),
		// Week 11: Open workflow viewer
		vscode.commands.registerCommand('nexora.openWorkflow', () => {
			vscode.commands.executeCommand('nexora.workflowViewer.focus');
		}),
		// Week 11: Open output viewer
		vscode.commands.registerCommand('nexora.openOutput', () => {
			vscode.commands.executeCommand('nexora.outputViewer.focus');
		}),
		// Week 11: Update workflow panel from chat panel
		vscode.commands.registerCommand('nexora.updateWorkflowPlan', (plan: any) => {
			if (plan && plan.tasks) {
				workflowProvider.updatePlan(plan);
				// Also clear previous outputs and prepare for new execution
				outputProvider.clearOutputs();
			}
		})
	);

	checkBackendOnStartup();
}

async function checkBackendOnStartup(): Promise<void> {
	const client = getBackendClient();
	const isConnected = await client.checkHealth();

	if (isConnected) {
		vscode.window.showInformationMessage('Nexora: Backend connected');
	} else {
		vscode.window.showWarningMessage('Nexora: Backend offline. Run backend for full functionality.');
	}
}

export function deactivate() {
	console.log('Nexora Core extension deactivated');
	disposeWebSocket();
}
