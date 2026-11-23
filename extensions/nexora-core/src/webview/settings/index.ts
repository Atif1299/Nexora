/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { renderWebviewPage } from '../shared/html';

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
	return renderWebviewPage({
		webview,
		extensionUri,
		folder: 'settings',
		title: 'Nexora Settings',
		styles: ['settings.css'],
		scripts: ['settings.js'],
		// This panel writes style attributes from script (meter widths).
		allowInlineStyles: true,
		// settings.js reads the section to open before its first render.
		bodyAttributes: `data-section="${escapeAttr(section || '')}"`,
		body: /* html */ `	<div id="settings-root" role="main" aria-label="Nexora Settings">
		<nav class="nx-settings-nav" aria-label="Settings sections">
			<button type="button" class="nx-nav-profile" id="nav-profile" data-section="account" title="Account" aria-label="Account">
				<span class="nx-nav-avatar" id="nav-avatar" aria-hidden="true">N</span>
				<span class="nx-nav-who">
					<span class="nx-nav-name" id="nav-name">Nexora Cloud</span>
					<span class="nx-nav-plan" id="nav-plan">Not signed in</span>
				</span>
			</button>
			<div class="nx-nav-search">
				<svg class="nx-nav-search-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
				<input id="nav-search" type="search" placeholder="Search settings" aria-label="Search settings" spellcheck="false" autocomplete="off">
			</div>
			<div class="nx-nav-group">
				<button type="button" class="nx-nav-item" data-section="account" data-keywords="profile sign in sign out cloud devices" title="Account" aria-label="Account">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.8-2.3 2.7-3.5 5-3.5s4.2 1.2 5 3.5"/></svg></span>
					<span class="nx-nav-label">Account</span>
				</button>
				<button type="button" class="nx-nav-item" data-section="plan" data-keywords="plan usage credit billing subscription pro free calls spend" title="Plan &amp; Usage" aria-label="Plan and Usage">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2 6.5h12M4.5 10h2.5"/></svg></span>
					<span class="nx-nav-label">Plan &amp; Usage</span>
				</button>
			</div>
			<div class="nx-nav-group">
				<button type="button" class="nx-nav-item selected" data-section="keys" aria-current="page" data-keywords="api keys openai anthropic gemini openrouter" title="LLM Keys" aria-label="LLM Keys">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="5.5" cy="10.5" r="2.5"/><path d="M7.3 8.7 13 3M11 5l1.5 1.5M9.5 6.5 11 8"/></svg></span>
					<span class="nx-nav-label">LLM Keys</span>
				</button>
				<button type="button" class="nx-nav-item" data-section="models" data-keywords="models picker auto catalog" title="Models" aria-label="Models">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 2.5 13.5 5.5 8 8.5 2.5 5.5z"/><path d="M2.5 8.5 8 11.5l5.5-3M2.5 11 8 14l5.5-3"/></svg></span>
					<span class="nx-nav-label">Models</span>
				</button>
				<button type="button" class="nx-nav-item" data-section="memory" data-keywords="memory facts remember rules agents.md claude.md" title="Project Memory" aria-label="Project Memory">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M4 2h5.5l3 3v8.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2z"/><path d="M9.5 2v3h3M5.5 8.5h5M5.5 11h3.5"/></svg></span>
					<span class="nx-nav-label">Project Memory</span>
				</button>
			</div>
			<div class="nx-nav-group">
				<button type="button" class="nx-nav-item" data-section="approvals" data-keywords="execution approvals run mode agent terminal turns" title="Execution" aria-label="Execution">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 6.5 7 8.5 5 10.5M8.5 10.5H11"/></svg></span>
					<span class="nx-nav-label">Execution</span>
				</button>
				<button type="button" class="nx-nav-item" data-section="browser" data-keywords="browser localhost simple browser" title="Browser" aria-label="Browser">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.6 1.6 2.3 3.4 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10.1 5.7 8S6.4 4.1 8 2.5z"/></svg></span>
					<span class="nx-nav-label">Browser</span>
				</button>
				<button type="button" class="nx-nav-item" data-section="connections" data-keywords="connections oauth github vercel mcp database deployment" title="Connections" aria-label="Connections">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"/></svg></span>
					<span class="nx-nav-label">Connections</span>
				</button>
				<button type="button" class="nx-nav-item" data-section="saas" data-keywords="saas connectors supabase stripe v0 elevenlabs tavily" title="SaaS Connectors" aria-label="SaaS Connectors">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg></span>
					<span class="nx-nav-label">SaaS Connectors</span>
				</button>
			</div>
			<div class="nx-nav-group">
				<button type="button" class="nx-nav-item" data-section="analytics" data-keywords="cost analytics spend executions history" title="Cost &amp; Analytics" aria-label="Cost and Analytics">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5"/></svg></span>
					<span class="nx-nav-label">Cost &amp; Analytics</span>
				</button>
				<button type="button" class="nx-nav-item" data-section="preferences" data-keywords="preferences default model index theme cost estimates" title="Preferences" aria-label="Preferences">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M2.5 4.5H9M12 4.5h1.5M2.5 11.5H4M7 11.5h6.5"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/></svg></span>
					<span class="nx-nav-label">Preferences</span>
				</button>
				<button type="button" class="nx-nav-item" data-section="about" data-keywords="about version shortcuts a2a agent card" title="About" aria-label="About">
					<span class="nx-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="M8 7.5V11M8 5.1v.1"/></svg></span>
					<span class="nx-nav-label">About</span>
				</button>
			</div>
			<p class="nx-nav-empty" id="nav-empty" hidden>No settings match.</p>
		</nav>

		<div class="nx-settings-detail">
			<section class="nx-section" data-section="account" aria-labelledby="account-heading" hidden>
				<div class="nx-section-head">
					<h2 id="account-heading">Account</h2>
					<button type="button" class="nx-btn nx-btn-ghost" id="account-refresh" aria-label="Refresh account">Refresh</button>
				</div>
				<p class="nx-lede">Your Nexora Cloud account in this IDE. Profile, billing and devices are managed on the website.</p>
				<div id="account-root" class="nx-stack" aria-live="polite"><div class="nx-card nx-hint">Loading your account...</div></div>
			</section>

			<section class="nx-section" data-section="plan" aria-labelledby="plan-heading" hidden>
				<div class="nx-section-head">
					<h2 id="plan-heading">Plan &amp; Usage</h2>
					<button type="button" class="nx-btn nx-btn-ghost" id="plan-refresh" aria-label="Refresh plan and usage">Refresh</button>
				</div>
				<div id="plan-root" class="nx-stack" aria-live="polite"><div class="nx-card nx-hint">Loading your plan...</div></div>
			</section>

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

			<section class="nx-section" data-section="models" aria-labelledby="models-heading" hidden>
				<div class="nx-section-head">
					<h2 id="models-heading">Models</h2>
					<button type="button" class="nx-btn nx-btn-ghost" id="refresh-models" aria-label="Refresh model catalog">Refresh</button>
				</div>
				<p class="nx-hint">Toggle which models appear in the chat picker. Auto is always available.</p>
				<div id="models-root" class="nx-stack" aria-live="polite"></div>
			</section>

			<section class="nx-section" data-section="memory" aria-labelledby="memory-facts-heading" hidden>
				<div class="nx-section-head">
					<h2 id="memory-facts-heading">Project Memory</h2>
					<button type="button" class="nx-btn nx-btn-ghost" id="facts-refresh" aria-label="Refresh project memory">Refresh</button>
				</div>
				<p class="nx-hint">
					Standing facts about this project. Nexora adds a fact when you say
					<em>&ldquo;remember &hellip;&rdquo;</em> in chat or state a lasting preference in Ask / Agent,
					and sends them with every Chat, Ask, Agent and Plan request. Delete anything that is wrong.
				</p>
				<div id="project-memory" class="nx-stack"></div>
			</section>

			<section class="nx-section" data-section="saas" aria-labelledby="saas-keys-heading" hidden>
				<h2 id="saas-keys-heading">SaaS Connectors</h2>
				<p class="nx-hint">Configure Supabase, Stripe, v0.dev, ElevenLabs, and Tavily credentials for orchestration.</p>
				<div id="saas-keys" class="nx-stack"></div>
			</section>

			<section class="nx-section" data-section="connections" aria-labelledby="connections-heading" hidden>
				<div class="nx-section-head">
					<h2 id="connections-heading">Connections</h2>
					<button type="button" class="nx-btn nx-btn-ghost" id="refresh-status" aria-label="Refresh connection status">Refresh</button>
				</div>
				<div id="connections" class="nx-stack" aria-live="polite"></div>
			</section>

			<section class="nx-section nx-section-analytics" data-section="analytics" aria-labelledby="analytics-heading" hidden>
				<div class="nx-section-head">
					<h2 id="analytics-heading">Cost &amp; Analytics</h2>
					<button type="button" class="nx-btn nx-btn-ghost" id="refresh-analytics" aria-label="Refresh analytics">Refresh</button>
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

	<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>`
	});
}
