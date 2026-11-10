/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatPanelProvider } from './chatPanel';
import { PlatformBrowserProvider } from './platformPanel';
import { TaskTreeProvider } from './taskTreeProvider';
import { WorkflowPanelProvider, workflowPlanFromSnapshot } from './workflowPanel';
import { OutputPanelProvider, type TaskOutput } from './outputPanel';
import { SettingsPanelProvider } from './settingsPanel';
import { CustomizePanelProvider } from './customizePanel';
import { WorkspaceIndexService } from './services/workspaceIndex';
import { CloudAccount } from './services/cloudAccount';
import { refreshCapabilities } from './services/backend/capabilities';
import { TimelinePanelProvider } from './timelinePanel';
import { getBackendClient, notifyBackendClientConfigured, setApiKeyHeaderProvider } from './services/backendClient';
import { getSettingsService } from './services/settingsService';
import { registerOAuthUriHandler, registerUriRoute } from './services/oauthConnect';
import { registerMcpConnect } from './services/mcpConnect';
import { registerInlineCompletion } from './services/inlineCompletion';
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
import { agentEditHighlights } from './services/tools/editHighlights';
import { openNexoraBrowser } from './services/browser';
import { closeAgentBrowser } from './services/tools/browserSession';
import { stopAllBackgroundCommands } from './services/tools/terminalCommand';

/** Plan statuses after which the engine runs nothing more (backend PlanStatus). */
const TERMINAL_PLAN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'partially_completed', 'timeout', 'skipped']);

async function setOperationInProgress(value: boolean): Promise<void> {
	await vscode.commands.executeCommand('setContext', 'nexora.operationInProgress', value);
}

async function setChatFocused(value: boolean): Promise<void> {
	await vscode.commands.executeCommand('setContext', 'nexora.chatFocused', value);
}

/** One-line summary for Task Output blocks (no engine log dump). */
function taskStepSummary(message: WebSocketMessage, status: string): string {
	if (status === 'skipped') {
		const reason = (message.error || message.message || 'skipped').trim();
		return reason.slice(0, 200);
	}
	if (status === 'failed') {
		const reason = (message.error || message.message || 'failed').trim();
		return reason.slice(0, 200);
	}
	if (status === 'running') {
		return 'Running';
	}
	const result = message.result;
	if (result && typeof result === 'object') {
		const record = result as Record<string, unknown>;
		if (typeof record.summary === 'string' && record.summary.trim()) {
			return record.summary.trim().slice(0, 200);
		}
		if (typeof record.message === 'string' && record.message.trim()) {
			return record.message.trim().slice(0, 200);
		}
		if (typeof record.url === 'string' && record.url.trim()) {
			return record.url.trim().slice(0, 200);
		}
	}
	if (typeof result === 'string' && result.trim()) {
		return result.trim().slice(0, 200);
	}
	return status === 'success' ? 'Done' : status;
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
	// GitHub/Vercel Connect: deep link from the OAuth success page back into Nexora
	registerOAuthUriHandler(context);
	// Remote MCP Connect: browser and device sign-in for vendor-hosted MCP servers
	registerMcpConnect(context);
	// Inline completion: grey text ahead of the cursor in every editor
	registerInlineCompletion(context);
	// Wire IDE keys into every backend HTTP call (primary runtime credentials)
	// Nexora Cloud: sign in instead of bringing keys; the engine bills models without an own key to it.
	const cloud = new CloudAccount(context);
	registerUriRoute('/cloud-auth', (uri) => void cloud.completeSignIn(uri));
	context.subscriptions.push(
		cloud,
		// The engine reports Cloud as a usable model once the token header arrives; re-ask so the first-run card updates.
		cloud.onDidChange(() => void refreshCapabilities()),
		vscode.commands.registerCommand('nexora.cloudSignIn', () => cloud.signIn()),
		vscode.commands.registerCommand('nexora.cloudSignOut', () => cloud.signOut()),
		vscode.commands.registerCommand('nexora.cloudMenu', () => cloud.showMenu()),
		vscode.commands.registerCommand('nexora.cloudOpenDashboard', () => cloud.openDashboard())
	);
	setApiKeyHeaderProvider(async () => {
		const headers: Record<string, string> = {};
		const cloudToken = await cloud.token();
		if (cloudToken) {
			headers['X-Nexora-Cloud-Token'] = cloudToken;
		}
		const [openai, anthropic, gemini, openrouter, groq, mistral] = await Promise.all([
			settingsService.getApiKey('openai'),
			settingsService.getApiKey('anthropic'),
			settingsService.getApiKey('gemini'),
			settingsService.getApiKey('openrouter'),
			settingsService.getApiKey('groq'),
			settingsService.getApiKey('mistral')
		]);
		if (openai) {
			headers['X-Nexora-OpenAI-Key'] = openai;
		}
		if (anthropic) {
			headers['X-Nexora-Anthropic-Key'] = anthropic;
		}
		if (gemini) {
			headers['X-Nexora-Gemini-Key'] = gemini;
		}
		if (openrouter) {
			headers['X-Nexora-OpenRouter-Key'] = openrouter;
		}
		if (groq) {
			headers['X-Nexora-Groq-Key'] = groq;
		}
		if (mistral) {
			headers['X-Nexora-Mistral-Key'] = mistral;
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
	agentEditHighlights.register(context);

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

	// One click to every Nexora page, like Copilot's status menu.
	const menuStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	menuStatusBar.name = 'Nexora Menu';
	menuStatusBar.text = '$(sparkle) Nexora';
	menuStatusBar.tooltip = 'Nexora: chats, recipes, platforms, customize';
	menuStatusBar.command = 'nexora.quickMenu';
	menuStatusBar.show();
	context.subscriptions.push(menuStatusBar);

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

	const settingsProvider = new SettingsPanelProvider(context.extensionUri, context, cloud);
	const timelineProvider = new TimelinePanelProvider(context.extensionUri);
	const platformProvider = new PlatformBrowserProvider(context.extensionUri);
	const customizeProvider = new CustomizePanelProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			PlatformBrowserProvider.viewType,
			gateWebview(platformProvider, context.subscriptions, gatedProviders),
			retainHidden
		),
		vscode.window.registerWebviewViewProvider(
			TimelinePanelProvider.viewType,
			gateWebview(timelineProvider, context.subscriptions, gatedProviders),
			retainHidden
		)
	);

	const workspaceIndex = new WorkspaceIndexService(context);
	context.subscriptions.push(
		workspaceIndex,
		workspaceIndex.onDidIndex(() => void timelineProvider.refresh()),
		vscode.commands.registerCommand('nexora.reindexWorkspace', () => workspaceIndex.indexNow())
	);

	// Registered before the engine wait: the status bar items and title bars use these while the engine
	// is still starting (up to 180 s on a first run). The pages they open show their own waiting state.
	context.subscriptions.push(
		vscode.commands.registerCommand('nexora.showEngineOutput', () => showEngineOutput()),
		vscode.commands.registerCommand('nexora.newSession', () => chatProvider.createNewSession()),
		vscode.commands.registerCommand('nexora.toggleSessions', () => chatProvider.toggleSessionRail()),
		// section: plugins | platforms | skills | agents | recipes | commands | hooks | rules; none = All.
		vscode.commands.registerCommand('nexora.openCustomize', async (section?: unknown, startNew?: unknown) => {
			await customizeProvider.open(typeof section === 'string' ? section : undefined, startNew === true);
		}),
		// Templates are Customize > Recipes now; refreshTemplates is internal (after Save as recipe).
		vscode.commands.registerCommand('nexora.openTemplates', () => customizeProvider.open('recipes')),
		vscode.commands.registerCommand('nexora.refreshTemplates', () => customizeProvider.refresh()),
		vscode.commands.registerCommand('nexora.openPlatformBrowser', () => platformProvider.open()),
		vscode.commands.registerCommand('nexora.openTimeline', async () => {
			await timelineProvider.open();
			await timelineProvider.refresh();
		}),
		vscode.commands.registerCommand('nexora.openSettings', async (section?: unknown) => {
			await settingsProvider.open(typeof section === 'string' ? section : undefined);
			await settingsProvider.refresh();
		}),
		vscode.commands.registerCommand('nexora.quickMenu', async () => {
			const items: Array<vscode.QuickPickItem & { run: () => Thenable<unknown> }> = [
				{ label: '$(add) New chat', run: () => vscode.commands.executeCommand('nexora.newSession') },
				{ label: '$(play-circle) Recipes', description: 'Run a saved plan', run: () => vscode.commands.executeCommand('nexora.openCustomize', 'recipes') },
				{ label: '$(plug) Platforms', description: 'Connect services', run: () => vscode.commands.executeCommand('nexora.openPlatformBrowser') },
				{ label: '$(extensions) Customize', description: 'Plugins, skills, agents, hooks, rules', run: () => vscode.commands.executeCommand('nexora.openCustomize') },
				{ label: '$(history) Memory timeline', run: () => vscode.commands.executeCommand('nexora.openTimeline') },
				{ label: '$(settings-gear) Settings', run: () => vscode.commands.executeCommand('nexora.openSettings') },
				{ label: '$(output) Engine output', run: () => vscode.commands.executeCommand('nexora.showEngineOutput') }
			];
			const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Nexora' });
			await picked?.run();
		})
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
		void workspaceIndex.start();
	} else {
		const sub = onDidChangeEngineState((state) => {
			if (state === 'ready') {
				sub.dispose();
				void connectRealtime();
				void workspaceIndex.start();
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

			const taskName = message.task_name || message.task_id || 'Unknown';
			const summary = taskStepSummary(message, status);
			const statusLabel = status === 'success'
				? 'success'
				: status === 'skipped'
					? 'skipped'
					: status;
			const taskOutput: TaskOutput = {
				taskId: message.task_id || '',
				taskName: taskName,
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

			if (status !== 'running') {
				outputProvider.addLog(message.task_id || '', {
					timestamp: new Date().toISOString(),
					level: status === 'failed' ? 'error' : 'info',
					message: `${taskName}: ${statusLabel}. ${summary}`
				});
			}

			// Only a running task counts as an in-progress operation. Setting this on
			// terminal events would leave Escape bound to cancel after execution ends.
			if (message.type === 'task_running') {
				void setOperationInProgress(true);
			}
			notifications.handleOrchestrationEvent(message);
		}

		// After a reconnect the client replays each subscribed plan as one snapshot.
		// Task events missed while disconnected never arrive, so the Workflow view and
		// the task tree take their state from it too, not only the chat (G-18).
		if (message.type === 'plan_snapshot') {
			const snapshot = workflowPlanFromSnapshot(message.plan_id || '', message.result);
			if (snapshot) {
				const shown = workflowProvider.getCurrentPlan();
				if (!shown || shown.plan_id === snapshot.plan_id) {
					workflowProvider.updatePlan(snapshot);
				}
				for (const task of snapshot.tasks) {
					taskTreeProvider.updateTaskStatus(task.task_id, task.status);
				}
				// plan_completed may have been missed too; don't leave Escape bound to cancel.
				if (TERMINAL_PLAN_STATUSES.has(snapshot.status)) {
					void setOperationInProgress(false);
				}
			}
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
		// Puts text in the chat box (Customize's Try) without sending it.
		vscode.commands.registerCommand('nexora.prefillChat', async (text?: unknown, mode?: unknown) => {
			await vscode.commands.executeCommand('nexora.chatPanel.focus');
			chatProvider.prefillInput(typeof text === 'string' ? text : '', mode === 'ask' || mode === 'chat' ? mode : 'agent');
		}),
		vscode.commands.registerCommand('nexora.openChatInEditor', async () => {
			await chatProvider.openInEditor();
			await setChatFocused(true);
		}),
		vscode.commands.registerCommand('nexora.toggleChatSidebar', async () => {
			if (chatProvider.isSidebarVisible()) {
				await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
			} else {
				await vscode.commands.executeCommand('nexora.chatPanel.focus');
			}
			await setChatFocused(true);
		}),
		vscode.commands.registerCommand('nexora.openBrowser', async (url?: unknown) => {
			// An editor/title menu passes the chat tab's own webview-panel: URI; only a web address is a page to open.
			const page = typeof url === 'string' || (url instanceof vscode.Uri && /^https?$/.test(url.scheme)) ? url : undefined;
			await openNexoraBrowser(page);
		}),
		vscode.commands.registerCommand('nexora.openTaskPlan', () => {
			void showOnlyNexoraPanelView('nexora.taskTree');
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
		vscode.commands.registerCommand('nexora.refreshSettings', async () => {
			await settingsProvider.refresh();
			void notifications.showInfo('Settings status refreshed');
		}),
		vscode.commands.registerCommand('nexora.openAnalytics', async () => {
			await settingsProvider.open('analytics');
			await settingsProvider.refresh();
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
	stopAllBackgroundCommands();
	await closeAgentBrowser();
	disposeWebSocket();
	await stopNexoraEngine();
}
