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
import { SettingsPanelProvider } from './settingsPanel';
import { AnalyticsPanelProvider } from './analyticsPanel';
import { getBackendClient, setApiKeyHeaderProvider } from './services/backendClient';
import { getSettingsService } from './services/settingsService';
import { getNotificationService } from './services/notificationService';
import { getOrchestrationWebSocket, disposeWebSocket, type WebSocketMessage } from './services/websocketClient';

async function setOperationInProgress(value: boolean): Promise<void> {
	await vscode.commands.executeCommand('setContext', 'nexora.operationInProgress', value);
}

async function setChatFocused(value: boolean): Promise<void> {
	await vscode.commands.executeCommand('setContext', 'nexora.chatFocused', value);
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Nexora Core extension is now active!');

	// Initialize settings singleton (SecretStorage + preferences)
	const settingsService = getSettingsService(context);
	// Wire IDE keys into every backend HTTP call (primary runtime credentials)
	setApiKeyHeaderProvider(async () => {
		const headers: Record<string, string> = {};
		const openai = await settingsService.getApiKey('openai');
		const anthropic = await settingsService.getApiKey('anthropic');
		const openrouter = await settingsService.getApiKey('openrouter');
		if (openai) {
			headers['X-Nexora-OpenAI-Key'] = openai;
		}
		if (anthropic) {
			headers['X-Nexora-Anthropic-Key'] = anthropic;
		}
		if (openrouter) {
			headers['X-Nexora-OpenRouter-Key'] = openrouter;
		}
		return headers;
	});
	const notifications = getNotificationService();

	void setOperationInProgress(false);
	void setChatFocused(false);

	// Initialize WebSocket connection for real-time updates
	const wsClient = getOrchestrationWebSocket('default');
	wsClient.connect().then(connected => {
		if (connected) {
			console.log('[Nexora] WebSocket connected for real-time updates');
		} else {
			console.log('[Nexora] WebSocket connection failed - will retry on plan execution');
		}
	});

	const retainHidden = {
		webviewOptions: { retainContextWhenHidden: true }
	};

	const chatProvider = new ChatPanelProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('nexora.chatPanel', chatProvider, retainHidden)
	);

	// Week 11: Workflow / Output live in the bottom panel as horizontal tabs
	const workflowProvider = new WorkflowPanelProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('nexora.workflowViewer', workflowProvider, retainHidden)
	);

	const outputProvider = new OutputPanelProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('nexora.outputViewer', outputProvider, retainHidden)
	);

	const settingsProvider = new SettingsPanelProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SettingsPanelProvider.viewType, settingsProvider, retainHidden)
	);

	const analyticsProvider = new AnalyticsPanelProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(AnalyticsPanelProvider.viewType, analyticsProvider, retainHidden)
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

	// Week 11 + 12: Wire WebSocket updates to panels + notifications + context keys
	wsClient.onMessage((message: WebSocketMessage) => {
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

			const taskOutput: TaskOutput = {
				taskId: message.task_id || '',
				taskName: message.task_name || message.task_id || 'Unknown',
				platform: message.platform || 'unknown',
				operation: message.operation || 'unknown',
				status: status,
				startedAt: message.started_at,
				completedAt: message.completed_at,
				duration: message.duration_ms,
				result: message.result,
				error: message.error,
				logs: []
			};
			outputProvider.updateTaskOutput(taskOutput);

			outputProvider.addLog(message.task_id || '', {
				timestamp: new Date().toISOString(),
				level: status === 'failed' ? 'error' : 'info',
				message: `Task ${status}: ${message.task_name || message.task_id}`
			});

			// Only a running task counts as an in-progress operation. Setting this on
			// terminal events would leave Escape bound to cancel after execution ends.
			if (message.type === 'task_running') {
				void setOperationInProgress(true);
			}
			notifications.handleOrchestrationEvent(message);
		}

		if (message.type === 'plan_completed') {
			console.log(`[Nexora] Plan ${message.plan_id} completed with status: ${message.status}`);
			void setOperationInProgress(false);
			notifications.handleOrchestrationEvent(message);
			void analyticsProvider.refresh();
		}

		if (message.type === 'task_success') {
			void analyticsProvider.refresh();
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('nexora.openChat', async () => {
			await vscode.commands.executeCommand('nexora.chatPanel.focus');
			await setChatFocused(true);
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
				void notifications.showInfo(`Platforms refreshed! (${count} platforms from backend)`);
			} else {
				void notifications.showWarning(`Using cached platforms (${count}). Backend offline.`);
			}
		}),
		vscode.commands.registerCommand('nexora.checkBackend', async () => {
			const client = getBackendClient();
			const isConnected = await client.checkHealth();
			if (isConnected) {
				void notifications.showSuccess('Backend is connected! API docs: http://localhost:8000/docs');
			} else {
				void notifications.showError('Backend is offline. Start it with: uvicorn app.main:app --reload --port 8000');
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
						void notifications.showInfo(`Decomposed into ${result.tasks.length} tasks`);
					} else if (result.error) {
						void notifications.showError(`Decomposition failed: ${result.error}`);
					} else {
						void notifications.showWarning('No tasks generated for this request');
					}
				} catch (error) {
					void notifications.showError(`Failed to decompose request: ${error}`);
				}
			}
		}),
		vscode.commands.registerCommand('nexora.clearTasks', () => {
			taskTreeProvider.clear();
			void notifications.showInfo('Task plan cleared');
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
		vscode.commands.registerCommand('nexora.showTaskOutput', (taskId: string) => {
			outputProvider.showTaskOutput(taskId);
		}),
		vscode.commands.registerCommand('nexora.openNexoraPanel', async () => {
			await vscode.commands.executeCommand('nexora.workflowViewer.focus');
		}),
		vscode.commands.registerCommand('nexora.openWorkflow', async () => {
			await vscode.commands.executeCommand('nexora.workflowViewer.focus');
		}),
		vscode.commands.registerCommand('nexora.openOutput', async () => {
			await vscode.commands.executeCommand('nexora.outputViewer.focus');
		}),
		vscode.commands.registerCommand('nexora.updateWorkflowPlan', (plan: any) => {
			if (plan && plan.tasks) {
				workflowProvider.updatePlan(plan);
				outputProvider.clearOutputs();
				void vscode.commands.executeCommand('nexora.workflowViewer.focus');
			}
		}),
		vscode.commands.registerCommand('nexora.newSession', async () => {
			await chatProvider.createNewSession();
			void notifications.showInfo('New chat session created');
		}),
		vscode.commands.registerCommand('nexora.cancelOperation', async () => {
			if (chatProvider.isOperationInProgress()) {
				await chatProvider.cancelCurrentOperation();
				await setOperationInProgress(false);
				void notifications.showInfo('Operation cancelled');
			} else {
				// Nothing to cancel: clear the context key so Escape returns to VS Code
				await setOperationInProgress(false);
			}
		}),
		// Week 12: Settings + shortcuts
		vscode.commands.registerCommand('nexora.openSettings', async () => {
			await vscode.commands.executeCommand('nexora.settings.focus');
			await settingsProvider.refresh();
		}),
		vscode.commands.registerCommand('nexora.refreshSettings', async () => {
			await settingsProvider.refresh();
			void notifications.showInfo('Settings status refreshed');
		}),
		vscode.commands.registerCommand('nexora.openAnalytics', async () => {
			await vscode.commands.executeCommand('nexora.analytics.focus');
			await analyticsProvider.refresh();
		}),
		vscode.commands.registerCommand('nexora.refreshAnalytics', async () => {
			await analyticsProvider.refresh();
			void notifications.showInfo('Analytics refreshed');
		}),
		vscode.commands.registerCommand('nexora.showKeyboardShortcuts', async () => {
			const lines = [
				'Nexora Keyboard Shortcuts',
				'',
				'Ctrl+K          Open Chat',
				'Ctrl+Shift+K    New Session',
				'Ctrl+Alt+I      Open Chat (legacy)',
				'Ctrl+Alt+,      Open Settings tab',
				'Ctrl+Alt+A      Open Analytics tab',
				'Escape          Cancel operation (when in progress)',
				'Ctrl+Shift+/    Show this help'
			];
			await vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
		}),
		// Internal: chat panel can sync operation context
		vscode.commands.registerCommand('nexora.setOperationInProgress', async (value: boolean) => {
			await setOperationInProgress(!!value);
		})
	);

	checkBackendOnStartup(notifications);
}

async function checkBackendOnStartup(notifications: ReturnType<typeof getNotificationService>): Promise<void> {
	const client = getBackendClient();
	const isConnected = await client.checkHealth();

	if (isConnected) {
		void notifications.showInfo('Nexora: Backend connected');
	} else {
		void notifications.showWarning('Nexora: Backend offline. Run backend for full functionality.');
	}
}

export function deactivate() {
	console.log('Nexora Core extension deactivated');
	disposeWebSocket();
}
