/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getAnalyticsWebviewHtml } from './webview/analytics';
import { getBackendClient } from './services/backendClient';

export class AnalyticsPanelProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexora.analytics';

	private _view?: vscode.WebviewView;

	constructor(private readonly _extensionUri: vscode.Uri) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;

		const webviewOpts: vscode.WebviewOptions & { retainContextWhenHidden?: boolean } = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
			retainContextWhenHidden: true
		};
		webviewView.webview.options = webviewOpts;
		webviewView.webview.html = getAnalyticsWebviewHtml(webviewView.webview, this._extensionUri);

		webviewView.webview.onDidReceiveMessage(async (msg) => {
			if (msg.type === 'ready' || msg.type === 'refresh') {
				await this._pushState();
			}
		});

		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				void this._pushState();
			}
		});
	}

	public async refresh(): Promise<void> {
		await this._pushState();
	}

	private async _pushState(): Promise<void> {
		if (!this._view) {
			return;
		}
		const data = await getBackendClient().getAnalyticsDashboard('default');
		this._view.webview.postMessage({
			type: 'updateData',
			data
		});
	}
}
