/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export function getPlatformsWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	const nonce = getNonce();

	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'platforms', 'platforms.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'platforms', 'platforms.js'));

	const csp = [
		`default-src 'none'`,
		`img-src ${webview.cspSource} https: data:`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
	].join('; ');

	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<link rel="stylesheet" href="${cssUri}">
	<title>Nexora Platforms</title>
</head>
<body>
	<div id="platforms-root" role="main" aria-label="Nexora Platforms">
		<div class="nx-section-head">
			<h1>Nexora Platforms</h1>
			<button type="button" class="nx-btn nx-btn-secondary" id="refreshBtn" aria-label="Refresh platforms">Refresh</button>
		</div>
		<p class="nx-hint">Catalog of connected and available platforms. Greyed rows need a key, are unavailable, or failed.</p>

		<div id="offline-banner" class="nx-banner" role="alert" hidden></div>
		<div id="embedding-banner" class="nx-banner nx-banner-info" role="status" hidden></div>
		<div id="loading" class="nx-empty" hidden>Loading platforms...</div>
		<div id="platform-list" class="nx-groups"></div>

		<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
