/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BackendConfig } from '../backendClient';

/**
 * When true, GET failures rethrow instead of returning mock data.
 * Permanent: an unreachable engine must look unreachable.
 */
export const STRICT_BACKEND = true;

export type SSEEvent = {
	type: string;
	content?: string;
	tool_calls?: Array<{ id: string; name: string; arguments: Record<string, any> }>;
	model_used?: string;
	model?: string;
	message?: string;
	usage?: { prompt_tokens: number; completion_tokens: number };
};

export type Transport = {
	get: (endpoint: string) => Promise<any>;
	/**
	 * GET that rejects instead of falling back to a mock response.
	 */
	getStrict: (endpoint: string) => Promise<any>;
	post: (endpoint: string, data: any, timeoutMs?: number, signal?: AbortSignal) => Promise<any>;
	postStream: (endpoint: string, data: any, signal?: AbortSignal, timeoutMs?: number) => AsyncIterable<SSEEvent>;
	put: (endpoint: string, data?: any) => Promise<any>;
	delete: (endpoint: string) => Promise<any>;
};

/** User-initiated abort of an in-flight backend request (not a timeout). */
export class RequestCancelledError extends Error {
	constructor(message = 'Request cancelled') {
		super(message);
		this.name = 'RequestCancelledError';
	}
}

async function errorFromHttpResponse(response: Response): Promise<Error> {
	try {
		const body = await response.json() as { detail?: unknown };
		if (typeof body?.detail === 'string' && body.detail.trim()) {
			return new Error(body.detail);
		}
	} catch {
		// body was not JSON
	}
	return new Error(`HTTP ${response.status}`);
}

export function isRequestCancelled(error: unknown): boolean {
	return error instanceof RequestCancelledError
		|| (error instanceof Error && error.name === 'RequestCancelledError');
}

function parseSseBlock(block: string): SSEEvent | null {
	const lines = block.replace(/\r\n/g, '\n').split('\n');
	const dataLines: string[] = [];
	for (const line of lines) {
		if (line.startsWith('data:')) {
			dataLines.push(line.slice(5).trim());
		}
	}
	if (dataLines.length === 0) {
		return null;
	}
	const raw = dataLines.join('\n');
	if (!raw) {
		return null;
	}
	if (raw === '[DONE]') {
		return { type: 'done' };
	}
	try {
		return JSON.parse(raw) as SSEEvent;
	} catch {
		return null;
	}
}

function pullSseEvents(buffer: string): { events: SSEEvent[]; rest: string } {
	const normalized = buffer.replace(/\r\n/g, '\n');
	const parts = normalized.split('\n\n');
	const rest = parts.pop() || '';
	const events: SSEEvent[] = [];
	for (const part of parts) {
		const ev = parseSseBlock(part);
		if (ev) {
			events.push(ev);
		}
	}
	return { events, rest };
}

/** Optional async provider for IDE SecretStorage API key headers. */
export type HeaderProvider = () => Promise<Record<string, string>>;

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
	userSignal?: AbortSignal
): Promise<Response> {
	if (userSignal?.aborted) {
		throw new RequestCancelledError();
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onUserAbort = () => controller.abort();
	if (userSignal) {
		userSignal.addEventListener('abort', onUserAbort);
	}
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			if (userSignal?.aborted) {
				throw new RequestCancelledError();
			}
			throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
		}
		throw error;
	} finally {
		clearTimeout(timer);
		if (userSignal) {
			userSignal.removeEventListener('abort', onUserAbort);
		}
	}
}

export function createTransport(
	config: BackendConfig,
	getExtraHeaders?: HeaderProvider
): Transport {
	async function buildHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		if (config.localToken) {
			headers['X-Nexora-Local-Token'] = config.localToken;
		}
		if (getExtraHeaders) {
			try {
				const extra = await getExtraHeaders();
				if (extra) {
					for (const [key, value] of Object.entries(extra)) {
						if (value) {
							headers[key] = value;
						}
					}
				}
			} catch {
				// Settings not ready - continue without IDE keys (.env fallback on backend)
			}
		}
		return headers;
	}

	async function getJson(endpoint: string): Promise<any> {
		const url = `${config.baseUrl}${endpoint}`;
		const response = await fetchWithTimeout(url, {
			method: 'GET',
			headers: await buildHeaders()
		}, config.timeout);

		if (!response.ok) {
			throw await errorFromHttpResponse(response);
		}

		return await response.json();
	}

	return {
		get: getJson,
		getStrict: getJson,
		post: async (endpoint: string, data: any, timeoutMs?: number, signal?: AbortSignal) => {
			const url = `${config.baseUrl}${endpoint}`;

			const response = await fetchWithTimeout(url, {
				method: 'POST',
				headers: await buildHeaders(),
				body: JSON.stringify(data)
			}, timeoutMs ?? config.timeout, signal);

			if (!response.ok) {
				throw await errorFromHttpResponse(response);
			}

			return await response.json();
		},
		postStream: async function* (
			endpoint: string,
			data: any,
			signal?: AbortSignal,
			timeoutMs?: number
		): AsyncGenerator<SSEEvent> {
			const url = `${config.baseUrl}${endpoint}`;
			const timeout = timeoutMs ?? config.timeout;
			if (signal?.aborted) {
				throw new RequestCancelledError();
			}

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeout);
			const onUserAbort = () => controller.abort();
			if (signal) {
				signal.addEventListener('abort', onUserAbort);
			}

			const headers = await buildHeaders();
			headers['Accept'] = 'text/event-stream';

			try {
				let response: Response;
				try {
					response = await fetch(url, {
						method: 'POST',
						headers,
						body: JSON.stringify(data),
						signal: controller.signal
					});
				} catch (error) {
					if (error instanceof Error && error.name === 'AbortError') {
						if (signal?.aborted) {
							throw new RequestCancelledError();
						}
						throw new Error(`Request timed out after ${timeout}ms: ${url}`);
					}
					throw error;
				}

				clearTimeout(timer);

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				const body = response.body as { getReader?: () => { read(): Promise<{ done: boolean; value?: Uint8Array }>; releaseLock(): void } } | null;
				if (!body || typeof body.getReader !== 'function') {
					throw new Error('Streaming response had no readable body');
				}

				const reader = body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';
				try {
					while (true) {
						let chunk: { done: boolean; value?: Uint8Array };
						try {
							chunk = await reader.read();
						} catch (error) {
							if (error instanceof Error && error.name === 'AbortError') {
								throw new RequestCancelledError();
							}
							if (signal?.aborted) {
								throw new RequestCancelledError();
							}
							throw error;
						}
						if (chunk.done) {
							break;
						}
						buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: true });
						const pulled = pullSseEvents(buffer);
						buffer = pulled.rest;
						for (const ev of pulled.events) {
							yield ev;
						}
					}
					buffer += decoder.decode();
					const pulled = pullSseEvents(buffer.endsWith('\n\n') ? buffer : buffer + '\n\n');
					for (const ev of pulled.events) {
						yield ev;
					}
				} finally {
					reader.releaseLock();
				}
			} finally {
				clearTimeout(timer);
				if (signal) {
					signal.removeEventListener('abort', onUserAbort);
				}
			}
		},
		put: async (endpoint: string, data?: any) => {
			const url = `${config.baseUrl}${endpoint}`;

			const response = await fetchWithTimeout(url, {
				method: 'PUT',
				headers: await buildHeaders(),
				body: data ? JSON.stringify(data) : undefined
			}, config.timeout);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return await response.json();
		},
		delete: async (endpoint: string) => {
			const url = `${config.baseUrl}${endpoint}`;

			const response = await fetchWithTimeout(url, {
				method: 'DELETE',
				headers: await buildHeaders()
			}, config.timeout);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return await response.json();
		}
	};
}
