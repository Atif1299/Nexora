/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getSettingsWebviewHtml } from './webview/settings';
import { acquireEditorPanel, gateEditorPanel } from './services/editorPage';
import { getSettingsService, type ApiKeyProvider, type NexoraPreferences } from './services/settingsService';
import { getAgentUiSettings, type AgentRunMode } from './services/agentRunMode';
import { getBackendClient } from './services/backendClient';
import { getNotificationService } from './services/notificationService';
import type { SaasConnector } from './services/backend/auth';
import {
	getCachedCapabilities,
	onDidChangeCapabilities,
	refreshCapabilities,
	type CapabilitiesReport
} from './services/backend/capabilities';

const LLM_PROVIDERS: ApiKeyProvider[] = ['openai', 'anthropic', 'openrouter'];
const SAAS_PROVIDERS = ['supabase_url', 'supabase_key', 'stripe', 'v0', 'elevenlabs', 'tavily'] as const;
type SaasProvider = (typeof SAAS_PROVIDERS)[number];

function isApiKeyProvider(value: string): value is ApiKeyProvider {
	return (LLM_PROVIDERS as string[]).includes(value);
}

function isSaasProvider(value: string): value is SaasProvider {
	return (SAAS_PROVIDERS as readonly string[]).includes(value);
}

export class SettingsPanelProvider {
	public static readonly viewType = 'nexora.settings';

	private _panel?: vscode.WebviewPanel;
	private _view?: vscode.Webview;
	private _attached = false;
	private _pendingSection?: string;
	private _disposables: vscode.Disposable[] = [];
	private _pushTimer: ReturnType<typeof setTimeout> | undefined;
	private _pushInflight: Promise<void> | undefined;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext
	) { }

	public async open(section?: string): Promise<void> {
		if (section) {
			this._pendingSection = section;
		}

		const panel = acquireEditorPanel({
			viewType: SettingsPanelProvider.viewType,
			title: 'Nexora Settings',
			extensionUri: this._extensionUri,
			icon: 'settings.svg'
		});
		const isNew = this._panel !== panel;
		this._panel = panel;
		this._view = panel.webview;

		if (!isNew) {
			if (this._attached) {
				this._revealSection(section);
			}
			return;
		}

		this._attached = false;
		panel.onDidDispose(() => {
			if (this._panel !== panel) {
				return;
			}
			this._disposeBindings();
			this._panel = undefined;
			this._view = undefined;
			this._attached = false;
			this._pendingSection = undefined;
		});
		gateEditorPanel(panel, (readyPanel) => this._attach(readyPanel));
	}

	public async refresh(): Promise<void> {
		await this._pushState();
	}

	private _attach(panel: vscode.WebviewPanel): void {
		if (this._attached && this._panel === panel) {
			this._revealSection(this._pendingSection);
			return;
		}
		this._disposeBindings();
		this._attached = true;
		this._panel = panel;
		this._view = panel.webview;
		panel.webview.html = getSettingsWebviewHtml(
			panel.webview,
			this._extensionUri,
			this._pendingSection
		);

		this._disposables = [
			panel.webview.onDidReceiveMessage(async (msg) => {
				switch (msg.type) {
					case 'ready':
					case 'refreshStatus':
						await this._pushState(msg.type === 'refreshStatus');
						this._revealSection(this._pendingSection);
						break;
					case 'refreshAnalytics':
						await this._pushState(true);
						this._revealSection(this._pendingSection);
						break;
					case 'validateApiKey':
						await this._validateApiKey(msg.provider, msg.key);
						break;
					case 'saveApiKey':
						await this._saveApiKey(msg.provider, msg.key);
						break;
					case 'clearApiKey':
						await this._clearApiKey(msg.provider);
						break;
					case 'savePreferences':
						await this._savePreferences(msg.preferences || {});
						break;
					case 'saveRunMode':
						await this._saveRunMode(msg.runMode);
						break;
					case 'saveConfig':
						await this._saveConfig(msg.key, msg.value);
						break;
					case 'connectOAuth':
						await this._connectOAuth(msg.provider);
						break;
					case 'disconnectOAuth':
						await this._disconnectOAuth(msg.provider);
						break;
					case 'testEnvConnection':
						await this._testEnvConnection(msg.provider);
						break;
					case 'showShortcuts':
						await vscode.commands.executeCommand('nexora.showKeyboardShortcuts');
						break;
					// Week 13: SaaS connector key handlers
					case 'testSaasKey':
						await this._testSaasKey(msg.provider, msg.value);
						break;
					case 'saveSaasKey':
						await this._saveSaasKey(msg.provider, msg.value);
						break;
					case 'clearSaasKey':
						await this._clearSaasKey(msg.provider);
						break;
				}
			}),
			panel.onDidChangeViewState(() => {
				if (panel.visible && this._attached) {
					this._schedulePush(false);
				}
			}),
			onDidChangeCapabilities((capabilities) => {
				if (!this._view || !this._panel?.visible) {
					return;
				}
				this._view.postMessage({ type: 'updateState', capabilities: capabilities || null });
			}),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if ((e.affectsConfiguration('nexora.agent') || e.affectsConfiguration('nexora.chat')) && this._panel?.visible) {
					this._schedulePush(false);
				}
			})
		];
	}

	private _revealSection(section?: string): void {
		if (!this._view || !section) {
			return;
		}
		void this._view.postMessage({ type: 'showSection', section });
	}

	private _disposeBindings(): void {
		if (this._pushTimer) {
			clearTimeout(this._pushTimer);
			this._pushTimer = undefined;
		}
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
		this._disposables = [];
	}

	private _schedulePush(force = false): void {
		if (this._pushTimer) {
			clearTimeout(this._pushTimer);
		}
		this._pushTimer = setTimeout(() => {
			this._pushTimer = undefined;
			void this._pushState(force);
		}, 200);
	}

	private async _pushState(force = false): Promise<void> {
		if (!this._view || !this._attached) {
			return;
		}
		if (this._pushInflight) {
			return this._pushInflight;
		}
		this._pushInflight = this._loadAndPost(force);
		try {
			await this._pushInflight;
		} finally {
			this._pushInflight = undefined;
		}
	}

	private async _loadAndPost(force: boolean): Promise<void> {
		if (!this._view || !this._attached) {
			return;
		}

		const settings = getSettingsService(this._context);
		const client = getBackendClient();

		const keyMasks: Record<string, string | null> = {};
		const configured: Record<string, boolean> = {};
		for (const provider of LLM_PROVIDERS) {
			keyMasks[provider] = await settings.getApiKeyMask(provider);
			configured[provider] = await settings.hasApiKey(provider);
		}

		const connections = await client.getConnectionStatus('default');
		const capabilities: CapabilitiesReport | undefined = force || !getCachedCapabilities()
			? await refreshCapabilities()
			: getCachedCapabilities();
		const analytics = await client.getAnalyticsDashboard('default', force);

		// Week 13: Check SaaS connector status from auth status endpoint
		const authStatus = await client.getAuthStatus('default');
		configured['supabase_url'] = !!authStatus.supabase_configured;
		configured['supabase_key'] = !!authStatus.supabase_configured;
		configured['stripe'] = !!authStatus.stripe_configured;
		configured['v0'] = !!authStatus.v0_configured;
		configured['elevenlabs'] = !!authStatus.elevenlabs_configured;
		configured['tavily'] = !!authStatus.tavily_configured;

		const agent = getAgentUiSettings();
		this._view.postMessage({
			type: 'updateState',
			keyMasks,
			configured,
			preferences: settings.getPreferences(),
			runMode: agent.runMode,
			agentSettings: agent,
			connections,
			capabilities: capabilities || null,
			analytics
		});
	}

	private async _validateApiKey(provider: string, key: string): Promise<void> {
		if (!this._view || !isApiKeyProvider(provider)) {
			return;
		}
		const client = getBackendClient();
		const result = await client.validateApiKey(provider, key);
		this._view.postMessage({
			type: 'validateResult',
			provider,
			success: !!result?.success,
			details: result?.details,
			error: result?.error
		});
	}

	private async _saveApiKey(provider: string, key: string): Promise<void> {
		if (!this._view || !isApiKeyProvider(provider)) {
			return;
		}

		const notifications = getNotificationService();
		const client = getBackendClient();
		const settings = getSettingsService(this._context);

		try {
			const result = await client.validateApiKey(provider, key);
			if (!result?.success) {
				this._view.postMessage({
					type: 'saveResult',
					provider,
					success: false,
					error: result?.error || 'Key validation failed - not saved'
				});
				return;
			}

			await settings.setApiKey(provider, key);
			this._view.postMessage({
				type: 'saveResult',
				provider,
				success: true
			});
			void notifications.showSuccess(
				`${provider} key saved - used for Chat, Plan, and Agent`
			);
			await refreshCapabilities();
			await this._pushState();
		} catch (error) {
			this._view.postMessage({
				type: 'saveResult',
				provider,
				success: false,
				error: error instanceof Error ? error.message : 'Save failed'
			});
		}
	}

	private async _clearApiKey(provider: string): Promise<void> {
		if (!this._view || !isApiKeyProvider(provider)) {
			return;
		}
		try {
			await getSettingsService(this._context).deleteApiKey(provider);
			this._view.postMessage({ type: 'clearResult', provider, success: true });
			await refreshCapabilities();
			await this._pushState();
		} catch (error) {
			this._view.postMessage({
				type: 'clearResult',
				provider,
				success: false,
				error: error instanceof Error ? error.message : 'Clear failed'
			});
		}
	}

	private async _saveRunMode(runMode: unknown): Promise<void> {
		const valid: AgentRunMode[] = ['ask', 'auto-edit', 'allowlist', 'run-everything'];
		if (typeof runMode !== 'string' || !valid.includes(runMode as AgentRunMode)) {
			return;
		}
		await vscode.workspace.getConfiguration('nexora').update(
			'agent.runMode',
			runMode,
			vscode.ConfigurationTarget.Global
		);
		await this._pushState();
	}

	private async _saveConfig(key: unknown, value: unknown): Promise<void> {
		const cfg = vscode.workspace.getConfiguration('nexora');
		if (key === 'agent.maxTurns') {
			const n = Number(value);
			if (n === 10 || n === 15 || n === 25 || n === 40) {
				await cfg.update('agent.maxTurns', n, vscode.ConfigurationTarget.Global);
			} else {
				return;
			}
		} else if (key === 'chat.submitWithCtrlEnter' && typeof value === 'boolean') {
			await cfg.update('chat.submitWithCtrlEnter', value, vscode.ConfigurationTarget.Global);
		} else if (
			typeof key === 'string' &&
			typeof value === 'boolean' &&
			(
				key === 'agent.includeOpenEditors' ||
				key === 'agent.inlineDiffs' ||
				key === 'agent.autoFormat' ||
				key === 'agent.autoApproveModeSwitch' ||
				key === 'agent.autoCloseTerminal'
			)
		) {
			await cfg.update(key, value, vscode.ConfigurationTarget.Global);
		} else {
			return;
		}
		await this._pushState();
	}

	private async _savePreferences(preferences: Record<string, unknown>): Promise<void> {
		const settings = getSettingsService(this._context);
		const next: Partial<NexoraPreferences> = {};
		if (typeof preferences.defaultModel === 'string') {
			next.defaultModel = preferences.defaultModel;
		}
		if (typeof preferences.autoIndexWorkspace === 'boolean') {
			next.autoIndexWorkspace = preferences.autoIndexWorkspace;
		}
		if (typeof preferences.showCostEstimates === 'boolean') {
			next.showCostEstimates = preferences.showCostEstimates;
		}
		if (preferences.theme === 'auto' || preferences.theme === 'light' || preferences.theme === 'dark') {
			next.theme = preferences.theme;
		}
		await settings.setPreferences(next);
		await this._pushState();
		void getNotificationService().showInfo('Preferences saved');
	}

	private async _connectOAuth(provider: string): Promise<void> {
		const client = getBackendClient();
		const notifications = getNotificationService();
		try {
			const result =
				provider === 'github'
					? await client.getGitHubAuthUrl('default')
					: provider === 'vercel'
						? await client.getVercelAuthUrl('default')
						: null;

			if (!result?.authorization_url) {
				void notifications.showError(`Could not start ${provider} OAuth - check backend .env OAuth client IDs`);
				return;
			}

			await vscode.env.openExternal(vscode.Uri.parse(result.authorization_url));
			void notifications.showInfo(`Complete ${provider} login in the browser, then Refresh status`);
			this._view?.postMessage({
				type: 'oauthResult',
				message: `${provider} OAuth opened in browser`
			});
		} catch (error) {
			void notifications.showError(
				`OAuth failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	private async _disconnectOAuth(provider: string): Promise<void> {
		const client = getBackendClient();
		const notifications = getNotificationService();
		try {
			if (provider === 'github') {
				await client.disconnectGitHub('default');
			} else if (provider === 'vercel') {
				await client.disconnectVercel('default');
			}
			void notifications.showSuccess(`${provider} disconnected`);
			await this._pushState();
		} catch (error) {
			void notifications.showError(
				`Disconnect failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	private async _testEnvConnection(provider: string): Promise<void> {
		const client = getBackendClient();
		const notifications = getNotificationService();
		const result = await client.testProviderConnection(provider, 'default');
		if (result?.success) {
			void notifications.showSuccess(`${provider}: ${result.details || 'Connected (backend .env)'}`);
		} else {
			void notifications.showWarning(
				`${provider}: ${result?.error || 'Not configured'} - set key in backend .env and restart uvicorn`
			);
		}
		await this._pushState();
	}

	// Week 13/14: SaaS connector key handlers
	private async _testSaasKey(provider: string, value: string): Promise<void> {
		if (!this._view || !isSaasProvider(provider)) {
			return;
		}

		const client = getBackendClient();

		// The backend can only test the key it has stored, so a freshly typed value
		// has to be saved first. Otherwise Test reports on the previous key while
		// the user is looking at a new one.
		const typed = (value || '').trim();
		if (typed && !typed.includes('•')) {
			const envKey = this._getEnvKeyName(provider);
			const saved = await client.setSaasCredential(envKey, typed);
			if (!saved?.success) {
				this._view.postMessage({
					type: 'saasTestResult',
					provider,
					success: false,
					error: saved?.error || 'Could not save the entered key before testing'
				});
				return;
			}
		}

		// Map provider to backend test endpoint
		const testProvider = provider === 'supabase_url' || provider === 'supabase_key' ? 'supabase' : provider;
		const result = await client.testProviderConnection(testProvider, 'default');

		this._view.postMessage({
			type: 'saasTestResult',
			provider,
			success: !!result?.success,
			details: result?.details,
			error: result?.error
		});
	}

	private async _saveSaasKey(provider: string, value: string): Promise<void> {
		if (!this._view || !isSaasProvider(provider)) {
			return;
		}

		const notifications = getNotificationService();
		const client = getBackendClient();

		try {
			// Save to backend .env via API
			const envKey = this._getEnvKeyName(provider);
			const result = await client.setSaasCredential(envKey, value);

			if (result?.success) {
				this._view.postMessage({
					type: 'saasSaveResult',
					provider,
					success: true
				});
				void notifications.showSuccess(`${provider} saved to backend`);
				await this._pushState();
			} else {
				this._view.postMessage({
					type: 'saasSaveResult',
					provider,
					success: false,
					error: result?.error || 'Save failed'
				});
			}
		} catch (error) {
			this._view.postMessage({
				type: 'saasSaveResult',
				provider,
				success: false,
				error: error instanceof Error ? error.message : 'Save failed'
			});
		}
	}

	private async _clearSaasKey(provider: string): Promise<void> {
		if (!this._view || !isSaasProvider(provider)) {
			return;
		}

		const client = getBackendClient();
		try {
			const envKey = this._getEnvKeyName(provider);
			await client.setSaasCredential(envKey, '');

			// Clearing the credential must also drop the connection server-side,
			// otherwise the badge keeps reporting the provider as connected.
			const connector = provider === 'supabase_url' || provider === 'supabase_key'
				? 'supabase'
				: provider;
			await client.disconnectSaasConnector(connector as SaasConnector, 'default');

			this._view.postMessage({ type: 'saasClearResult', provider, success: true });
			await this._pushState();
		} catch (error) {
			this._view.postMessage({
				type: 'saasClearResult',
				provider,
				success: false,
				error: error instanceof Error ? error.message : 'Clear failed'
			});
		}
	}

	private _getEnvKeyName(provider: string): string {
		const envKeyMap: Record<string, string> = {
			'supabase_url': 'SUPABASE_URL',
			'supabase_key': 'SUPABASE_SERVICE_KEY',
			'stripe': 'STRIPE_SECRET_KEY',
			'v0': 'V0_API_KEY',
			'elevenlabs': 'ELEVENLABS_API_KEY',
			'tavily': 'TAVILY_API_KEY'
		};
		return envKeyMap[provider] || provider.toUpperCase();
	}
}
