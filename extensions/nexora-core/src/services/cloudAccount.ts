/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as vscode from 'vscode';

/**
 * Nexora Cloud account: an alternative to bringing your own model keys.
 *
 * Sign in opens the website (nexora.cloud.webUrl) at /sign-in?client=ide. The
 * person signs in there with GitHub, Google or email and confirms; the website
 * sends the browser back to <uriScheme>://<extension>/cloud-auth?code=nxc_...
 * with a one-time code (never a token). The IDE swaps the code for its own
 * token at the gateway (POST /auth/exchange), keeps it in SecretStorage and
 * sends it to the local engine as X-Nexora-Cloud-Token. Each IDE is a device
 * the dashboard can sign out.
 *
 * Only a sign-in this window started is accepted: Sign in stores a nonce
 * (10 minutes) and puts it in the callback address, so a link carrying
 * someone else's code cannot sign this IDE into their account. A token the
 * gateway refuses (401: revoked from the dashboard, or expired) is forgotten,
 * and the IDE shows Sign in again.
 *
 * The account (plan, credit, free calls today) is refreshed when the window
 * regains focus, so a purchase made in the browser shows at once, and every
 * 5 minutes. Plans, credit and devices are managed on the website dashboard.
 */

const TOKEN_KEY = 'nexora.cloud.token';
const PENDING_KEY = 'nexora.cloud.pendingSignIn';
const PENDING_MS = 10 * 60_000;
const REFRESH_MS = 5 * 60_000;
const FOCUS_REFRESH_MS = 30_000;

export interface CloudPlan {
	id: 'cloud' | 'pro';
	name: string;
	status: string | null;
	renews_at: string | null;
	cancel_at_period_end: boolean;
}

/** GET /v1/me. Fields after `month` are newer than v0.1.4 and optional for an older gateway. */
export interface CloudAccountInfo {
	login: string;
	credit_usd: number;
	month: { cost_usd: number; calls: number };
	id?: string;
	name?: string;
	email?: string | null;
	avatar_url?: string | null;
	plan?: CloudPlan;
	free_today?: { used: number; limit: number };
	dashboard_url?: string;
}

export type DashboardPage = '' | 'billing' | 'usage' | 'devices' | 'settings';

function cloudUrl(): string {
	return vscode.workspace.getConfiguration('nexora').get<string>('cloud.url', '').replace(/\/$/, '');
}

function webUrl(): string {
	return vscode.workspace.getConfiguration('nexora').get<string>('cloud.webUrl', 'https://nexora.visionscraft.tech').replace(/\/$/, '');
}

/** Where the browser signs in for the IDE; the website returns to `callback` with a one-time code. */
export function signInUrl(site: string, callback: string): string {
	return `${site}/sign-in?client=ide&return_to=${encodeURIComponent(callback)}`;
}

export function dashboardUrl(site: string, page: DashboardPage = '', query = ''): string {
	return `${site}/dashboard${page ? '/' + page : ''}${query ? '?' + query : ''}`;
}

/** The name this IDE gets in the dashboard's Devices list. */
export function deviceLabel(platform: string): string {
	const os = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform;
	return `Nexora IDE on ${os}`;
}

export interface PendingSignIn {
	nonce: string;
	expires: number;
}

/** True only for the callback of a sign-in this window started and that has not expired. */
export function acceptsSignIn(nonce: string | null, pending: PendingSignIn | undefined, now: number): boolean {
	return Boolean(nonce && pending && pending.nonce === nonce && now <= pending.expires);
}

/** What a failed account call means: 401 is a revoked or expired token; anything else is a connection problem. */
export function accountProblem(status: number | undefined): 'signed-out' | 'unreachable' {
	return status === 401 ? 'signed-out' : 'unreachable';
}

class CloudHttpError extends Error {
	constructor(readonly status: number) {
		super(`Nexora Cloud: HTTP ${status}`);
	}
}

export function isPro(account: CloudAccountInfo | undefined): boolean {
	return account?.plan?.id === 'pro';
}

/** Status bar text: "Pro - $4.20", "$0.85", or "Sign in". */
export function statusText(account: CloudAccountInfo | undefined): string {
	if (!account) {
		return '$(cloud) Sign in';
	}
	const credit = `$${account.credit_usd.toFixed(2)}`;
	return isPro(account) ? `$(cloud) Pro - ${credit}` : `$(cloud) ${credit}`;
}

export class CloudAccount implements vscode.Disposable {
	private readonly statusItem = vscode.window.createStatusBarItem('nexora.cloud', vscode.StatusBarAlignment.Right, 100);
	private readonly timer = setInterval(() => void this.refresh(), REFRESH_MS);
	private readonly changed = new vscode.EventEmitter<void>();
	private readonly accountChanged = new vscode.EventEmitter<CloudAccountInfo | undefined>();
	private readonly focusWatch: vscode.Disposable;
	private lastRefresh = 0;
	private current: CloudAccountInfo | undefined;

	/** Signed in or out: what the engine can run has changed. */
	readonly onDidChange = this.changed.event;
	/** After every refresh: the account as the gateway now reports it (undefined when signed out). */
	readonly onDidChangeAccount = this.accountChanged.event;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.statusItem.name = 'Nexora Cloud';
		this.statusItem.command = 'nexora.cloudMenu';
		// Coming back from the browser (a purchase, an upgrade, a device signed out): show it now.
		this.focusWatch = vscode.window.onDidChangeWindowState((state) => {
			if (state.focused && Date.now() - this.lastRefresh > FOCUS_REFRESH_MS) {
				void this.refresh();
			}
		});
		void this.refresh();
	}

	dispose(): void {
		clearInterval(this.timer);
		this.focusWatch.dispose();
		this.statusItem.dispose();
		this.changed.dispose();
		this.accountChanged.dispose();
	}

	token(): Thenable<string | undefined> {
		return this.context.secrets.get(TOKEN_KEY);
	}

	/** The last account the gateway reported, without a network call. */
	cached(): CloudAccountInfo | undefined {
		return this.current;
	}

	async signIn(): Promise<void> {
		const nonce = randomUUID();
		const pending: PendingSignIn = { nonce, expires: Date.now() + PENDING_MS };
		await this.context.globalState.update(PENDING_KEY, pending);
		const callback = await vscode.env.asExternalUri(
			vscode.Uri.parse(`${vscode.env.uriScheme}://${this.context.extension.id}/cloud-auth?n=${nonce}`)
		);
		await vscode.env.openExternal(vscode.Uri.parse(signInUrl(webUrl(), callback.toString(true))));
	}

	/** The website's redirect after the person confirmed in the browser: swap the one-time code for a token. */
	async completeSignIn(uri: vscode.Uri): Promise<void> {
		const query = new URLSearchParams(uri.query);
		const pending = this.context.globalState.get<PendingSignIn>(PENDING_KEY);
		if (!acceptsSignIn(query.get('n'), pending, Date.now())) {
			void vscode.window.showWarningMessage(
				'This Nexora Cloud sign-in link did not start in this Nexora window, so it was ignored. Click Sign in in Nexora to sign in.'
			);
			return;
		}
		await this.context.globalState.update(PENDING_KEY, undefined);
		const code = query.get('code');
		// Gateways before accounts (and the sign-in started by v0.1.4) sent the token itself.
		let token = query.get('token') || '';
		if (code) {
			try {
				token = await this.exchange(code);
			} catch (error) {
				const choice = await vscode.window.showErrorMessage(
					`Nexora Cloud sign-in did not finish: ${(error as Error).message}`,
					'Try again'
				);
				if (choice === 'Try again') {
					await this.signIn();
				}
				return;
			}
		}
		if (!token) {
			return;
		}
		await this.context.secrets.store(TOKEN_KEY, token);
		this.changed.fire();
		await this.refresh();
		const who = this.current?.name || this.current?.login || query.get('login') || 'you';
		void vscode.window.showInformationMessage(`Signed in to Nexora Cloud as ${who}.`);
	}

	/** Revokes the token on the gateway too, so a copied token stops working; offline, it is only forgotten here. */
	async signOut(): Promise<void> {
		await this.call('/auth/logout', 'POST').catch(() => undefined);
		await this.context.secrets.delete(TOKEN_KEY);
		this.changed.fire();
		await this.refresh();
	}

	async openDashboard(page: DashboardPage = '', query = ''): Promise<void> {
		await vscode.env.openExternal(vscode.Uri.parse(dashboardUrl(webUrl(), page, query)));
	}

	/** Signed out: sign in. Signed in: dashboard, credit, upgrade, sign out. */
	async showMenu(): Promise<void> {
		const account = await this.account();
		if (!account) {
			return this.signIn();
		}
		const items: (vscode.QuickPickItem & { id: string })[] = [
			{ label: '$(globe) Open dashboard', description: 'Usage, billing and devices', id: 'dashboard' },
			{ label: '$(credit-card) Buy credits', id: 'credit' }
		];
		if (!isPro(account)) {
			items.push({ label: '$(star-empty) Upgrade to Pro', description: '$5 credit monthly, lower prices', id: 'pro' });
		}
		items.push({ label: '$(sign-out) Sign out', id: 'out' });
		const free = account.free_today ? `, ${account.free_today.limit - account.free_today.used} free calls left today` : '';
		const choice = await vscode.window.showQuickPick(items, {
			title: `Nexora Cloud: ${account.name || account.login} (${account.plan?.name || 'Nexora Cloud'}), $${account.credit_usd.toFixed(2)} credit${free}`
		});
		if (choice?.id === 'dashboard') {
			await this.openDashboard();
		} else if (choice?.id === 'credit') {
			await this.openDashboard('billing');
		} else if (choice?.id === 'pro') {
			await this.openDashboard('billing', 'upgrade=pro');
		} else if (choice?.id === 'out') {
			await this.signOut();
		}
	}

	/** Asks the gateway; undefined when signed out or unreachable. A refused token (401) is forgotten. */
	async account(): Promise<CloudAccountInfo | undefined> {
		try {
			return await this.call<CloudAccountInfo>('/v1/me');
		} catch (error) {
			const status = error instanceof CloudHttpError ? error.status : undefined;
			if (accountProblem(status) === 'signed-out' && await this.token()) {
				await this.context.secrets.delete(TOKEN_KEY);
				this.changed.fire();
			}
			return undefined;
		}
	}

	async refresh(): Promise<CloudAccountInfo | undefined> {
		this.lastRefresh = Date.now();
		const account = await this.account();
		this.current = account;
		this.statusItem.text = statusText(account);
		this.statusItem.tooltip = account
			? `Nexora Cloud: ${account.name || account.login}, ${account.plan?.name || 'Nexora Cloud'}. Models you have no own key for run on your credit; free models need none. Click for options.`
			: 'Sign in to Nexora Cloud to use models without your own API keys.';
		this.statusItem.show();
		this.accountChanged.fire(account);
		return account;
	}

	private async exchange(code: string): Promise<string> {
		let response: Response;
		try {
			response = await fetch(`${cloudUrl()}/auth/exchange`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code, label: deviceLabel(process.platform) }),
				signal: AbortSignal.timeout(15_000)
			});
		} catch {
			throw new Error('Nexora Cloud is not reachable. Check your connection and try again.');
		}
		const body = await response.json().catch(() => ({})) as { token?: string; detail?: string };
		if (!response.ok || !body.token) {
			throw new Error(body.detail || `HTTP ${response.status}`);
		}
		return body.token;
	}

	private async call<T>(path: string, method = 'GET'): Promise<T> {
		const token = await this.token();
		if (!token) {
			throw new Error('Not signed in to Nexora Cloud');
		}
		const response = await fetch(`${cloudUrl()}${path}`, {
			method,
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(15_000)
		});
		if (!response.ok) {
			throw new CloudHttpError(response.status);
		}
		return response.json() as Promise<T>;
	}
}
