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

export function getSettingsWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	const nonce = getNonce();

	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'settings', 'settings.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'settings', 'settings.js'));

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
	<title>Nexora Settings</title>
</head>
<body>
	<div id="settings-root" role="main" aria-label="Nexora Settings">
		<div class="nx-banner" role="note">
			<strong>API keys:</strong> Save keys here - they are stored securely in VS Code
			SecretStorage and sent with Chat / Plan / Agent requests. Backend
			<code>.env</code> is only a local fallback if no IDE key is set.
		</div>

		<section class="nx-section" aria-labelledby="api-keys-heading">
			<h2 id="api-keys-heading">LLM API Keys</h2>
			<p class="nx-hint">Test a key, then Save. That key becomes the primary credential for this IDE.</p>
			<div id="api-keys" class="nx-stack"></div>
		</section>

		<section class="nx-section" aria-labelledby="saas-keys-heading">
			<h2 id="saas-keys-heading">SaaS Connectors</h2>
			<p class="nx-hint">Configure Supabase, Stripe, and v0.dev credentials for full-stack orchestration.</p>
			<div id="saas-keys" class="nx-stack"></div>
		</section>

		<section class="nx-section" aria-labelledby="connections-heading">
			<div class="nx-section-head">
				<h2 id="connections-heading">Connections</h2>
				<button type="button" class="nx-btn nx-btn-secondary" id="refresh-status" aria-label="Refresh connection status">Refresh</button>
			</div>
			<div id="connections" class="nx-stack" aria-live="polite"></div>
		</section>

		<section class="nx-section" aria-labelledby="prefs-heading">
			<h2 id="prefs-heading">Preferences</h2>
			<div id="preferences" class="nx-stack"></div>
		</section>

		<section class="nx-section" aria-labelledby="about-heading">
			<h2 id="about-heading">About</h2>
			<p class="nx-hint">Nexora Core · Week 12 Settings</p>
			<button type="button" class="nx-btn nx-btn-secondary" id="show-shortcuts" aria-label="Show keyboard shortcuts">Keyboard Shortcuts</button>
		</section>

		<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
