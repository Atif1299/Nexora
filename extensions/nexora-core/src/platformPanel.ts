/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getPlatformsWebviewHtml } from './webview/platforms';
import { getBackendClient } from './services/backendClient';
import { getEngineState, onDidChangeEngineState } from './services/engineProcess';
import {
	capabilityReason,
	getCachedCapabilities,
	onDidChangeCapabilities,
	platformCapabilityStatus,
	refreshCapabilities,
	type CapabilitiesReport,
	type CapabilityStatus
} from './services/backend/capabilities';

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
		onDidChangeCapabilities((report) => {
			this._applyCapabilities(report);
			this._pushState();
			if (report?.vectors.embedding_in_progress === false && this.platforms.length === 0 && getEngineState() === 'ready') {
				void this.loadPlatforms();
			}
		});
		if (getEngineState() === 'ready') {
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
		if (getEngineState() !== 'ready') {
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
			view.webview.onDidReceiveMessage(async (msg: { type?: string }) => {
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
		const status = platformCapabilityStatus(id, report);
		const blocked = isBlockedStatus(status);
		return {
			id,
			name: p.name || id,
			category: p.category || 'Other',
			description: p.description,
			capabilities: p.capabilities,
			api_type: p.api_type,
			auth_type: p.auth_type,
			has_active_connector: blocked ? false : p.has_active_connector,
			is_enabled: blocked ? false : p.is_enabled !== false,
			capabilityStatus: status,
			capabilityReason: status ? capabilityReason(status) : undefined
		};
	}

	private _applyCapabilities(report: CapabilitiesReport | undefined): void {
		this.embeddingInProgress = !!report?.vectors.embedding_in_progress;
		this.platforms = this.platforms.map(p => {
			const status = platformCapabilityStatus(p.id, report);
			const blocked = isBlockedStatus(status);
			return {
				...p,
				capabilityStatus: status,
				capabilityReason: status ? capabilityReason(status) : undefined,
				has_active_connector: blocked ? false : p.has_active_connector,
				is_enabled: blocked ? false : p.is_enabled !== false
			};
		});
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
