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
import type { SaasConnector } from './services/backend/auth';

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

	constructor(extensionUri: vscode.Uri) {
		this._extensionUri = extensionUri;
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

			const platformsData = await client.getPlatforms() as PlatformApiRow[];
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
					this._pushState();
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
		const live = isLivePlatform(id);
		const status = live ? platformCapabilityStatus(id, report) : undefined;
		const blocked = live && isBlockedStatus(status);
		return {
			id,
			name: p.name || id,
			category: p.category || 'Other',
			description: p.description,
			capabilities: p.capabilities,
			api_type: p.api_type,
			auth_type: p.auth_type,
			has_active_connector: live && status === 'ready',
			is_enabled: blocked ? false : p.is_enabled !== false,
			capabilityStatus: status,
			capabilityReason: status ? capabilityReason(status) : undefined,
			live
		};
	}

	private _applyCapabilities(report: CapabilitiesReport | undefined): void {
		this.embeddingInProgress = !!report?.vectors.embedding_in_progress;
		this.platforms = this.platforms.map(p => {
			const live = isLivePlatform(p.id);
			const status = live ? platformCapabilityStatus(p.id, report) : undefined;
			const blocked = live && isBlockedStatus(status);
			return {
				...p,
				live,
				capabilityStatus: status,
				capabilityReason: status ? capabilityReason(status) : undefined,
				has_active_connector: live && status === 'ready',
				is_enabled: blocked ? false : p.is_enabled !== false
			};
		});
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
		if (!isLivePlatform(platformId)) {
			return;
		}
		if (platformId === 'openai' || platformId === 'claude') {
			await this._openSettings(platformId === 'claude' ? 'anthropic' : 'openai');
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

	private async _handleConnect(platformId: string): Promise<void> {
		if (!isLivePlatform(platformId)) {
			return;
		}
		const notifications = getNotificationService();
		const status = platformCapabilityStatus(platformId, getCachedCapabilities());
		if (status === 'unavailable') {
			void notifications.showWarning(`${platformId} is unavailable in this build`);
			return;
		}
		if (platformId === 'openai' || platformId === 'claude' || platformId === 'crewai' || platformId === 'gpt-researcher') {
			await this._handleConfigure(platformId);
			return;
		}
		if (platformId === 'github' || platformId === 'vercel') {
			await this._connectOAuth(platformId);
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
		if (!isLivePlatform(platformId)) {
			return;
		}
		const notifications = getNotificationService();
		const client = getBackendClient();
		try {
			if (platformId === 'github') {
				await client.disconnectGitHub('default');
			} else if (platformId === 'vercel') {
				await client.disconnectVercel('default');
			} else {
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

	private async _connectOAuth(provider: 'github' | 'vercel'): Promise<void> {
		const client = getBackendClient();
		const notifications = getNotificationService();
		try {
			const result = provider === 'github'
				? await client.getGitHubAuthUrl('default')
				: await client.getVercelAuthUrl('default');
			if (!result?.authorization_url) {
				void notifications.showError(`Could not start ${provider} OAuth. Check backend .env client IDs.`);
				return;
			}
			await vscode.env.openExternal(vscode.Uri.parse(result.authorization_url));
			void notifications.showInfo(`Complete ${provider} login in the browser, then Refresh`);
			setTimeout(() => {
				void this._afterChange();
			}, 8000);
		} catch (error) {
			void notifications.showError(
				`OAuth failed: ${error instanceof Error ? error.message : 'Unknown error'}`
			);
		}
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
