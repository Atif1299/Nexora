/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getAnalyticsWebviewHtml } from './webview/analytics';
import { getBackendClient } from './services/backendClient';
import { acquireEditorPanel, gateEditorPanel } from './services/editorPage';

export class AnalyticsPanelProvider {
	public static readonly viewType = 'nexora.analytics';

	private _panel?: vscode.WebviewPanel;
	private _attached = false;

	constructor(private readonly _extensionUri: vscode.Uri) { }

	public async open(): Promise<void> {
		const panel = acquireEditorPanel({
			viewType: AnalyticsPanelProvider.viewType,
			title: 'Nexora Analytics',
			extensionUri: this._extensionUri,
			icon: 'analytics.svg'
		});
		if (this._panel !== panel) {
			this._panel = panel;
			this._attached = false;
			panel.onDidDispose(() => {
				if (this._panel === panel) {
					this._panel = undefined;
					this._attached = false;
				}
			});
		}
		gateEditorPanel(panel, (readyPanel) => this._attachOnce(readyPanel));
	}

	public async refresh(): Promise<void> {
		await this._pushState();
	}

	private _attachOnce(panel: vscode.WebviewPanel): void {
		if (this._attached) {
			return;
		}
		this._attached = true;
		this._panel = panel;
		panel.webview.html = getAnalyticsWebviewHtml(panel.webview, this._extensionUri);

		const disposables: vscode.Disposable[] = [
			panel.webview.onDidReceiveMessage(async (msg) => {
				if (msg.type === 'ready' || msg.type === 'refresh') {
					await this._pushState();
				}
			}),
			panel.onDidChangeViewState(() => {
				if (panel.visible) {
					void this._pushState();
				}
			})
		];

		panel.onDidDispose(() => {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		});
	}

	private async _pushState(): Promise<void> {
		if (!this._panel || !this._attached) {
			return;
		}
		const data = await getBackendClient().getAnalyticsDashboard('default');
		this._panel.webview.postMessage({
			type: 'updateData',
			data
		});
	}
}
