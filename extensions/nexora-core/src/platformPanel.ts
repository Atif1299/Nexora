/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getPlatformsWebviewHtml } from './webview/platforms';
import { getBackendClient, isBackendClientConfigured, onDidConfigureBackendClient } from './services/backendClient';
import { getEngineState, onDidChangeEngineState } from './services/engineProcess';
import {
	capabilityReason,
	getCachedCapabilities,
	isLivePlatform,
	onDidChangeCapabilities,
	platformCapabilityStatus,
	refreshCapabilities,
	type CapabilitiesReport,
	type CapabilityStatus
} from './services/backend/capabilities';
import { getNotificationService } from './services/notificationService';
import { getSettingsService, type ApiKeyProvider } from './services/settingsService';
import {
	connectMcpServer,
	disconnectMcpServer,
	getMcpConnections,
	mcpServerIdForPlatform,
	mcpServerLabel,
	onDidConnectMcpServer
} from './services/mcpConnect';
import {
	isOAuthAppConfigured,
	oauthProviderLabel,
	oauthSetupStep,
	onDidCompleteOAuth,
	startOAuthConnect,
	type OAuthProvider
} from './services/oauthConnect';
import type { SaasConnector } from './services/backend/auth';

/**
 * Catalogue rows whose credential is the Settings > LLM API Keys entry in SecretStorage.
 * The sidebar never stores its own key: READY means that SecretStorage key exists.
 */
const LLM_KEY_ROWS: Record<string, ApiKeyProvider> = {
	openai: 'openai',
	claude: 'anthropic',
	gemini: 'gemini',
	openrouter: 'openrouter'
};

/** Rows with a real card in Settings, so Configure has somewhere to go. */
const SETTINGS_BACKED_PLATFORMS = new Set([
	'github', 'vercel', 'supabase', 'stripe', 'v0-dev', 'elevenlabs', 'tavily'
]);

/** platforms.json has no OpenRouter row, but its key is a first-class LLM key in Settings. */
const OPENROUTER_ROW: PlatformApiRow = {
	id: 'openrouter',
	name: 'OpenRouter',
	category: 'LLM',
	description: 'Model router for many LLM providers through one API key'
};

function llmKeyProvider(platformId: string): ApiKeyProvider | undefined {
	return LLM_KEY_ROWS[(platformId || '').trim().toLowerCase()];
}

interface Platform {
	id: string;
	name: string;
	category: string;
	description?: string;
	capabilities?: string[];
	api_type?: string;
	auth_type?: string;
	has_active_connector?: boolean;
	is_enabled?: boolean;
	capabilityStatus?: CapabilityStatus;
	capabilityReason?: string;
	live?: boolean;
	keyProvider?: ApiKeyProvider;
	/** One-time OAuth app setup step; set while the client id/secret are missing. */
	setupHint?: string;
	/** Engine-side MCP server id when this row connects by remote MCP sign-in. */
	mcpServerId?: string;
	/** Settings has a card for this row, so Configure is not a no-op. */
	configurable?: boolean;
	/** Holds a credential that Disconnect can clear. */
	disconnectable?: boolean;
}

interface PlatformApiRow {
	id?: string;
	name?: string;
	category?: string;
	description?: string;
	capabilities?: string[];
	api_type?: string;
	auth_type?: string;
	has_active_connector?: boolean;
	is_enabled?: boolean;
}

function isBlockedStatus(status: CapabilityStatus | undefined): boolean {
	return status === 'not_configured' || status === 'unavailable' || status === 'failed';
}

export class PlatformBrowserProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexora.platformBrowser';

	private readonly _extensionUri: vscode.Uri;
	private _view?: vscode.WebviewView;
	private _attached = false;
	private _disposables: vscode.Disposable[] = [];
	private platforms: Platform[] = [];
	private isLoading = false;
	private error: string | null = null;
	private backendConnected = false;
	private embeddingInProgress = false;
	private llmKeys: Partial<Record<ApiKeyProvider, boolean>> = {};
	private oauthApps: Partial<Record<OAuthProvider, boolean>> = {};
	private mcpConnections: Record<string, boolean> = {};
	private mcpClientIds: Record<string, boolean> = {};

	constructor(extensionUri: vscode.Uri) {
		this._extensionUri = extensionUri;
		getSettingsService().onDidChangeApiKeys(() => {
			void this._syncLlmKeys().then(() => this._pushState());
		});
		onDidCompleteOAuth((provider) => {
			void getNotificationService().showSuccess(`${oauthProviderLabel(provider)} connected`);
			void this._afterChange();
		});
		onDidConnectMcpServer((serverId) => {
			this.mcpConnections = { ...this.mcpConnections, [serverId]: true };
			this._applyCapabilities(getCachedCapabilities());
			this._pushState();
		});
		onDidChangeEngineState((state) => {
			if (state === 'ready') {
				void this.loadPlatforms();
			}
		});
		onDidConfigureBackendClient(() => {
			if (getEngineState() === 'ready') {
				void this.loadPlatforms();
			}
		});
		onDidChangeCapabilities((report) => {
			this._applyCapabilities(report);
			this._pushState();
			if (report?.vectors.embedding_in_progress === false && this.platforms.length === 0 && getEngineState() === 'ready') {
				void this.loadPlatforms();
			}
		});
		if (getEngineState() === 'ready' && isBackendClientConfigured()) {
			void this.loadPlatforms();
		}
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;
		this._attach(webviewView);
	}

	public async open(): Promise<void> {
		await vscode.commands.executeCommand(`${PlatformBrowserProvider.viewType}.focus`);
		if (this._attached) {
			this._pushState();
		}
	}

	async loadPlatforms(): Promise<void> {
		if (getEngineState() !== 'ready' || !isBackendClientConfigured()) {
			return;
		}
		if (this.isLoading) {
			return;
		}

		this.isLoading = true;
		this.error = null;
		this._pushState();

		try {
			const client = getBackendClient();

			const isHealthy = await client.checkHealth();
			this.backendConnected = isHealthy;

			const report = getCachedCapabilities() || await refreshCapabilities();
			this.embeddingInProgress = !!report?.vectors.embedding_in_progress;

			await this._syncLlmKeys();
			await this._syncOAuthApps();
			await this._syncMcpConnections();
			const platformsData = await client.getPlatforms() as PlatformApiRow[];
			if (!platformsData.some(p => (p.id || '').toLowerCase() === OPENROUTER_ROW.id)) {
				platformsData.push(OPENROUTER_ROW);
			}
			this.platforms = platformsData.map((p) => this._mapPlatform(p, report));

			if (!this.backendConnected && this.platforms.length > 0) {
				this.error = 'Using cached data (backend offline)';
			}
		} catch {
			this.error = 'Failed to load platforms';
			this.platforms = [];
		} finally {
			this.isLoading = false;
			this._pushState();
		}
	}

	public async refresh(): Promise<void> {
		void refreshCapabilities();
		await this.loadPlatforms();
	}

	isBackendConnected(): boolean {
		return this.backendConnected;
	}

	getPlatformCount(): number {
		return this.platforms.length;
	}

	private _attach(view: vscode.WebviewView): void {
		if (this._attached && this._view === view) {
			this._pushState();
			return;
		}
		this._disposeBindings();
		this._attached = true;
		this._view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};
		view.webview.html = getPlatformsWebviewHtml(view.webview, this._extensionUri);

		this._disposables = [
			view.webview.onDidReceiveMessage(async (msg: { type?: string; id?: string }) => {
				if (msg?.type === 'refresh') {
					await this.refresh();
					return;
				}
				if (msg?.type === 'ready') {
					if (this.platforms.length === 0 && getEngineState() === 'ready') {
						await this.loadPlatforms();
					} else {
						this._pushState();
					}
					return;
				}
				if (msg?.type === 'connect' && msg.id) {
					await this._handleConnect(msg.id);
					return;
				}
				if (msg?.type === 'disconnect' && msg.id) {
					await this._handleDisconnect(msg.id);
					return;
				}
				if (msg?.type === 'configure' && msg.id) {
					await this._handleConfigure(msg.id);
				}
			}),
			view.onDidChangeVisibility(() => {
				if (view.visible && this._attached) {
					// A key or sign-in may have landed in Settings meanwhile.
					void Promise.all([this._syncOAuthApps(), this._syncMcpConnections()])
						.then(() => this._pushState());
				}
			}),
			view.onDidDispose(() => {
				this._disposeBindings();
				this._view = undefined;
				this._attached = false;
			})
		];
	}

	private _disposeBindings(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
		this._disposables = [];
	}

	private _pushState(): void {
		if (!this._view || !this._attached) {
			return;
		}
		this._view.webview.postMessage({
			type: 'updateData',
			data: {
				isLoading: this.isLoading,
				error: this.error,
				embeddingInProgress: this.embeddingInProgress,
				backendConnected: this.backendConnected,
				categories: this._categoriesPayload()
			}
		});
	}

	private _mapPlatform(p: PlatformApiRow, report: CapabilitiesReport | undefined): Platform {
		const id = String(p.id || '');
		return {
			id,
			name: p.name || id,
			category: p.category || 'Other',
			description: p.description,
			capabilities: p.capabilities,
			api_type: p.api_type,
			auth_type: p.auth_type,
			...this._statusFields(id, p.is_enabled, report)
		};
	}

	private _applyCapabilities(report: CapabilitiesReport | undefined): void {
		this.embeddingInProgress = !!report?.vectors.embedding_in_progress;
		this.platforms = this.platforms.map(p => ({
			...p,
			...this._statusFields(p.id, p.is_enabled, report)
		}));
	}

	/**
	 * LLM rows follow SecretStorage only: READY when the Settings key exists, CATALOGUE otherwise.
	 * Every other live row follows the engine capability report.
	 */
	private _statusFields(
		id: string,
		isEnabled: boolean | undefined,
		report: CapabilitiesReport | undefined
	): Pick<Platform, 'live' | 'capabilityStatus' | 'capabilityReason' | 'has_active_connector' | 'is_enabled' | 'keyProvider' | 'setupHint' | 'mcpServerId' | 'configurable' | 'disconnectable'> {
		const keyProvider = llmKeyProvider(id);
		if (keyProvider) {
			const ready = !!this.llmKeys[keyProvider];
			return {
				live: ready,
				capabilityStatus: ready ? 'ready' : undefined,
				capabilityReason: undefined,
				has_active_connector: ready,
				is_enabled: isEnabled !== false,
				keyProvider,
				setupHint: undefined
			};
		}
		const mcpServerId = mcpServerIdForPlatform(id);
		if (mcpServerId) {
			return this._mcpStatusFields(id, mcpServerId, isEnabled, report);
		}

		const live = isLivePlatform(id);
		const status = live ? platformCapabilityStatus(id, report) : undefined;
		const blocked = live && isBlockedStatus(status);
		return {
			live,
			capabilityStatus: status,
			capabilityReason: status ? capabilityReason(status) : undefined,
			has_active_connector: live && status === 'ready',
			is_enabled: blocked ? false : isEnabled !== false,
			keyProvider: undefined,
			setupHint: undefined,
			mcpServerId: undefined,
			configurable: SETTINGS_BACKED_PLATFORMS.has(id),
			disconnectable: live && status === 'ready' && SETTINGS_BACKED_PLATFORMS.has(id)
		};
	}

	/**
	 * Rows that connect by remote MCP sign-in. Ready means the engine holds a
	 * login: either an MCP token, or the older per-connector OAuth token that
	 * still drives orchestration for GitHub and Vercel.
	 */
	private _mcpStatusFields(
		platformId: string,
		mcpServerId: string,
		isEnabled: boolean | undefined,
		report: CapabilitiesReport | undefined
	): Pick<Platform, 'live' | 'capabilityStatus' | 'capabilityReason' | 'has_active_connector' | 'is_enabled' | 'keyProvider' | 'setupHint' | 'mcpServerId' | 'configurable' | 'disconnectable'> {
		const capability = isLivePlatform(platformId)
			? platformCapabilityStatus(platformId, report)
			: undefined;
		if (capability === 'unavailable') {
			return {
				live: true,
				capabilityStatus: 'unavailable',
				capabilityReason: capabilityReason('unavailable'),
				has_active_connector: false,
				is_enabled: false,
				keyProvider: undefined,
				setupHint: undefined,
				mcpServerId,
				configurable: false,
				disconnectable: false
			};
		}

		const connected = this.mcpConnections[mcpServerId] === true || capability === 'ready';
		// GitHub cannot register Nexora automatically, so it needs its client ID once.
		const needsClientId =
			!connected && mcpServerId === 'github' && this.mcpClientIds.github === false;
		const setupHint = needsClientId
			? 'One-time setup: paste your GitHub OAuth app client ID in Settings → Connections. '
			+ 'No client secret is needed. Every later Connect is browser sign-in only.'
			: undefined;

		return {
			live: true,
			capabilityStatus: connected ? 'ready' : 'not_configured',
			capabilityReason: connected
				? undefined
				: (setupHint || 'Not connected - Connect opens sign-in in your browser'),
			has_active_connector: connected,
			is_enabled: isEnabled !== false,
			keyProvider: undefined,
			setupHint,
			mcpServerId,
			// Clerk has nothing to set in Settings; GitHub and Vercel keep
			// orchestration credentials there.
			configurable: SETTINGS_BACKED_PLATFORMS.has(platformId),
			disconnectable: connected
		};
	}

	private async _syncMcpConnections(): Promise<void> {
		try {
			const rows = await getBackendClient().getMcpConnectStatus();
			this.mcpConnections = Object.fromEntries(rows.map(r => [r.id, r.connected]));
			this.mcpClientIds = Object.fromEntries(rows.map(r => [r.id, r.has_client_id]));
		} catch {
			// Unknown: do not claim a setup is missing when the engine is unreachable.
			this.mcpConnections = {};
			this.mcpClientIds = {};
		}
		this._applyCapabilities(getCachedCapabilities());
	}

	private async _syncOAuthApps(): Promise<void> {
		try {
			const [github, vercel] = await Promise.all([
				isOAuthAppConfigured('github'),
				isOAuthAppConfigured('vercel')
			]);
			this.oauthApps = { github, vercel };
		} catch {
			// Unknown: do not claim setup is missing when the engine is unreachable.
			this.oauthApps = {};
		}
		this._applyCapabilities(getCachedCapabilities());
	}

	private async _syncLlmKeys(): Promise<void> {
		try {
			this.llmKeys = await getSettingsService().getConfiguredKeyProviders();
		} catch {
			this.llmKeys = {};
		}
		this._applyCapabilities(getCachedCapabilities());
	}

	private _saasId(platformId: string): SaasConnector | undefined {
		const map: Record<string, SaasConnector> = {
			supabase: 'supabase',
			stripe: 'stripe',
			'v0-dev': 'v0',
			elevenlabs: 'elevenlabs',
			tavily: 'tavily'
		};
		return map[platformId];
	}

	private async _openSettings(section: string): Promise<void> {
		await vscode.commands.executeCommand('nexora.openSettings', section);
	}

	private async _afterChange(): Promise<void> {
		await refreshCapabilities();
		await this.loadPlatforms();
	}

	private async _handleConfigure(platformId: string): Promise<void> {
		const keyProvider = llmKeyProvider(platformId);
		if (keyProvider) {
			// Settings resolves the provider id to LLM API Keys and scrolls to that card.
			await this._openSettings(keyProvider);
			return;
		}
		if (!isLivePlatform(platformId)) {
			return;
		}
		if (platformId === 'github' || platformId === 'vercel') {
			await this._openSettings(platformId);
			return;
		}
		const saas = this._saasId(platformId);
		if (saas) {
			await this._openSettings(saas);
			return;
		}
		await this._openSettings('keys');
	}

	/**
	 * Remote MCP sign-in: the engine answers with a browser URL, a device code,
	 * or a one-time setup step. Nothing opens until the engine says it can.
	 */
	private async _connectMcp(mcpServerId: string): Promise<void> {
		const notifications = getNotificationService();
		const label = mcpServerLabel(mcpServerId);
		const result = await connectMcpServer(mcpServerId);

		switch (result.status) {
			case 'connected':
				this.mcpConnections = { ...this.mcpConnections, [mcpServerId]: true };
				void notifications.showSuccess(`${label} connected`);
				await this._afterChange();
				return;
			case 'started':
				this.mcpClientIds = { ...this.mcpClientIds, [mcpServerId]: true };
				this._pushState();
				return;
			case 'needs_setup':
				this.mcpClientIds = { ...this.mcpClientIds, [mcpServerId]: false };
				this._applyCapabilities(getCachedCapabilities());
				this._pushState();
				void notifications.showWarning(result.message);
				await this._openSettings(mcpServerId === 'github' ? 'github' : mcpServerId);
				return;
			case 'cancelled':
				return;
			default:
				void notifications.showError(result.message);
		}
	}

	private async _handleConnect(platformId: string): Promise<void> {
		if (llmKeyProvider(platformId)) {
			await this._handleConfigure(platformId);
			return;
		}
		if (!isLivePlatform(platformId) && !mcpServerIdForPlatform(platformId)) {
			return;
		}
		const notifications = getNotificationService();
		const status = platformCapabilityStatus(platformId, getCachedCapabilities());
		if (status === 'unavailable') {
			void notifications.showWarning(`${platformId} is unavailable in this build`);
			return;
		}
		if (platformId === 'crewai' || platformId === 'gpt-researcher') {
			await this._handleConfigure(platformId);
			return;
		}
		const mcpServerId = mcpServerIdForPlatform(platformId);
		if (mcpServerId) {
			await this._connectMcp(mcpServerId);
			return;
		}
		const saas = this._saasId(platformId);
		if (saas) {
			if (status === 'not_configured' || status === 'failed') {
				await this._openSettings(saas);
				return;
			}
			const result = await getBackendClient().toggleSaasConnector(saas, true, 'default');
			if (!result) {
				void notifications.showError(`Could not enable ${saas}`);
				return;
			}
			void notifications.showSuccess(`${saas} enabled for orchestration`);
			await this._afterChange();
		}
	}

	private async _handleDisconnect(platformId: string): Promise<void> {
		if (llmKeyProvider(platformId)) {
			await this._handleConfigure(platformId);
			return;
		}
		const mcpServerId = mcpServerIdForPlatform(platformId);
		if (!isLivePlatform(platformId) && !mcpServerId) {
			return;
		}
		const notifications = getNotificationService();
		const client = getBackendClient();
		try {
			// Clear the MCP sign-in first; GitHub and Vercel also keep an older
			// per-connector token that orchestration uses, so drop both.
			if (mcpServerId) {
				await disconnectMcpServer(mcpServerId);
				this.mcpConnections = { ...this.mcpConnections, [mcpServerId]: false };
			}
			if (platformId === 'github') {
				await client.disconnectGitHub('default');
			} else if (platformId === 'vercel') {
				await client.disconnectVercel('default');
			} else if (!mcpServerId) {
				const saas = this._saasId(platformId);
				if (!saas) {
					await this._handleConfigure(platformId);
					return;
				}
				await client.disconnectSaasConnector(saas, 'default');
			}
			void notifications.showSuccess(`${platformId} disconnected`);
			await this._afterChange();
		} catch (error) {
			void notifications.showError(
				`Disconnect failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
	}

	private async _connectOAuth(provider: OAuthProvider): Promise<void> {
		const notifications = getNotificationService();
		const outcome = await startOAuthConnect(provider);
		if (outcome.status === 'needs_setup') {
			// Never open the vendor page without a client id: show the one-time step instead.
			this.oauthApps = { ...this.oauthApps, [provider]: false };
			this._applyCapabilities(getCachedCapabilities());
			this._pushState();
			await this._openSettings(provider);
			return;
		}
		if (outcome.status === 'error') {
			void notifications.showError(outcome.message);
			return;
		}
		this.oauthApps = { ...this.oauthApps, [provider]: true };
		void notifications.showInfo(
			`Finish ${oauthProviderLabel(provider)} sign-in in your browser. This row updates when it completes.`
		);
	}

	private _groupByCategory(): Record<string, Platform[]> {
		const acc: Record<string, Platform[]> = {};
		for (const p of this.platforms) {
			const cat = p.category || 'Other';
			if (!acc[cat]) {
				acc[cat] = [];
			}
			acc[cat].push(p);
		}
		return acc;
	}

	private _categoriesPayload(): { category: string; platforms: Platform[] }[] {
		return Object.entries(this._groupByCategory())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([category, platforms]) => ({ category, platforms }));
	}
}
