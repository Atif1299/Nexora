/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Nexora Cloud sign-in: an alternative to bringing your own model keys.
 *
 * Signing in opens the gateway's GitHub login in the browser; the gateway sends
 * the browser back to <uriScheme>://<extension>/cloud-auth with an API token,
 * kept in SecretStorage and sent to the local engine as X-Nexora-Cloud-Token.
 * The engine then routes any model the user has no own key for through the
 * gateway, which bills the account's credit. The status bar shows the credit.
 */

const TOKEN_KEY = 'nexora.cloud.token';
const REFRESH_MS = 5 * 60_000;

interface Account {
	login: string;
	credit_usd: number;
	month: { cost_usd: number; calls: number };
}

function cloudUrl(): string {
	return vscode.workspace.getConfiguration('nexora').get<string>('cloud.url', '').replace(/\/$/, '');
}

export class CloudAccount implements vscode.Disposable {
	private readonly statusItem = vscode.window.createStatusBarItem('nexora.cloud', vscode.StatusBarAlignment.Right, 100);
	private readonly timer = setInterval(() => void this.refresh(), REFRESH_MS);

	constructor(private readonly context: vscode.ExtensionContext) {
		this.statusItem.name = 'Nexora Cloud';
		this.statusItem.command = 'nexora.cloudMenu';
		void this.refresh();
	}

	dispose(): void {
		clearInterval(this.timer);
		this.statusItem.dispose();
	}

	token(): Thenable<string | undefined> {
		return this.context.secrets.get(TOKEN_KEY);
	}

	async signIn(): Promise<void> {
		const callback = await vscode.env.asExternalUri(
			vscode.Uri.parse(`${vscode.env.uriScheme}://${this.context.extension.id}/cloud-auth`)
		);
		await vscode.env.openExternal(vscode.Uri.parse(
			`${cloudUrl()}/auth/github?return_to=${encodeURIComponent(callback.toString(true))}`
		));
	}

	/** The gateway's redirect after a successful GitHub sign-in. */
	async completeSignIn(uri: vscode.Uri): Promise<void> {
		const query = new URLSearchParams(uri.query);
		const token = query.get('token');
		if (!token) {
			return;
		}
		await this.context.secrets.store(TOKEN_KEY, token);
		void vscode.window.showInformationMessage(`Signed in to Nexora Cloud as ${query.get('login') ?? 'you'}.`);
		await this.refresh();
	}

	async signOut(): Promise<void> {
		await this.context.secrets.delete(TOKEN_KEY);
		await this.refresh();
	}

	/** Signed out: offer sign-in. Signed in: credit, add credit, sign out. */
	async showMenu(): Promise<void> {
		const account = await this.account();
		if (!account) {
			return this.signIn();
		}
		const choice = await vscode.window.showQuickPick(
			[
				{ label: '$(credit-card) Add credit', id: 'credit' },
				{ label: '$(sign-out) Sign out', id: 'out' }
			],
			{ title: `Nexora Cloud: ${account.login}, $${account.credit_usd.toFixed(2)} left, $${account.month.cost_usd.toFixed(2)} used this month` }
		);
		if (choice?.id === 'credit') {
			const { url } = await this.call<{ url: string }>('/billing/checkout', 'POST');
			await vscode.env.openExternal(vscode.Uri.parse(url));
		} else if (choice?.id === 'out') {
			await this.signOut();
		}
	}

	private async account(): Promise<Account | undefined> {
		try {
			return await this.call<Account>('/v1/me');
		} catch {
			return undefined;
		}
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
			throw new Error(`Nexora Cloud: HTTP ${response.status}`);
		}
		return response.json() as Promise<T>;
	}

	private async refresh(): Promise<void> {
		const account = await this.account();
		this.statusItem.text = account ? `$(cloud) $${account.credit_usd.toFixed(2)}` : '$(cloud) Sign in';
		this.statusItem.tooltip = account
			? `Nexora Cloud: ${account.login}. Models you have no own key for run on your credit. Click for options.`
			: 'Sign in to Nexora Cloud to use models without your own API keys.';
		this.statusItem.show();
	}
}
