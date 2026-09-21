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
			<button type="button" class="nx-nav-item selected" data-section="keys" aria-current="page" title="LLM Keys" aria-label="LLM Keys">
				<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M8 1a4 4 0 0 0-1.5 7.71V10H5v2H3v2h5V8.71A4 4 0 0 0 8 1zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg></span>
				<span class="nx-nav-label">LLM Keys</span>
			</button>
			<button type="button" class="nx-nav-item" data-section="saas" title="SaaS Connectors" aria-label="SaaS Connectors">
				<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M2 3h5v5H2V3zm7 0h5v5H9V3zM2 10h5v5H2v-5zm7 0h5v5H9v-5z"/></svg></span>
				<span class="nx-nav-label">SaaS Connectors</span>
			</button>
			<button type="button" class="nx-nav-item" data-section="connections" title="Connections" aria-label="Connections">
				<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M6.5 9.5a3.5 3.5 0 0 1 0-5l1.2 1.2a1.8 1.8 0 0 0 0 2.6L6.5 9.5zm3 0 1.2-1.2a1.8 1.8 0 0 0 0-2.6L12 4.5a3.5 3.5 0 0 1 0 5L10.8 10.7 9.5 9.5zm-4.2.8L3.5 12a3.5 3.5 0 0 0 5 0l1.2-1.2-1.2-1.2-1.2 1.2a1.8 1.8 0 0 1-2.6 0z"/></svg></span>
				<span class="nx-nav-label">Connections</span>
			</button>
			<button type="button" class="nx-nav-item" data-section="analytics" title="Cost &amp; Analytics" aria-label="Cost and Analytics">
				<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M2 14V2h1.5v10.5H14V14H2zm3.5-2V8H7v4H5.5zm3 0V5H10v7H8.5zm3 0V3H13v9h-1.5z"/></svg></span>
				<span class="nx-nav-label">Cost &amp; Analytics</span>
			</button>
			<button type="button" class="nx-nav-item" data-section="approvals" title="Execution" aria-label="Execution">
				<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M3 2.5v11l10-5.5L3 2.5z"/></svg></span>
				<span class="nx-nav-label">Execution</span>
			</button>
			<button type="button" class="nx-nav-item" data-section="browser" title="Browser" aria-label="Browser">
				<span class="nx-nav-icon nx-nav-icon-browser" aria-hidden="true"></span>
				<span class="nx-nav-label">Browser</span>
			</button>
			<button type="button" class="nx-nav-item" data-section="preferences" title="Preferences" aria-label="Preferences">
				<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M8 5.5A2.5 2.5 0 1 0 8 10.5 2.5 2.5 0 0 0 8 5.5zM1 7.5h2.1a5 5 0 0 1 .6-1.5L2.3 4.6l1.4-1.4 1.4 1.4A5 5 0 0 1 6.5 4V2h2v2a5 5 0 0 1 1.4.6l1.4-1.4 1.4 1.4-1.4 1.4a5 5 0 0 1 .6 1.5H15v2h-2.1a5 5 0 0 1-.6 1.5l1.4 1.4-1.4 1.4-1.4-1.4a5 5 0 0 1-1.4.6v2h-2v-2a5 5 0 0 1-1.5-.6L4.6 13.7 3.2 12.3l1.4-1.4A5 5 0 0 1 4 9.5H1v-2z"/></svg></span>
				<span class="nx-nav-label">Preferences</span>
			</button>
			<button type="button" class="nx-nav-item" data-section="about" title="About" aria-label="About">
				<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm-.8 3h1.5v5H7.2V7z"/></svg></span>
				<span class="nx-nav-label">About</span>
			</button>
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

			<section class="nx-section" data-section="browser" aria-labelledby="browser-heading" hidden>
				<h2 id="browser-heading">Browser</h2>
				<p class="nx-hint">In-IDE Simple Browser tab. GitHub and Vercel OAuth still open in the system browser.</p>
				<div id="browser-settings" class="nx-stack"></div>
			</section>

			<section class="nx-section" data-section="preferences" aria-labelledby="prefs-heading" hidden>
				<h2 id="prefs-heading">Preferences</h2>
				<div id="preferences" class="nx-stack"></div>
			</section>

			<section class="nx-section" data-section="about" aria-labelledby="about-heading" hidden>
				<h2 id="about-heading">About</h2>
				<p class="nx-hint">Nexora Core · live connectors, MCP sockets, and A2A.</p>
				<button type="button" class="nx-btn nx-btn-secondary" id="show-shortcuts" aria-label="Show keyboard shortcuts">Keyboard Shortcuts</button>
				<div id="a2a-root" class="nx-stack" style="margin-top:16px"></div>
			</section>
		</div>
	</div>

	<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
