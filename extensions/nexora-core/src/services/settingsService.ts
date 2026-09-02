/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export type ApiKeyProvider = 'openai' | 'anthropic' | 'openrouter';

export interface NexoraPreferences {
	defaultModel: string;
	autoIndexWorkspace: boolean;
	showCostEstimates: boolean;
	theme: 'auto' | 'light' | 'dark';
}

const PREFERENCES_KEY = 'nexora.preferences';
const DEFAULT_PREFERENCES: NexoraPreferences = {
	defaultModel: 'openrouter/openrouter/free',
	autoIndexWorkspace: true,
	showCostEstimates: true,
	theme: 'auto'
};

const PROVIDERS: ApiKeyProvider[] = ['openai', 'anthropic', 'openrouter'];

/**
 * Settings storage for Week 12 (product model).
 * - API keys: VS Code SecretStorage (never globalState)
 * - Preferences: globalState
 * - Runtime: extension sends keys as X-Nexora-*-Key headers; backend .env is fallback
 */
export class SettingsService {
	constructor(private readonly context: vscode.ExtensionContext) { }

	private secretKey(provider: ApiKeyProvider): string {
		return `nexora.${provider}.key`;
	}

	async setApiKey(provider: ApiKeyProvider, key: string): Promise<void> {
		const trimmed = key.trim();
		if (!trimmed) {
			throw new Error('API key cannot be empty');
		}
		await this.context.secrets.store(this.secretKey(provider), trimmed);
	}

	async getApiKey(provider: ApiKeyProvider): Promise<string | undefined> {
		return this.context.secrets.get(this.secretKey(provider));
	}

	async deleteApiKey(provider: ApiKeyProvider): Promise<void> {
		await this.context.secrets.delete(this.secretKey(provider));
	}

	async hasApiKey(provider: ApiKeyProvider): Promise<boolean> {
		const key = await this.getApiKey(provider);
		return !!key;
	}

	/** Masked preview for UI: bullets only, never a key fragment. */
	async getApiKeyMask(provider: ApiKeyProvider): Promise<string | null> {
		if (!(await this.hasApiKey(provider))) {
			return null;
		}
		return '••••••••';
	}

	async getConfiguredKeyProviders(): Promise<Record<ApiKeyProvider, boolean>> {
		const result: Record<ApiKeyProvider, boolean> = {
			openai: false,
			anthropic: false,
			openrouter: false
		};
		for (const provider of PROVIDERS) {
			result[provider] = await this.hasApiKey(provider);
		}
		return result;
	}

	getPreferences(): NexoraPreferences {
		const stored = this.context.globalState.get<Partial<NexoraPreferences>>(PREFERENCES_KEY, {});
		return { ...DEFAULT_PREFERENCES, ...stored };
	}

	async setPreferences(prefs: Partial<NexoraPreferences>): Promise<NexoraPreferences> {
		const next = { ...this.getPreferences(), ...prefs };
		await this.context.globalState.update(PREFERENCES_KEY, next);
		return next;
	}

	async setPreference<K extends keyof NexoraPreferences>(
		key: K,
		value: NexoraPreferences[K]
	): Promise<NexoraPreferences> {
		const prefs: Partial<NexoraPreferences> = {};
		prefs[key] = value;
		return this.setPreferences(prefs);
	}
}

let _instance: SettingsService | undefined;

export function getSettingsService(context?: vscode.ExtensionContext): SettingsService {
	if (!_instance) {
		if (!context) {
			throw new Error('SettingsService not initialized - pass ExtensionContext on first call');
		}
		_instance = new SettingsService(context);
	}
	return _instance;
}
