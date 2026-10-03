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

export function getTemplatesWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	const nonce = getNonce();

	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'templates', 'templates.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'templates', 'templates.js'));

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
	<title>Nexora Templates</title>
</head>
<body>
	<div id="templates-root" role="main" aria-label="Nexora Templates">
		<div class="nx-section-head">
			<h1>Workflow Templates</h1>
			<div class="nx-head-actions">
				<button type="button" class="nx-btn nx-btn-secondary" id="importBtn" aria-label="Import template">Import</button>
				<button type="button" class="nx-btn nx-btn-secondary" id="refreshBtn" aria-label="Refresh templates">Refresh</button>
			</div>
		</div>
		<p class="nx-hint">Built-in templates plus any you save or import. Instantiating opens the existing plan approval card in Chat.</p>

		<div id="offline-banner" class="nx-banner" role="alert" hidden></div>
		<div id="import-preview" class="nx-preview" hidden></div>

		<section class="nx-section" aria-labelledby="builtin-heading">
			<h2 id="builtin-heading">Built-in</h2>
			<div id="builtin-list" class="nx-list"></div>
		</section>

		<section class="nx-section" aria-labelledby="user-heading">
			<h2 id="user-heading">Your templates</h2>
			<div id="user-list" class="nx-list"></div>
		</section>

		<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
