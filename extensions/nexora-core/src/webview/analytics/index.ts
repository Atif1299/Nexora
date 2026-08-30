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

export function getAnalyticsWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	const nonce = getNonce();

	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'analytics', 'analytics.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'analytics', 'analytics.js'));

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
	<title>Nexora Analytics</title>
</head>
<body>
	<div id="analytics-root" role="main" aria-label="Nexora Analytics">
		<div class="nx-section-head">
			<h1>Cost &amp; Analytics</h1>
			<button type="button" class="nx-btn nx-btn-secondary" id="refresh" aria-label="Refresh analytics">Refresh</button>
		</div>
		<p class="nx-hint">Totals come from execution history. Memory retrievals are tracked separately and do not inflate cost.</p>

		<div id="offline-banner" class="nx-banner" role="alert" hidden></div>

		<section class="nx-section" aria-labelledby="summary-heading">
			<h2 id="summary-heading">Spend</h2>
			<div id="summary-cards" class="nx-cards"></div>
		</section>

		<section class="nx-section" aria-labelledby="daily-heading">
			<h2 id="daily-heading">Last 7 days</h2>
			<div id="daily-chart" class="nx-chart" aria-live="polite"></div>
		</section>

		<section class="nx-section" aria-labelledby="platform-heading">
			<h2 id="platform-heading">By platform</h2>
			<div id="platform-bars" class="nx-bars"></div>
		</section>

		<section class="nx-section" aria-labelledby="stats-heading">
			<h2 id="stats-heading">Executions</h2>
			<div id="execution-stats" class="nx-stats"></div>
		</section>

		<section class="nx-section" aria-labelledby="recent-heading">
			<h2 id="recent-heading">Recent executions</h2>
			<div id="recent-executions" class="nx-recent"></div>
		</section>

		<section class="nx-section" aria-labelledby="memory-heading">
			<h2 id="memory-heading">Memory insights</h2>
			<div id="memory-insights" class="nx-memory"></div>
		</section>

		<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
