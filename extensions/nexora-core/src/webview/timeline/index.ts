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

export function getTimelineWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	const nonce = getNonce();

	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'timeline', 'timeline.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'timeline', 'timeline.js'));

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
	<title>Nexora Timeline</title>
</head>
<body>
	<div id="timeline-root" role="main" aria-label="Nexora Timeline">
		<div class="nx-section-head">
			<h1>Memory Timeline</h1>
			<button type="button" class="nx-btn nx-btn-secondary" id="refreshBtn" aria-label="Refresh timeline">Refresh</button>
		</div>
		<p class="nx-hint">Read-only snapshots. Click a node for detail and a diff against the current snapshot.</p>

		<div id="offline-banner" class="nx-banner" role="alert" hidden></div>

		<div class="nx-layout">
			<section class="nx-section" aria-labelledby="rail-heading">
				<h2 id="rail-heading">Snapshots</h2>
				<div id="timeline-rail" class="nx-rail"></div>
			</section>
			<section class="nx-section" aria-labelledby="detail-heading">
				<h2 id="detail-heading">Detail</h2>
				<div id="timeline-detail" class="nx-detail"></div>
			</section>
		</div>

		<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
