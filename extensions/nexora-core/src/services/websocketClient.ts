/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import WebSocket from 'ws';
import { getBackendClient } from './backendClient';

export interface WebSocketMessage {
	type: string;
	plan_id?: string;
	task_id?: string;
	task_name?: string;
	status?: string;
	result?: unknown;
	error?: string;
	cost?: number;
	actual_cost?: number;
	attempt?: number;
	max_attempts?: number;
	platform?: string;
	operation?: string;
	platforms_tried?: string[];
	total_attempts?: number;
	message?: string;
	started_at?: string;
	completed_at?: string;
	duration_ms?: number;
}

export type MessageCallback = (message: WebSocketMessage) => void;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export class OrchestrationWebSocket {
	private ws: WebSocket | null = null;
	private userId: string;
	private baseUrl: string;
	private reconnectAttempts = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private intentionalDisconnect = false;
	private callbacks: MessageCallback[] = [];
	private subscribedPlans: Set<string> = new Set();

	constructor(userId: string = 'default', baseUrl: string = 'ws://127.0.0.1:8000') {
		this.userId = userId;
		this.baseUrl = baseUrl;
	}

	connect(): Promise<boolean> {
		this.intentionalDisconnect = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.isConnected()) {
			return Promise.resolve(true);
		}
		if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
			return new Promise((resolve) => {
				const existing = this.ws;
				if (!existing) {
					resolve(false);
					return;
				}
				const onOpen = () => resolve(true);
				const onFail = () => resolve(false);
				existing.once('open', onOpen);
				existing.once('close', onFail);
				existing.once('error', onFail);
			});
		}

		return new Promise((resolve) => {
			let settled = false;
			const finish = (ok: boolean) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(ok);
			};

			try {
				const url = `${this.baseUrl}/api/orchestrate/ws/${this.userId}`;
				this.ws = new WebSocket(url);

				this.ws.on('open', () => {
					console.log('[Nexora WS] Connected');
					this.reconnectAttempts = 0;

					// Resubscribe to plans
					this.subscribedPlans.forEach(planId => {
						this.subscribeToPlan(planId);
					});
					void this.resyncSubscribedPlans();

					finish(true);
				});

				this.ws.on('message', (data: WebSocket.Data) => {
					try {
						const message: WebSocketMessage = JSON.parse(data.toString());
						this.notifyCallbacks(message);
					} catch (e) {
						console.error('[Nexora WS] Failed to parse message:', e);
					}
				});

				this.ws.on('error', (error: Error) => {
					console.error('[Nexora WS] Error:', error.message);
				});

				this.ws.on('close', () => {
					console.log('[Nexora WS] Disconnected');
					this.ws = null;
					if (!this.intentionalDisconnect) {
						this.scheduleReconnect();
					}
				});

				setTimeout(() => {
					if (this.ws?.readyState !== WebSocket.OPEN) {
						finish(false);
					}
				}, 5000);

			} catch (e) {
				console.error('[Nexora WS] Connection failed:', e);
				finish(false);
				if (!this.intentionalDisconnect) {
					this.scheduleReconnect();
				}
			}
		});
	}

	disconnect(): void {
		this.intentionalDisconnect = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.callbacks = [];
		this.subscribedPlans.clear();
	}

	isConnected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	subscribeToPlan(planId: string): void {
		this.subscribedPlans.add(planId);

		if (this.isConnected() && this.ws) {
			this.ws.send(JSON.stringify({
				type: 'subscribe_plan',
				plan_id: planId
			}));
		}
	}

	unsubscribeFromPlan(planId: string): void {
		this.subscribedPlans.delete(planId);
	}

	onMessage(callback: MessageCallback): () => void {
		this.callbacks.push(callback);

		return () => {
			const index = this.callbacks.indexOf(callback);
			if (index > -1) {
				this.callbacks.splice(index, 1);
			}
		};
	}

	private scheduleReconnect(): void {
		if (this.intentionalDisconnect || this.reconnectTimer) {
			return;
		}
		const delay = Math.min(
			RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
			RECONNECT_MAX_MS
		);
		this.reconnectAttempts += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			void this.connect();
		}, delay);
	}

	private async resyncSubscribedPlans(): Promise<void> {
		const planIds = Array.from(this.subscribedPlans);
		if (planIds.length === 0) {
			return;
		}
		const client = getBackendClient();
		await Promise.all(planIds.map(async (planId) => {
			try {
				const plan = await client.getPlan(planId);
				if (!plan || plan.plan_id !== planId) {
					return;
				}
				this.notifyCallbacks({
					type: 'plan_snapshot',
					plan_id: planId,
					status: typeof plan.status === 'string' ? plan.status : undefined,
					result: plan
				});
			} catch (e) {
				console.error('[Nexora WS] Plan resync failed:', planId, e);
			}
		}));
	}

	private notifyCallbacks(message: WebSocketMessage): void {
		this.callbacks.forEach(cb => {
			try {
				cb(message);
			} catch (e) {
				console.error('[Nexora WS] Callback error:', e);
			}
		});
	}
}

// Singleton instance
let wsInstance: OrchestrationWebSocket | null = null;

export function getOrchestrationWebSocket(userId: string = 'default'): OrchestrationWebSocket {
	if (!wsInstance || wsInstance['userId'] !== userId) {
		wsInstance = new OrchestrationWebSocket(userId);
	}
	return wsInstance;
}

export function disposeWebSocket(): void {
	if (wsInstance) {
		wsInstance.disconnect();
		wsInstance = null;
	}
}
