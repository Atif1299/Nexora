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

function escapeAttr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;');
}

export function getSettingsWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	section?: string
): string {
	const nonce = getNonce();
	const initialSection = escapeAttr(section || '');

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
<body data-section="${initialSection}">
	<div id="settings-root" role="main" aria-label="Nexora Settings">
		<nav class="nx-settings-nav" aria-label="Settings sections">
			<div class="nx-settings-nav-title">Settings</div>
			<button type="button" class="nx-nav-item selected" data-section="keys" aria-current="page">LLM Keys</button>
			<button type="button" class="nx-nav-item" data-section="saas">SaaS Connectors</button>
			<button type="button" class="nx-nav-item" data-section="connections">Connections</button>
			<button type="button" class="nx-nav-item" data-section="analytics">Cost &amp; Analytics</button>
			<button type="button" class="nx-nav-item" data-section="approvals">Execution</button>
			<button type="button" class="nx-nav-item" data-section="preferences">Preferences</button>
			<button type="button" class="nx-nav-item" data-section="about">About</button>
		</nav>

		<div class="nx-settings-detail">
			<section class="nx-section active" data-section="keys" aria-labelledby="api-keys-heading">
				<h2 id="api-keys-heading">LLM API Keys</h2>
				<div class="nx-banner" role="note">
					<strong>API keys:</strong> Save keys here - they are stored securely in VS Code
					SecretStorage and sent with Chat / Plan / Agent requests. Backend
					<code>.env</code> is only a local fallback if no IDE key is set.
				</div>
				<p class="nx-hint">Test a key, then Save. That key becomes the primary credential for this IDE.</p>
				<div id="api-keys" class="nx-stack"></div>
			</section>

			<section class="nx-section" data-section="saas" aria-labelledby="saas-keys-heading" hidden>
				<h2 id="saas-keys-heading">SaaS Connectors</h2>
				<p class="nx-hint">Configure Supabase, Stripe, v0.dev, ElevenLabs, and Tavily credentials for orchestration.</p>
				<div id="saas-keys" class="nx-stack"></div>
			</section>

			<section class="nx-section" data-section="connections" aria-labelledby="connections-heading" hidden>
				<div class="nx-section-head">
					<h2 id="connections-heading">Connections</h2>
					<button type="button" class="nx-btn nx-btn-secondary" id="refresh-status" aria-label="Refresh connection status">Refresh</button>
				</div>
				<div id="connections" class="nx-stack" aria-live="polite"></div>
			</section>

			<section class="nx-section nx-section-analytics" data-section="analytics" aria-labelledby="analytics-heading" hidden>
				<div class="nx-section-head">
					<h2 id="analytics-heading">Cost &amp; Analytics</h2>
					<button type="button" class="nx-btn nx-btn-secondary" id="refresh-analytics" aria-label="Refresh analytics">Refresh</button>
				</div>
				<p class="nx-hint">Totals come from execution history. Memory retrievals are tracked separately and do not inflate cost.</p>
				<div class="nx-analytics">
					<div id="offline-banner" class="nx-banner nx-banner-warn" role="alert" hidden></div>
					<section class="nx-analytics-block" aria-labelledby="summary-heading">
						<h3 id="summary-heading">Spend</h3>
						<div id="summary-cards" class="nx-analytics-cards"></div>
					</section>
					<section class="nx-analytics-block" aria-labelledby="daily-heading">
						<h3 id="daily-heading">Last 7 days</h3>
						<div id="daily-chart" class="nx-analytics-chart" aria-live="polite"></div>
					</section>
					<section class="nx-analytics-block" aria-labelledby="platform-heading">
						<h3 id="platform-heading">By platform</h3>
						<div id="platform-bars" class="nx-analytics-bars"></div>
					</section>
					<section class="nx-analytics-block" aria-labelledby="stats-heading">
						<h3 id="stats-heading">Executions</h3>
						<div id="execution-stats" class="nx-analytics-stats"></div>
					</section>
					<section class="nx-analytics-block" aria-labelledby="recent-heading">
						<h3 id="recent-heading">Recent executions</h3>
						<div id="recent-executions" class="nx-analytics-recent"></div>
					</section>
					<section class="nx-analytics-block" aria-labelledby="memory-heading">
						<h3 id="memory-heading">Memory insights</h3>
						<div id="memory-insights" class="nx-analytics-memory"></div>
					</section>
				</div>
			</section>

			<section class="nx-section" data-section="approvals" aria-labelledby="approvals-heading" hidden>
				<h2 id="approvals-heading">Execution and Approvals</h2>
				<p class="nx-hint">Choose how Agents run tools like command execution and file writes. Dangerous commands stay blocked.</p>
				<div id="run-mode" class="nx-stack"></div>
			</section>

			<section class="nx-section" data-section="preferences" aria-labelledby="prefs-heading" hidden>
				<h2 id="prefs-heading">Preferences</h2>
				<div id="preferences" class="nx-stack"></div>
			</section>

			<section class="nx-section" data-section="about" aria-labelledby="about-heading" hidden>
				<h2 id="about-heading">About</h2>
				<p class="nx-hint">Nexora Core · Week 12 Settings</p>
				<button type="button" class="nx-btn nx-btn-secondary" id="show-shortcuts" aria-label="Show keyboard shortcuts">Keyboard Shortcuts</button>
			</section>
		</div>
	</div>

	<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
