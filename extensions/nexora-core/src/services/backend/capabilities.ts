/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getEngineState, onDidChangeEngineState } from '../engineProcess';
import type { Transport } from './transport';

/** Frozen four-state vocabulary from GET /api/capabilities. Never display secret values. */
export type CapabilityStatus = 'ready' | 'not_configured' | 'unavailable' | 'failed';

export interface CapabilitiesReport {
	engine: { frozen: boolean; version: string; nexora_home: string };
	database: { backend: string; status: CapabilityStatus; platforms_seeded: number };
	vectors: {
		mode: string;
		status: CapabilityStatus;
		platforms_embedded: number;
		embedding_in_progress: boolean;
	};
	memory: { search: string; workspaces_indexed: number };
	llm: {
		openai: CapabilityStatus;
		anthropic: CapabilityStatus;
		openrouter: CapabilityStatus;
	};
	connectors: {
		github: CapabilityStatus;
		vercel: CapabilityStatus;
		crewai: CapabilityStatus;
		gpt_researcher: CapabilityStatus;
	};
	mcp: { configured: number; connected: number };
}

const STATUSES: CapabilityStatus[] = ['ready', 'not_configured', 'unavailable', 'failed'];
const EMBEDDING_POLL_MS = 3000;
const FETCH_RETRY_MS = 400;
const FETCH_RETRY_MAX = 5;

function asStatus(value: unknown, fallback: CapabilityStatus = 'not_configured'): CapabilityStatus {
	if (typeof value === 'string' && (STATUSES as string[]).includes(value)) {
		return value as CapabilityStatus;
	}
	return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

/** Normalize live JSON so missing fields cannot crash the UI. */
export function normalizeCapabilities(raw: unknown): CapabilitiesReport {
	const r = (raw && typeof raw === 'object') ? raw as Record<string, any> : {};
	const engine = r.engine || {};
	const database = r.database || {};
	const vectors = r.vectors || {};
	const memory = r.memory || {};
	const llm = r.llm || {};
	const connectors = r.connectors || {};
	const mcp = r.mcp || {};
	return {
		engine: {
			frozen: asBool(engine.frozen),
			version: asString(engine.version, '0.0.0'),
			nexora_home: asString(engine.nexora_home)
		},
		database: {
			backend: asString(database.backend, 'unknown'),
			status: asStatus(database.status, 'failed'),
			platforms_seeded: asNumber(database.platforms_seeded)
		},
		vectors: {
			mode: asString(vectors.mode, 'local'),
			status: asStatus(vectors.status, 'failed'),
			platforms_embedded: asNumber(vectors.platforms_embedded),
			embedding_in_progress: asBool(vectors.embedding_in_progress)
		},
		memory: {
			search: asString(memory.search, 'keyword'),
			workspaces_indexed: asNumber(memory.workspaces_indexed)
		},
		llm: {
			openai: asStatus(llm.openai),
			anthropic: asStatus(llm.anthropic),
			openrouter: asStatus(llm.openrouter)
		},
		connectors: {
			github: asStatus(connectors.github),
			vercel: asStatus(connectors.vercel),
			crewai: asStatus(connectors.crewai, 'unavailable'),
			gpt_researcher: asStatus(connectors.gpt_researcher, 'unavailable')
		},
		mcp: {
			configured: asNumber(mcp.configured),
			connected: asNumber(mcp.connected)
		}
	};
}

export function createCapabilitiesApi(transport: Transport) {
	return {
		getCapabilities: async (): Promise<CapabilitiesReport> => {
			const raw = await transport.get('/api/capabilities');
			return normalizeCapabilities(raw);
		}
	};
}

const changeEmitter = new vscode.EventEmitter<CapabilitiesReport | undefined>();
export const onDidChangeCapabilities = changeEmitter.event;

let cached: CapabilitiesReport | undefined;
let refreshInFlight: Promise<CapabilitiesReport | undefined> | undefined;
let embeddingPoll: ReturnType<typeof setTimeout> | undefined;
let watcherStarted = false;

export function getCachedCapabilities(): CapabilitiesReport | undefined {
	return cached;
}

export function allLlmNotConfigured(report: CapabilitiesReport | undefined): boolean {
	if (!report) {
		return false;
	}
	return report.llm.openai === 'not_configured'
		&& report.llm.anthropic === 'not_configured'
		&& report.llm.openrouter === 'not_configured';
}

export function capabilityLabel(status: CapabilityStatus): string {
	switch (status) {
		case 'ready':
			return 'Ready';
		case 'not_configured':
			return 'Not configured';
		case 'unavailable':
			return 'Unavailable';
		case 'failed':
			return 'Failed';
	}
}

export function capabilityReason(status: CapabilityStatus): string {
	switch (status) {
		case 'not_configured':
			return 'Not configured - add a key or connect in Settings';
		case 'unavailable':
			return 'Unavailable in this build';
		case 'failed':
			return 'Failed - check Settings';
		case 'ready':
			return '';
	}
}

/** Map a platform catalog id to llm.* or connectors.* when capabilities reports it. */
export function platformCapabilityStatus(
	platformId: string,
	report: CapabilitiesReport | undefined
): CapabilityStatus | undefined {
	if (!report) {
		return undefined;
	}
	const id = (platformId || '').trim().toLowerCase();
	const llmKeys: Record<string, keyof CapabilitiesReport['llm']> = {
		openai: 'openai',
		openrouter: 'openrouter',
		anthropic: 'anthropic',
		claude: 'anthropic',
		'claude-code': 'anthropic'
	};
	const connectorKeys: Record<string, keyof CapabilitiesReport['connectors']> = {
		github: 'github',
		vercel: 'vercel',
		crewai: 'crewai',
		'gpt-researcher': 'gpt_researcher',
		gpt_researcher: 'gpt_researcher'
	};
	if (llmKeys[id]) {
		return report.llm[llmKeys[id]];
	}
	if (connectorKeys[id]) {
		return report.connectors[connectorKeys[id]];
	}
	return undefined;
}

function clearEmbeddingPoll(): void {
	if (embeddingPoll) {
		clearTimeout(embeddingPoll);
		embeddingPoll = undefined;
	}
}

function scheduleEmbeddingPoll(report: CapabilitiesReport | undefined): void {
	clearEmbeddingPoll();
	if (report?.vectors.embedding_in_progress && getEngineState() === 'ready') {
		embeddingPoll = setTimeout(() => {
			void refreshCapabilities();
		}, EMBEDDING_POLL_MS);
	}
}

async function fetchOnce(): Promise<CapabilitiesReport> {
	const { getBackendClient } = await import('../backendClient');
	return getBackendClient().getCapabilities();
}

async function isTokenizedClientReady(): Promise<boolean> {
	const { isBackendClientConfigured } = await import('../backendClient');
	return isBackendClientConfigured();
}

/**
 * Fetch /api/capabilities, cache it, and notify listeners.
 * Waits for engine ready AND the tokenized BackendClient so first paint
 * cannot 401. Retries cover transient network errors only.
 */
export async function refreshCapabilities(): Promise<CapabilitiesReport | undefined> {
	if (getEngineState() !== 'ready') {
		cached = undefined;
		changeEmitter.fire(undefined);
		clearEmbeddingPoll();
		return undefined;
	}
	if (!(await isTokenizedClientReady())) {
		return undefined;
	}
	if (refreshInFlight) {
		return refreshInFlight;
	}
	refreshInFlight = (async () => {
		let lastError: unknown;
		for (let attempt = 0; attempt < FETCH_RETRY_MAX; attempt++) {
			if (getEngineState() !== 'ready') {
				cached = undefined;
				changeEmitter.fire(undefined);
				clearEmbeddingPoll();
				return undefined;
			}
			if (!(await isTokenizedClientReady())) {
				return undefined;
			}
			try {
				const report = await fetchOnce();
				cached = report;
				changeEmitter.fire(report);
				scheduleEmbeddingPoll(report);
				return report;
			} catch (error) {
				lastError = error;
				await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_MS));
			}
		}
		console.warn('[Nexora] Failed to fetch /api/capabilities', lastError);
		return cached;
	})();
	try {
		return await refreshInFlight;
	} finally {
		refreshInFlight = undefined;
	}
}

function startCapabilitiesWatcher(): void {
	if (watcherStarted) {
		return;
	}
	watcherStarted = true;
	onDidChangeEngineState((state) => {
		if (state === 'ready') {
			void refreshCapabilities();
			return;
		}
		clearEmbeddingPoll();
		cached = undefined;
		changeEmitter.fire(undefined);
	});
	void import('../backendClient').then((backend) => {
		backend.onDidConfigureBackendClient(() => {
			if (getEngineState() === 'ready') {
				void refreshCapabilities();
			}
		});
		if (getEngineState() === 'ready' && backend.isBackendClientConfigured()) {
			void refreshCapabilities();
		}
	});
}

startCapabilitiesWatcher();
