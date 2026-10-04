/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getBackendClient } from './backendClient';
import { refreshCapabilities } from './backend/capabilities';

/**
 * Browser OAuth Connect for GitHub and Vercel, shared by the platform sidebar,
 * Settings, and chat.
 *
 * The engine owns the flow: it builds the vendor authorize URL, receives the
 * loopback callback, and stores the token in the encrypted token store. The
 * extension opens the system browser, then learns about completion from the
 * IDE deep link on the success page or, failing that, by polling capabilities.
 */
export type OAuthProvider = 'github' | 'vercel';

export const OAUTH_CALLBACKS: Record<OAuthProvider, string> = {
	github: 'http://127.0.0.1:8000/api/auth/github/callback',
	vercel: 'http://127.0.0.1:8000/api/auth/vercel/callback'
};

const LABELS: Record<OAuthProvider, string> = { github: 'GitHub', vercel: 'Vercel' };
const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export type OAuthStartOutcome =
	| { status: 'opened' }
	| { status: 'needs_setup'; message: string }
	| { status: 'error'; message: string };

const completeEmitter = new vscode.EventEmitter<OAuthProvider>();
/** Fires once the engine holds a token for the provider after a Connect. */
export const onDidCompleteOAuth = completeEmitter.event;

const watchers = new Map<OAuthProvider, ReturnType<typeof setInterval>>();
let extensionId: string | undefined;

export function oauthProviderLabel(provider: OAuthProvider): string {
	return LABELS[provider];
}

/** One-line, one-time setup step shown on the card when the OAuth app is missing. */
export function oauthSetupStep(provider: OAuthProvider): string {
	const label = LABELS[provider];
	return `One-time setup: create a ${label} OAuth app with callback ${OAUTH_CALLBACKS[provider]}, `
		+ `paste its client ID and secret in Settings → Connections, then Connect.`;
}

/** Reject authorize URLs that would send the user to a broken vendor page. */
export function oauthAuthorizeUrlIsUsable(url: string): boolean {
	try {
		const id = new URL(url).searchParams.get('client_id') || '';
		const trimmed = id.trim();
		return !!trimmed && trimmed.toLowerCase() !== 'none';
	} catch {
		return false;
	}
}

export async function isOAuthAppConfigured(provider: OAuthProvider): Promise<boolean> {
	const status = await getBackendClient().getAuthStatus('default');
	return provider === 'github' ? !!status.github_oauth_configured : !!status.vercel_oauth_configured;
}

async function returnUri(provider: OAuthProvider): Promise<string | undefined> {
	if (!extensionId) {
		return undefined;
	}
	try {
		const uri = vscode.Uri.parse(`${vscode.env.uriScheme}://${extensionId}/oauth-complete?provider=${provider}`);
		return (await vscode.env.asExternalUri(uri)).toString(true);
	} catch {
		return undefined;
	}
}

/**
 * Start Connect: open the vendor sign-in in the system browser, or report the
 * one-time setup step when the OAuth app client id/secret are not saved yet.
 * Never opens a URL without a real client_id.
 */
export async function startOAuthConnect(provider: OAuthProvider): Promise<OAuthStartOutcome> {
	const client = getBackendClient();
	try {
		if (!(await isOAuthAppConfigured(provider))) {
			return { status: 'needs_setup', message: oauthSetupStep(provider) };
		}
	} catch (error) {
		return { status: 'error', message: error instanceof Error ? error.message : 'Engine not reachable' };
	}

	const ret = await returnUri(provider);
	const result = provider === 'github'
		? await client.getGitHubAuthUrl('default', ret)
		: await client.getVercelAuthUrl('default', ret);
	const url = result?.authorization_url || '';
	if (!url || !oauthAuthorizeUrlIsUsable(url)) {
		const message = result?.error || `Could not start ${LABELS[provider]} sign-in.`;
		if (/client id and secret are required/i.test(message)) {
			return { status: 'needs_setup', message: oauthSetupStep(provider) };
		}
		return { status: 'error', message };
	}

	const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
	if (!opened) {
		return { status: 'error', message: `Could not open the browser for ${LABELS[provider]} sign-in.` };
	}
	watchForCompletion(provider);
	return { status: 'opened' };
}

async function checkConnected(provider: OAuthProvider): Promise<boolean> {
	const report = await refreshCapabilities();
	if (report?.connectors[provider] !== 'ready') {
		return false;
	}
	stopWatching(provider);
	completeEmitter.fire(provider);
	return true;
}

function stopWatching(provider: OAuthProvider): void {
	const timer = watchers.get(provider);
	if (timer) {
		clearInterval(timer);
		watchers.delete(provider);
	}
}

/** Poll until the engine reports the provider ready; sign-in with 2FA takes a while. */
function watchForCompletion(provider: OAuthProvider): void {
	stopWatching(provider);
	const started = Date.now();
	let busy = false;
	const timer = setInterval(async () => {
		if (Date.now() - started > POLL_TIMEOUT_MS) {
			stopWatching(provider);
			return;
		}
		if (busy) {
			return;
		}
		busy = true;
		try {
			await checkConnected(provider);
		} catch {
			// Engine restarting; keep polling until the timeout.
		} finally {
			busy = false;
		}
	}, POLL_MS);
	watchers.set(provider, timer);
}

/**
 * Register the deep-link handler the callback page uses to bring Nexora back
 * to the front: <uriScheme>://<publisher>.nexora-core/oauth-complete?provider=github
 */
export function registerOAuthUriHandler(context: vscode.ExtensionContext): void {
	extensionId = context.extension.id;
	context.subscriptions.push(
		completeEmitter,
		{ dispose: () => { for (const provider of [...watchers.keys()]) { stopWatching(provider); } } },
		vscode.window.registerUriHandler({
			handleUri(uri: vscode.Uri): void {
				if (uri.path !== '/oauth-complete') {
					return;
				}
				const query = new URLSearchParams(uri.query);
				// Remote MCP sign-ins come back on the same path, tagged with ?mcp=
				const mcpServer = query.get('mcp');
				if (mcpServer) {
					void import('./mcpConnect').then(m => m.confirmMcpConnection(mcpServer));
					return;
				}
				const provider = query.get('provider');
				if (provider === 'github' || provider === 'vercel') {
					void checkConnected(provider);
				}
			}
		})
	);
}
