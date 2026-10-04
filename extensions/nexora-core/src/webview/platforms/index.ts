/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { renderWebviewPage } from '../shared/html';

export function getPlatformsWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	return renderWebviewPage({
		webview,
		extensionUri,
		folder: 'platforms',
		title: 'Nexora Platforms',
		styles: ['platforms.css'],
		scripts: ['platforms.js'],
		body: /* html */ `	<div id="platforms-root" role="main" aria-label="Nexora Platforms">
		<div class="nx-section-head">
			<h1>Nexora Platforms</h1>
			<button type="button" class="nx-btn nx-btn-secondary" id="refreshBtn" aria-label="Refresh platforms">Refresh</button>
		</div>
		<p class="nx-hint">Live connectors can Connect or Disconnect. Grey catalogue rows are discovery only.</p>

		<div id="offline-banner" class="nx-banner" role="alert" hidden></div>
		<div id="embedding-banner" class="nx-banner nx-banner-info" role="status" hidden></div>
		<div id="loading" class="nx-empty" hidden>Loading platforms...</div>
		<div id="platform-list" class="nx-groups"></div>

		<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>
	</div>`
	});
}
