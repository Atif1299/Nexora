/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getSettingsWebviewHtml } from './webview/settings';
import { getSettingsService, type ApiKeyProvider, type NexoraPreferences } from './services/settingsService';
import { getBackendClient } from './services/backendClient';
import { getNotificationService } from './services/notificationService';

const LLM_PROVIDERS: ApiKeyProvider[] = ['openai', 'anthropic', 'openrouter'];
const SAAS_PROVIDERS = ['supabase_url', 'supabase_key', 'stripe', 'v0', 'elevenlabs', 'tavily'] as const;
type SaasProvider = (typeof SAAS_PROVIDERS)[number];

function isApiKeyProvider(value: string): value is ApiKeyProvider {
	return (LLM_PROVIDERS as string[]).includes(value);
}

function isSaasProvider(value: string): value is SaasProvider {
	return (SAAS_PROVIDERS as readonly string[]).includes(value);
}

export class SettingsPanelProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexora.settings';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext
	) { }

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
		webviewView.webview.html = getSettingsWebviewHtml(webviewView.webview, this._extensionUri);

		webviewView.webview.onDidReceiveMessage(async (msg) => {
			switch (msg.type) {
				case 'ready':
				case 'refreshStatus':
					await this._pushState();
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
		});

		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				void this._pushState();
			}
		});
	}

	public async refresh(): Promise<void> {
		await this._pushState();
	}

	private async _pushState(): Promise<void> {
		if (!this._view) {
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

		// Week 13: Check SaaS connector status from auth status endpoint
		const authStatus = await client.getAuthStatus('default');
		configured['supabase_url'] = !!authStatus.supabase_configured;
		configured['supabase_key'] = !!authStatus.supabase_configured;
		configured['stripe'] = !!authStatus.stripe_configured;
		configured['v0'] = !!authStatus.v0_configured;
		configured['elevenlabs'] = !!authStatus.elevenlabs_configured;
		configured['tavily'] = !!authStatus.tavily_configured;

		this._view.webview.postMessage({
			type: 'updateState',
			keyMasks,
			configured,
			preferences: settings.getPreferences(),
			connections
		});
	}

	private async _validateApiKey(provider: string, key: string): Promise<void> {
		if (!this._view || !isApiKeyProvider(provider)) {
			return;
		}
		const client = getBackendClient();
		const result = await client.validateApiKey(provider, key);
		this._view.webview.postMessage({
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
				this._view.webview.postMessage({
					type: 'saveResult',
					provider,
					success: false,
					error: result?.error || 'Key validation failed - not saved'
				});
				return;
			}

			await settings.setApiKey(provider, key);
			this._view.webview.postMessage({
				type: 'saveResult',
				provider,
				success: true
			});
			void notifications.showSuccess(
				`${provider} key saved - used for Chat, Plan, and Agent`
			);
			await this._pushState();
		} catch (error) {
			this._view.webview.postMessage({
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
			this._view.webview.postMessage({ type: 'clearResult', provider, success: true });
			await this._pushState();
		} catch (error) {
			this._view.webview.postMessage({
				type: 'clearResult',
				provider,
				success: false,
				error: error instanceof Error ? error.message : 'Clear failed'
			});
		}
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
			this._view?.webview.postMessage({
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

	// Week 13: SaaS connector key handlers
	private async _testSaasKey(provider: string, value: string): Promise<void> {
		if (!this._view || !isSaasProvider(provider)) {
			return;
		}

		const client = getBackendClient();
		// Map provider to backend test endpoint
		const testProvider = provider === 'supabase_url' || provider === 'supabase_key' ? 'supabase' : provider;
		const result = await client.testProviderConnection(testProvider, 'default');

		this._view.webview.postMessage({
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
				this._view.webview.postMessage({
					type: 'saasSaveResult',
					provider,
					success: true
				});
				void notifications.showSuccess(`${provider} saved to backend`);
				await this._pushState();
			} else {
				this._view.webview.postMessage({
					type: 'saasSaveResult',
					provider,
					success: false,
					error: result?.error || 'Save failed'
				});
			}
		} catch (error) {
			this._view.webview.postMessage({
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
			this._view.webview.postMessage({ type: 'saasClearResult', provider, success: true });
			await this._pushState();
		} catch (error) {
			this._view.webview.postMessage({
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
