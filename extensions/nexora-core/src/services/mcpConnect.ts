/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getBackendClient } from './backendClient';
import { getNotificationService } from './notificationService';
import type { McpConnectOutcome } from './backend/mcpConnect';

/**
 * Connect flow for remote MCP servers, shared by the platform sidebar and chat.
 *
 * The engine owns discovery, registration and tokens. This module only reacts
 * to the outcome it reports: open a browser, show a device code, or say that a
 * one-time setup is still missing. No credential ever passes through here.
 */

const LABELS: Record<string, string> = {
	github: 'GitHub',
	vercel: 'Vercel',
	stripe: 'Stripe',
	supabase: 'Supabase',
	v0: 'v0',
	clerk: 'Clerk',
	linear: 'Linear',
	notion: 'Notion',
	sentry: 'Sentry',
	asana: 'Asana',
	paypal: 'PayPal',
	cloudflare: 'Cloudflare',
	canva: 'Canva'
};

const DEVICE_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const BROWSER_POLL_MS = 3000;
const BROWSER_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export type McpConnectResult =
	| { status: 'connected' }
	| { status: 'started' }
	| { status: 'needs_setup'; message: string }
	| { status: 'error'; message: string }
	| { status: 'cancelled' };

const connectedEmitter = new vscode.EventEmitter<string>();
/** Fires with the MCP server id once the engine reports it connected. */
export const onDidConnectMcpServer = connectedEmitter.event;

let extensionId: string | undefined;
const browserWatchers = new Map<string, ReturnType<typeof setInterval>>();

export function mcpServerLabel(serverId: string): string {
	return LABELS[serverId] || serverId;
}

export function registerMcpConnect(context: vscode.ExtensionContext): void {
	extensionId = context.extension.id;
	context.subscriptions.push(connectedEmitter, {
		dispose: () => {
			for (const timer of browserWatchers.values()) {
				clearInterval(timer);
			}
			browserWatchers.clear();
		}
	});
}

async function returnUri(serverId: string): Promise<string | undefined> {
	if (!extensionId) {
		return undefined;
	}
	try {
		const uri = vscode.Uri.parse(
			`${vscode.env.uriScheme}://${extensionId}/oauth-complete?mcp=${encodeURIComponent(serverId)}`
		);
		return (await vscode.env.asExternalUri(uri)).toString(true);
	} catch {
		return undefined;
	}
}

/** The engine's view of which MCP servers are connected, keyed by server id. */
export async function getMcpConnections(): Promise<Record<string, boolean>> {
	const rows = await getBackendClient().getMcpConnectStatus();
	return Object.fromEntries(rows.map(row => [row.id, row.connected]));
}

export async function disconnectMcpServer(serverId: string): Promise<void> {
	await getBackendClient().disconnectMcpConnect(serverId);
}

/**
 * Connect one MCP server. Returns as soon as the user has somewhere to go;
 * completion arrives later through {@link onDidConnectMcpServer}.
 */
export async function connectMcpServer(serverId: string): Promise<McpConnectResult> {
	const client = getBackendClient();
	let outcome: McpConnectOutcome;
	try {
		outcome = await client.connectMcpConnect(serverId, await returnUri(serverId));
	} catch (error) {
		return { status: 'error', message: errorText(error, serverId) };
	}

	switch (outcome.status) {
		case 'connected':
			connectedEmitter.fire(serverId);
			return { status: 'connected' };

		case 'needs_setup':
			return { status: 'needs_setup', message: outcome.message };

		case 'browser': {
			const opened = await vscode.env.openExternal(
				vscode.Uri.parse(outcome.authorization_url)
			);
			if (!opened) {
				return {
					status: 'error',
					message: `Could not open the browser for ${mcpServerLabel(serverId)} sign-in.`
				};
			}
			watchBrowserSignIn(serverId);
			return { status: 'started' };
		}

		case 'device':
			return await runDeviceFlow(serverId, outcome);

		default:
			return { status: 'error', message: 'The engine returned an unexpected response.' };
	}
}

/**
 * Device flow: the user types a short code on the vendor's site. The code is
 * copied to the clipboard first, because typing it from a toast is miserable.
 */
async function runDeviceFlow(
	serverId: string,
	outcome: Extract<McpConnectOutcome, { status: 'device' }>
): Promise<McpConnectResult> {
	const label = mcpServerLabel(serverId);
	const target = outcome.verification_uri_complete || outcome.verification_uri;

	try {
		await vscode.env.clipboard.writeText(outcome.user_code);
	} catch {
		// Clipboard can be unavailable; the code is still shown below.
	}

	const open = `Open ${label}`;
	const choice = await vscode.window.showInformationMessage(
		`${label} sign-in code: ${outcome.user_code}`,
		{
			modal: true,
			detail:
				`The code is copied to your clipboard.\n\n`
				+ `Click "${open}", paste the code there, and approve Nexora. `
				+ `This window updates on its own when you are done.`
		},
		open
	);
	if (choice !== open) {
		return { status: 'cancelled' };
	}

	const opened = await vscode.env.openExternal(vscode.Uri.parse(target));
	if (!opened) {
		return { status: 'error', message: `Could not open ${target}` };
	}

	void pollDeviceWithProgress(serverId, Math.max(outcome.interval || 5, 1) * 1000);
	return { status: 'started' };
}

async function pollDeviceWithProgress(serverId: string, intervalMs: number): Promise<void> {
	const label = mcpServerLabel(serverId);
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Waiting for ${label} sign-in…`,
			cancellable: true
		},
		async (_progress, cancellation) => {
			const deadline = Date.now() + DEVICE_POLL_TIMEOUT_MS;
			while (Date.now() < deadline && !cancellation.isCancellationRequested) {
				await delay(intervalMs, cancellation);
				if (cancellation.isCancellationRequested) {
					return;
				}
				let poll;
				try {
					poll = await getBackendClient().pollMcpDevice(serverId);
				} catch {
					continue; // Engine restarting; keep waiting until the deadline.
				}
				if (poll.status === 'connected') {
					connectedEmitter.fire(serverId);
					void getNotificationService().showSuccess(`${label} connected`);
					return;
				}
				if (poll.status === 'error') {
					void getNotificationService().showError(
						`${label} sign-in failed: ${poll.error}`
					);
					return;
				}
				if (poll.status === 'idle') {
					return;
				}
			}
			if (!cancellation.isCancellationRequested) {
				void getNotificationService().showWarning(
					`${label} sign-in timed out. Click Connect to try again.`
				);
			}
		}
	);
}

/**
 * After a browser redirect we have no callback inside the IDE unless the deep
 * link fires, so poll the engine's own status as a fallback.
 */
function watchBrowserSignIn(serverId: string): void {
	stopWatching(serverId);
	const started = Date.now();
	let busy = false;
	const timer = setInterval(async () => {
		if (Date.now() - started > BROWSER_POLL_TIMEOUT_MS) {
			stopWatching(serverId);
			return;
		}
		if (busy) {
			return;
		}
		busy = true;
		try {
			const connections = await getMcpConnections();
			if (connections[serverId]) {
				stopWatching(serverId);
				connectedEmitter.fire(serverId);
				void getNotificationService().showSuccess(`${mcpServerLabel(serverId)} connected`);
			}
		} catch {
			// Keep waiting; the engine may be busy finishing the exchange.
		} finally {
			busy = false;
		}
	}, BROWSER_POLL_MS);
	browserWatchers.set(serverId, timer);
}

function stopWatching(serverId: string): void {
	const timer = browserWatchers.get(serverId);
	if (timer) {
		clearInterval(timer);
		browserWatchers.delete(serverId);
	}
}

/** Called by the URI handler when the callback page deep-links back into Nexora. */
export async function confirmMcpConnection(serverId: string): Promise<boolean> {
	try {
		const connections = await getMcpConnections();
		if (!connections[serverId]) {
			return false;
		}
		stopWatching(serverId);
		connectedEmitter.fire(serverId);
		return true;
	} catch {
		return false;
	}
}

function delay(ms: number, cancellation: vscode.CancellationToken): Promise<void> {
	return new Promise(resolve => {
		const timer = setTimeout(resolve, ms);
		cancellation.onCancellationRequested(() => {
			clearTimeout(timer);
			resolve();
		});
	});
}

function errorText(error: unknown, serverId: string): string {
	const message = error instanceof Error ? error.message : String(error);
	return message || `Could not start ${mcpServerLabel(serverId)} sign-in.`;
}
