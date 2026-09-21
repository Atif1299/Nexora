/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

export type ModelProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter';
export type ModelTier = 'free' | 'paid';

export interface CatalogModel {
	id: string;
	label: string;
	context?: number;
	tier: ModelTier;
	recommended?: boolean;
}

export interface CatalogProvider {
	id: ModelProviderId;
	label: string;
	configured: boolean;
	models: CatalogModel[];
}

export interface ModelCatalogAuto {
	id: 'auto';
	label: string;
	resolves_to: string;
}

export interface ModelCatalog {
	auto: ModelCatalogAuto;
	providers: CatalogProvider[];
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBool(value: unknown, fallback = false): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function normalizeTier(value: unknown): ModelTier {
	return value === 'free' ? 'free' : 'paid';
}

function normalizeProviderId(value: unknown): ModelProviderId | undefined {
	if (value === 'openai' || value === 'anthropic' || value === 'gemini' || value === 'openrouter') {
		return value;
	}
	return undefined;
}

function normalizeModel(raw: unknown): CatalogModel | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const m = raw as Record<string, unknown>;
	const id = asString(m.id).trim();
	const label = asString(m.label).trim();
	if (!id || !label) {
		return undefined;
	}
	const model: CatalogModel = {
		id,
		label,
		tier: normalizeTier(m.tier),
		recommended: asBool(m.recommended)
	};
	const context = asNumber(m.context);
	if (context !== undefined) {
		model.context = context;
	}
	return model;
}

/** Normalize catalog JSON so missing fields cannot crash the UI. */
export function normalizeModelCatalog(raw: unknown): ModelCatalog {
	const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
	const autoRaw = (r.auto && typeof r.auto === 'object') ? r.auto as Record<string, unknown> : {};
	const providersRaw = Array.isArray(r.providers) ? r.providers : [];

	const providers: CatalogProvider[] = [];
	for (const entry of providersRaw) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const p = entry as Record<string, unknown>;
		const id = normalizeProviderId(p.id);
		if (!id) {
			continue;
		}
		const models: CatalogModel[] = [];
		const modelsRaw = Array.isArray(p.models) ? p.models : [];
		for (const modelRaw of modelsRaw) {
			const model = normalizeModel(modelRaw);
			if (model) {
				models.push(model);
			}
		}
		providers.push({
			id,
			label: asString(p.label, id),
			configured: asBool(p.configured),
			models
		});
	}

	return {
		auto: {
			id: 'auto',
			label: asString(autoRaw.label, 'Auto') || 'Auto',
			resolves_to: asString(autoRaw.resolves_to, 'openrouter/openrouter/free')
		},
		providers
	};
}

export function createModelsApi(transport: Transport) {
	return {
		getModelCatalog: async (refresh = false): Promise<ModelCatalog> => {
			const qs = refresh ? '?refresh=1' : '';
			const raw = await transport.get(`/api/models/catalog${qs}`);
			return normalizeModelCatalog(raw);
		}
	};
}
