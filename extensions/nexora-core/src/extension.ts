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
import { TemplatesPanelProvider } from './templatesPanel';
import { TimelinePanelProvider } from './timelinePanel';
import { getBackendClient, notifyBackendClientConfigured, setApiKeyHeaderProvider } from './services/backendClient';
import { getSettingsService } from './services/settingsService';
import { getNotificationService } from './services/notificationService';
import { getOrchestrationWebSocket, disposeWebSocket, type WebSocketMessage } from './services/websocketClient';
import {
	startNexoraEngine,
	stopNexoraEngine,
	toWebSocketUrl,
	getEngineState,
	onDidChangeEngineState,
	showEngineOutput,
	type EngineState
} from './services/engineProcess';
import { enginePlaceholderHtml, engineStateLabel } from './services/editorPage';
import { nexoraDiffProvider, NEXORA_DIFF_SCHEME } from './services/tools/diffProvider';
import { openNexoraBrowser } from './services/browser';
import { closeAgentBrowser } from './services/tools/browserSession';

async function setOperationInProgress(value: boolean): Promise<void> {
	await vscode.commands.executeCommand('setContext', 'nexora.operationInProgress', value);
}

async function setChatFocused(value: boolean): Promise<void> {
	await vscode.commands.executeCommand('setContext', 'nexora.chatFocused', value);
}

const NEVER_CANCELLED: vscode.CancellationToken = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() { /* noop */ } })
};

const NEXORA_PANEL_VIEWS = [
	'nexora.workflowViewer',
	'nexora.outputViewer',
	'nexora.taskTree'
] as const;

type NexoraPanelViewId = (typeof NEXORA_PANEL_VIEWS)[number];

async function showOnlyNexoraPanelView(viewId: NexoraPanelViewId): Promise<void> {
	await vscode.commands.executeCommand(`${viewId}.focus`);
	for (const id of NEXORA_PANEL_VIEWS) {
		if (id === viewId) {
			continue;
		}
		try {
			await vscode.commands.executeCommand(`${id}.removeView`);
		} catch {
			// Not visible, or this is the last pane in the container.
		}
	}
}

class EngineGatedWebviewProvider implements vscode.WebviewViewProvider {
	private innerResolved = false;
	private clientConfigured = false;
	private webviewView: vscode.WebviewView | undefined;
	private resolveContext: vscode.WebviewViewResolveContext | undefined;
	private resolveToken: vscode.CancellationToken | undefined;
	private messageHandler: vscode.Disposable | undefined;

	constructor(private readonly inner: vscode.WebviewViewProvider) { }

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken
	): void | Thenable<void> {
		this.webviewView = webviewView;
		this.resolveContext = context;
		this.resolveToken = token;
		if (!this.messageHandler) {
			this.messageHandler = webviewView.webview.onDidReceiveMessage((data: { type?: string }) => {
				if (data?.type === 'showEngineOutput') {
					showEngineOutput();
				}
			});
		}
		if (!this.tryResolveInner()) {
			this.renderPlaceholder(getEngineState());
		}
	}

	onEngineState(state: EngineState): void {
		if (this.tryResolveInner()) {
			return;
		}
		if (!this.innerResolved) {
			this.renderPlaceholder(state);
		}
	}

	notifyClientConfigured(): void {
		this.clientConfigured = true;
		if (!this.tryResolveInner() && this.webviewView && !this.innerResolved) {
			this.renderPlaceholder(getEngineState());
		}
	}

	private tryResolveInner(): boolean {
		if (this.innerResolved || !this.webviewView || !this.resolveContext) {
			return this.innerResolved;
		}
		if (getEngineState() !== 'ready' || !this.clientConfigured) {
			return false;
		}
		this.innerResolved = true;
		void this.inner.resolveWebviewView(
			this.webviewView,
			this.resolveContext,
			this.resolveToken ?? NEVER_CANCELLED
		);
		return true;
	}

	private renderPlaceholder(state: EngineState): void {
		if (!this.webviewView) {
			return;
		}
		this.webviewView.webview.options = { enableScripts: true };
		this.webviewView.webview.html = enginePlaceholderHtml(state);
	}
}

function gateWebview(
	inner: vscode.WebviewViewProvider,
	disposables: vscode.Disposable[],
	gatedProviders: EngineGatedWebviewProvider[]
): EngineGatedWebviewProvider {
	const gated = new EngineGatedWebviewProvider(inner);
	gatedProviders.push(gated);
	disposables.push(onDidChangeEngineState((state) => gated.onEngineState(state)));
	return gated;
}

function updateEngineStatusBar(item: vscode.StatusBarItem, state: EngineState): void {
	item.command = 'nexora.showEngineOutput';
	switch (state) {
		case 'starting':
			item.text = '$(sync~spin) Nexora Engine: starting';
			item.tooltip = 'Nexora engine is starting. Click to open the Nexora Engine output channel.';
			item.backgroundColor = undefined;
			break;
		case 'restarting':
			item.text = '$(sync~spin) Nexora Engine: restarting';
			item.tooltip = 'Nexora engine is restarting. Click to open the Nexora Engine output channel.';
			item.backgroundColor = undefined;
			break;
		case 'ready':
			item.text = '$(check) Nexora Engine: ready';
			item.tooltip = 'Nexora engine is ready. Click to open the Nexora Engine output channel (engine logs).';
			item.backgroundColor = undefined;
			break;
		case 'failed':
			item.text = '$(error) Nexora Engine: failed';
			item.tooltip = 'Nexora engine failed. Click to open the Nexora Engine output channel.';
			item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
			break;
	}
}

function treeMessageForState(state: EngineState): string | undefined {
	if (state === 'ready') {
		return undefined;
	}
	if (state === 'failed') {
		return `${engineStateLabel(state)} Open the Nexora Engine output channel for details.`;
	}
	return engineStateLabel(state);
}

export async function activate(context: vscode.ExtensionContext) {
	console.log('Nexora Core extension is now active!');

	// Initialize settings singleton (SecretStorage + preferences)
	const settingsService = getSettingsService(context);
	// Wire IDE keys into every backend HTTP call (primary runtime credentials)
	setApiKeyHeaderProvider(async () => {
		const headers: Record<string, string> = {};
		const [openai, anthropic, openrouter] = await Promise.all([
			settingsService.getApiKey('openai'),
			settingsService.getApiKey('anthropic'),
			settingsService.getApiKey('openrouter')
		]);
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

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider(NEXORA_DIFF_SCHEME, nexoraDiffProvider),
		nexoraDiffProvider
	);

	const engineStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	engineStatusBar.name = 'Nexora Engine';
	updateEngineStatusBar(engineStatusBar, getEngineState());
	engineStatusBar.show();
	context.subscriptions.push(engineStatusBar);

	const taskTreeProvider = new TaskTreeProvider();
	const taskTree = vscode.window.createTreeView('nexora.taskTree', {
		treeDataProvider: taskTreeProvider
	});
	context.subscriptions.push(taskTree);

	const applyEngineState = (state: EngineState): void => {
		updateEngineStatusBar(engineStatusBar, state);
		void vscode.commands.executeCommand('setContext', 'nexora.engineState', state);
		taskTree.message = treeMessageForState(state);
	};
	applyEngineState(getEngineState());
	context.subscriptions.push(onDidChangeEngineState(applyEngineState));

	const retainHidden = {
		webviewOptions: { retainContextWhenHidden: true }
	};
	const gatedProviders: EngineGatedWebviewProvider[] = [];

	const chatProvider = new ChatPanelProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'nexora.chatPanel',
			gateWebview(chatProvider, context.subscriptions, gatedProviders),
			retainHidden
		)
	);

	// Week 11: Workflow / Output live in the bottom panel as horizontal tabs
	const workflowProvider = new WorkflowPanelProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'nexora.workflowViewer',
			gateWebview(workflowProvider, context.subscriptions, gatedProviders),
			retainHidden
		)
	);

	const outputProvider = new OutputPanelProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'nexora.outputViewer',
			gateWebview(outputProvider, context.subscriptions, gatedProviders),
			retainHidden
		)
	);

	const settingsProvider = new SettingsPanelProvider(context.extensionUri, context);
	const templatesProvider = new TemplatesPanelProvider(context.extensionUri);
	const timelineProvider = new TimelinePanelProvider(context.extensionUri);
	const platformProvider = new PlatformBrowserProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			PlatformBrowserProvider.viewType,
			gateWebview(platformProvider, context.subscriptions, gatedProviders),
			retainHidden
		),
		vscode.window.registerWebviewViewProvider(
			TemplatesPanelProvider.viewType,
			gateWebview(templatesProvider, context.subscriptions, gatedProviders),
			retainHidden
		),
		vscode.window.registerWebviewViewProvider(
			TimelinePanelProvider.viewType,
			gateWebview(timelineProvider, context.subscriptions, gatedProviders),
			retainHidden
		)
	);

	const engine = await startNexoraEngine(context);
	getBackendClient({
		baseUrl: engine.baseUrl,
		localToken: engine.localToken
	});
	notifyBackendClientConfigured();
	for (const gated of gatedProviders) {
		gated.notifyClientConfigured();
	}

	const wsClient = getOrchestrationWebSocket('default', toWebSocketUrl(engine.baseUrl));

	const connectRealtime = async (): Promise<void> => {
		const connected = await wsClient.connect();
		if (connected) {
			console.log('[Nexora] WebSocket connected for real-time updates');
		} else {
			console.log('[Nexora] WebSocket connection failed - will retry on plan execution');
		}
	};
	if (engine.ready || getEngineState() === 'ready') {
		await connectRealtime();
	} else {
		const sub = onDidChangeEngineState((state) => {
			if (state === 'ready') {
				sub.dispose();
				void connectRealtime();
			}
		});
		context.subscriptions.push(sub);
	}

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
			void settingsProvider.refresh();
		}

		if (message.type === 'task_success') {
			void settingsProvider.refresh();
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('nexora.openChat', async () => {
			await vscode.commands.executeCommand('nexora.chatPanel.focus');
			await setChatFocused(true);
		}),
		vscode.commands.registerCommand('nexora.openBrowser', async (url?: string | vscode.Uri) => {
			await openNexoraBrowser(url);
		}),
		vscode.commands.registerCommand('nexora.openTaskPlan', () => {
			void showOnlyNexoraPanelView('nexora.taskTree');
		}),
		vscode.commands.registerCommand('nexora.openPlatformBrowser', async () => {
			await platformProvider.open();
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
				void notifications.showSuccess(`Nexora engine is connected. API docs: ${client.getBaseUrl()}/docs`);
			} else {
				void notifications.showError('Nexora engine is offline. Check the "Nexora Engine" output channel.');
			}
		}),
		vscode.commands.registerCommand('nexora.showEngineOutput', () => {
			showEngineOutput();
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
			}
		}),
		vscode.commands.registerCommand('nexora.updateTaskStatus', (taskId: string, status: string) => {
			taskTreeProvider.updateTaskStatus(taskId, status);
		}),
		vscode.commands.registerCommand('nexora.showTaskOutput', (taskId: string) => {
			outputProvider.showTaskOutput(taskId);
		}),
		vscode.commands.registerCommand('nexora.openNexoraPanel', async () => {
			await showOnlyNexoraPanelView('nexora.workflowViewer');
		}),
		vscode.commands.registerCommand('nexora.openWorkflow', async () => {
			await showOnlyNexoraPanelView('nexora.workflowViewer');
		}),
		vscode.commands.registerCommand('nexora.openOutput', async () => {
			await showOnlyNexoraPanelView('nexora.outputViewer');
		}),
		vscode.commands.registerCommand('nexora.updateWorkflowPlan', (plan: any) => {
			if (plan && plan.tasks) {
				workflowProvider.updatePlan(plan);
				outputProvider.clearOutputs();
				void showOnlyNexoraPanelView('nexora.workflowViewer');
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
		vscode.commands.registerCommand('nexora.openSettings', async (section?: unknown) => {
			const sectionId = typeof section === 'string' ? section : undefined;
			await settingsProvider.open(sectionId);
			await settingsProvider.refresh();
		}),
		vscode.commands.registerCommand('nexora.refreshSettings', async () => {
			await settingsProvider.refresh();
			void notifications.showInfo('Settings status refreshed');
		}),
		vscode.commands.registerCommand('nexora.openAnalytics', async () => {
			await settingsProvider.open('analytics');
			await settingsProvider.refresh();
		}),
		vscode.commands.registerCommand('nexora.refreshAnalytics', async () => {
			await settingsProvider.refresh();
			void notifications.showInfo('Analytics refreshed');
		}),
		vscode.commands.registerCommand('nexora.openTemplates', async () => {
			await templatesProvider.open();
			await templatesProvider.refresh();
		}),
		vscode.commands.registerCommand('nexora.refreshTemplates', async () => {
			await templatesProvider.refresh();
		}),
		vscode.commands.registerCommand('nexora.openTimeline', async () => {
			await timelineProvider.open();
			await timelineProvider.refresh();
		}),
		vscode.commands.registerCommand('nexora.refreshTimeline', async () => {
			await timelineProvider.refresh();
		}),
		vscode.commands.registerCommand('nexora.showPlanApproval', (plan: unknown) => {
			chatProvider.showPlanApproval(plan);
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

	setTimeout(() => {
		void vscode.commands.executeCommand('nexora.chatPanel.focus');
		void (async () => {
			for (const id of NEXORA_PANEL_VIEWS) {
				if (id === 'nexora.workflowViewer') {
					continue;
				}
				try {
					await vscode.commands.executeCommand(`${id}.removeView`);
				} catch {
					// Panel not open, or this view was already hidden.
				}
			}
		})();
	}, 400);
}

async function checkBackendOnStartup(notifications: ReturnType<typeof getNotificationService>): Promise<void> {
	const client = getBackendClient();
	const isConnected = await client.checkHealth();

	if (isConnected) {
		void notifications.showInfo('Nexora: Backend connected');
	} else {
		void notifications.showWarning('Nexora: Engine offline. Check the "Nexora Engine" output channel.');
	}
}

export async function deactivate() {
	console.log('Nexora Core extension deactivated');
	await closeAgentBrowser();
	disposeWebSocket();
	await stopNexoraEngine();
}
