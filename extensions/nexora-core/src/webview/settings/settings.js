/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {
	const vscode = acquireVsCodeApi();

	const PROVIDERS = [
		{ id: 'openai', label: 'OpenAI' },
		{ id: 'anthropic', label: 'Anthropic' },
		{ id: 'openrouter', label: 'OpenRouter' }
	];

	const SAAS_PROVIDERS = [
		{ id: 'supabase_url', label: 'Supabase URL', placeholder: 'https://xxx.supabase.co', isUrl: true },
		{ id: 'supabase_key', label: 'Supabase Service Key', placeholder: 'eyJhbGciOiJIUzI1NiIs...' },
		{ id: 'stripe', label: 'Stripe Secret Key', placeholder: 'sk_test_... or sk_live_...' },
		{ id: 'v0', label: 'v0.dev API Key', placeholder: 'Optional - LLM fallback available' },
		{ id: 'elevenlabs', label: 'ElevenLabs API Key', placeholder: 'sk_...' },
		{ id: 'tavily', label: 'Tavily API Key', placeholder: 'tvly-...' }
	];

	const NAV_SECTIONS = ['keys', 'saas', 'connections', 'analytics', 'approvals', 'browser', 'preferences', 'about'];

	const SECTION_ALIASES = {
		llm: 'keys',
		'llm-keys': 'keys',
		'llm-api-keys': 'keys',
		'api-keys': 'keys',
		apikeys: 'keys',
		openai: 'keys',
		anthropic: 'keys',
		claude: 'keys',
		openrouter: 'keys',
		'saas-connectors': 'saas',
		saasconnectors: 'saas',
		connectors: 'saas',
		supabase: 'saas',
		stripe: 'saas',
		v0: 'saas',
		elevenlabs: 'saas',
		tavily: 'saas',
		'supabase-url': 'saas',
		'supabase-key': 'saas',
		github: 'connections',
		vercel: 'connections',
		oauth: 'connections',
		mcp: 'connections',
		a2a: 'about',
		'agent-card': 'about',
		analytics: 'analytics',
		cost: 'analytics',
		costs: 'analytics',
		spend: 'analytics',
		usage: 'analytics',
		'cost-analytics': 'analytics',
		prefs: 'preferences',
		preference: 'preferences',
		approvals: 'approvals',
		execution: 'approvals',
		'run-mode': 'approvals',
		runmode: 'approvals',
		agent: 'approvals',
		browser: 'browser',
		'browser-protection': 'browser',
		localhost: 'browser'
	};

	let currentSection = 'keys';

	let state = {
		keyMasks: {},
		configured: {},
		preferences: {
			defaultModel: 'openrouter/openrouter/free',
			autoIndexWorkspace: true,
			showCostEstimates: true,
			theme: 'auto'
		},
		runMode: 'auto-edit',
		agentSettings: {
			maxTurns: 25,
			includeOpenEditors: true,
			inlineDiffs: true,
			autoFormat: true,
			autoApproveModeSwitch: false,
			autoCloseTerminal: true,
			submitWithCtrlEnter: false
		},
		browserSettings: {
			openLocalLinks: true,
			allowAgentControl: true
		},
		connections: null,
		capabilities: null,
		analytics: null,
		mcpServers: [],
		a2aCardUrl: '',
		mcpError: {},
		mcpBusy: '',
		oauthError: {},
		oauthApps: {
			githubConfigured: false,
			vercelConfigured: false,
			githubCallback: 'http://127.0.0.1:8000/api/auth/github/callback',
			vercelCallback: 'http://127.0.0.1:8000/api/auth/vercel/callback'
		}
	};

	function resolveSection(raw) {
		const s = String(raw || '').trim().toLowerCase().replace(/^#/, '').replace(/_/g, '-');
		if (!s) {
			return currentSection || 'keys';
		}
		if (NAV_SECTIONS.indexOf(s) !== -1) {
			return s;
		}
		return SECTION_ALIASES[s] || 'keys';
	}

	function readInitialSection() {
		let fromQuery = '';
		let fromHash = '';
		try {
			fromQuery = new URLSearchParams(location.search || '').get('section') || '';
			fromHash = (location.hash || '').replace(/^#/, '');
		} catch {
			fromQuery = '';
			fromHash = '';
		}
		const fromData = document.body.getAttribute('data-section') || '';
		const raw = fromQuery || fromHash || fromData || 'keys';
		return resolveSection(raw);
	}

	function showSection(raw) {
		const id = resolveSection(raw);
		currentSection = id;
		document.querySelectorAll('.nx-section').forEach(el => {
			const active = el.getAttribute('data-section') === id;
			el.classList.toggle('active', active);
			if (active) {
				el.removeAttribute('hidden');
			} else {
				el.setAttribute('hidden', '');
			}
		});
		document.querySelectorAll('.nx-nav-item').forEach(el => {
			const selected = el.getAttribute('data-section') === id;
			el.classList.toggle('selected', selected);
			if (selected) {
				el.setAttribute('aria-current', 'page');
			} else {
				el.removeAttribute('aria-current');
			}
		});
	}

	function announce(msg) {
		const el = document.getElementById('sr-live');
		if (el) {
			el.textContent = msg;
		}
	}

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text === null || text === undefined ? '' : String(text);
		return div.innerHTML;
	}

	function money(value) {
		const n = Number(value || 0);
		return '$' + n.toFixed(4);
	}

	function renderAnalyticsSummary(summary) {
		const root = document.getElementById('summary-cards');
		if (!root) {
			return;
		}
		const cards = [
			{ label: 'Today', value: money(summary.today) },
			{ label: 'This week', value: money(summary.this_week), trend: summary.trend },
			{ label: 'This month', value: money(summary.this_month) }
		];
		root.innerHTML = cards.map(card => `
			<div class="nx-analytics-card">
				<div class="nx-analytics-cardLabel">${escapeHtml(card.label)}</div>
				<div class="nx-analytics-cardValue">${escapeHtml(card.value)}</div>
				${card.trend ? `<div class="nx-analytics-cardTrend">${escapeHtml(card.trend)} vs last week</div>` : ''}
			</div>
		`).join('');
	}

	function renderAnalyticsDaily(daily) {
		const root = document.getElementById('daily-chart');
		if (!root) {
			return;
		}
		const rows = daily || [];
		if (!rows.length) {
			root.innerHTML = '<div class="nx-empty">No cost data yet.</div>';
			return;
		}
		const max = Math.max(...rows.map(r => Number(r.cost || 0)), 0.0001);
		root.innerHTML = rows.map(row => {
			const cost = Number(row.cost || 0);
			const width = Math.max((cost / max) * 100, cost > 0 ? 4 : 0);
			const label = (row.date || '').slice(5);
			return `
				<div class="nx-analytics-dayRow">
					<span class="nx-muted">${escapeHtml(label)}</span>
					<div class="nx-analytics-barTrack"><div class="nx-analytics-barFill" style="width:${width}%"></div></div>
					<span>${money(cost)}</span>
				</div>
			`;
		}).join('');
	}

	function renderAnalyticsPlatforms(items) {
		const root = document.getElementById('platform-bars');
		if (!root) {
			return;
		}
		const rows = items || [];
		if (!rows.length) {
			root.innerHTML = '<div class="nx-empty">No platform spend yet.</div>';
			return;
		}
		root.innerHTML = rows.map(row => `
			<div class="nx-analytics-barRow">
				<span>${escapeHtml(row.platform)}</span>
				<div class="nx-analytics-barTrack"><div class="nx-analytics-barFill" style="width:${Math.max(Number(row.percentage || 0), 0)}%"></div></div>
				<span>${money(row.cost)}</span>
			</div>
		`).join('');
	}

	function renderAnalyticsStats(stats) {
		const root = document.getElementById('execution-stats');
		if (!root) {
			return;
		}
		root.innerHTML = `
			<div class="nx-analytics-statGrid">
				<div>Executions<br><strong>${escapeHtml(String(stats.total_executions || 0))}</strong></div>
				<div>Success rate<br><strong>${escapeHtml(String(stats.success_rate || 0))}%</strong></div>
				<div>Avg latency<br><strong>${escapeHtml(String(stats.avg_latency_ms || 0))} ms</strong></div>
				<div>Tokens<br><strong>${escapeHtml(String(stats.tokens_input || 0))} / ${escapeHtml(String(stats.tokens_output || 0))}</strong></div>
			</div>
		`;
	}

	function renderAnalyticsMemory(memory) {
		const root = document.getElementById('memory-insights');
		if (!root) {
			return;
		}
		const files = (memory.top_files || []).map(item => `
			<div class="nx-analytics-fileRow">
				<span>${escapeHtml(item.file_path)}</span>
				<span class="nx-muted">${escapeHtml(String(item.count))} hits</span>
			</div>
		`).join('') || '<div class="nx-empty">No retrievals this week.</div>';

		root.innerHTML = `
			<div class="nx-analytics-statGrid">
				<div>Workspaces<br><strong>${escapeHtml(String(memory.workspaces_indexed || 0))}</strong></div>
				<div>Indexed files<br><strong>${escapeHtml(String(memory.total_files || 0))}</strong></div>
				<div>Retrievals (7d)<br><strong>${escapeHtml(String(memory.retrievals_this_week || 0))}</strong></div>
				<div>Avg retrieval<br><strong>${escapeHtml(String(memory.avg_latency_ms || 0))} ms</strong></div>
				<div>Requests using memory<br><strong>${escapeHtml(String(memory.pct_requests_using_memory || 0))}%</strong></div>
				<div>Lookup hit rate<br><strong>${escapeHtml(String(memory.memory_hit_rate || 0))}%</strong></div>
			</div>
			<p class="nx-hint" style="margin-top:10px">
				Requests using memory counts ${escapeHtml(String(memory.requests_using_memory || 0))} of
				${escapeHtml(String(memory.total_requests || 0))} requests this week. Lookup hit rate is the
				share of memory queries that returned context.
			</p>
			<div style="margin-top:8px">${files}</div>
		`;
	}

	function renderAnalyticsRecent(rows) {
		const root = document.getElementById('recent-executions');
		if (!root) {
			return;
		}
		const items = rows || [];
		if (!items.length) {
			root.innerHTML = '<div class="nx-empty">No executions yet.</div>';
			return;
		}
		root.innerHTML = items.map(row => {
			const failed = String(row.status || '').toLowerCase() !== 'success';
			const when = row.completed_at ? String(row.completed_at).slice(11, 16) : '';
			const estimate = Number(row.estimated_cost_usd || 0);
			const actual = Number(row.cost_usd || 0);
			const drift = Math.abs(actual - estimate) > 0.0001
				? `<span class="nx-muted"> (est ${money(estimate)})</span>`
				: '';
			return `
				<div class="nx-analytics-recentRow${failed ? ' nx-analytics-recentRow-failed' : ''}">
					<span class="nx-analytics-recentPlatform">${escapeHtml(row.platform)}</span>
					<span class="nx-muted">${escapeHtml(row.operation)}</span>
					<span class="nx-analytics-recentStatus">${escapeHtml(row.status)}</span>
					<span class="nx-muted">${escapeHtml(String(row.duration_ms || 0))} ms</span>
					<span>${money(actual)}${drift}</span>
					<span class="nx-muted">${escapeHtml(when)}</span>
				</div>
			`;
		}).join('');
	}

	function renderAnalyticsAvailability(data) {
		const banner = document.getElementById('offline-banner');
		if (!banner) {
			return;
		}
		if (data && data.available === false) {
			banner.textContent = 'Backend unreachable - figures below are not current. '
				+ (data.error ? `(${data.error})` : '');
			banner.hidden = false;
		} else {
			banner.textContent = '';
			banner.hidden = true;
		}
	}

	function renderAnalytics() {
		const data = state.analytics;
		if (!data) {
			return;
		}
		renderAnalyticsAvailability(data);
		renderAnalyticsSummary(data.summary || {});
		renderAnalyticsDaily(data.daily || []);
		renderAnalyticsPlatforms(data.byPlatform || []);
		renderAnalyticsStats(data.stats || {});
		renderAnalyticsRecent(data.recent || []);
		renderAnalyticsMemory(data.memory || {});
	}

	function statusDot(status) {
		const s = status || 'not_configured';
		return `<span class="nx-dot ${escapeHtml(s)}" aria-hidden="true"></span>`;
	}

	function capabilityLabel(status) {
		switch (status) {
			case 'ready':
				return 'Ready';
			case 'not_configured':
				return 'Not configured';
			case 'unavailable':
				return 'Unavailable';
			case 'failed':
				return 'Failed';
			default:
				return 'Not configured';
		}
	}

	function llmCapability(id) {
		const status = state.capabilities && state.capabilities.llm && state.capabilities.llm[id];
		return status || 'not_configured';
	}

	function connectorCapability(id) {
		const status = state.capabilities && state.capabilities.connectors && state.capabilities.connectors[id];
		return status || 'not_configured';
	}

	function renderApiKeys() {
		const root = document.getElementById('api-keys');
		if (!root) {
			return;
		}

		root.innerHTML = PROVIDERS.map(p => {
			const configured = !!state.configured[p.id];
			const cap = llmCapability(p.id);
			const statusText = capabilityLabel(cap);
			return `
				<div class="nx-card" data-provider="${p.id}">
					<div class="nx-row">
						<span class="nx-label">${escapeHtml(p.label)}</span>
						<span class="nx-status">${statusDot(cap)}${escapeHtml(statusText)}</span>
					</div>
					<label class="sr-only" for="key-${p.id}">${escapeHtml(p.label)} API key</label>
					<input
						id="key-${p.id}"
						class="nx-input"
						type="password"
						autocomplete="off"
						spellcheck="false"
						aria-label="${escapeHtml(p.label)} API key"
						placeholder="${configured ? 'Enter new key to replace...' : 'Paste API key...'}"
					/>
					<div class="nx-actions">
						<button type="button" class="nx-btn nx-btn-secondary" data-action="test" data-provider="${p.id}" aria-label="Test ${escapeHtml(p.label)} key">Test</button>
						<button type="button" class="nx-btn" data-action="save" data-provider="${p.id}" aria-label="Save ${escapeHtml(p.label)} key">Save</button>
						<button type="button" class="nx-btn nx-btn-secondary" data-action="replace" data-provider="${p.id}" aria-label="Replace ${escapeHtml(p.label)} key" ${configured ? '' : 'disabled'}>Replace</button>
						<button type="button" class="nx-btn nx-btn-danger" data-action="clear" data-provider="${p.id}" aria-label="Clear ${escapeHtml(p.label)} key" ${configured ? '' : 'disabled'}>Clear</button>
					</div>
					<div class="nx-msg" id="msg-${p.id}" role="status"></div>
				</div>
			`;
		}).join('');

		root.querySelectorAll('button[data-action]').forEach(btn => {
			btn.addEventListener('click', () => {
				const action = btn.getAttribute('data-action');
				const provider = btn.getAttribute('data-provider');
				const input = document.getElementById(`key-${provider}`);
				const key = input ? input.value.trim() : '';

				if (action === 'replace') {
					if (input) {
						input.value = '';
						input.focus();
					}
					return;
				}

				if (action === 'test') {
					if (!key) {
						setMsg(provider, 'Enter a key to test', 'err');
						return;
					}
					setMsg(provider, 'Validating...', '');
					vscode.postMessage({ type: 'validateApiKey', provider, key });
				} else if (action === 'save') {
					if (!key) {
						setMsg(provider, 'Enter a key to save', 'err');
						return;
					}
					setMsg(provider, 'Saving...', '');
					vscode.postMessage({ type: 'saveApiKey', provider, key });
				} else if (action === 'clear') {
					vscode.postMessage({ type: 'clearApiKey', provider });
				}
			});
		});
	}

	function renderSaasKeys() {
		const root = document.getElementById('saas-keys');
		if (!root) {
			return;
		}

		root.innerHTML = SAAS_PROVIDERS.map(p => {
			const configured = !!state.configured[p.id];
			const cap = configured ? 'ready' : 'not_configured';
			const statusText = capabilityLabel(cap);
			return `
				<div class="nx-card" data-provider="${p.id}">
					<div class="nx-row">
						<span class="nx-label">${escapeHtml(p.label)}</span>
						<span class="nx-status">${statusDot(cap)}${escapeHtml(statusText)}</span>
					</div>
					<label class="sr-only" for="key-${p.id}">${escapeHtml(p.label)}</label>
					<input
						id="key-${p.id}"
						class="nx-input"
						type="${p.isUrl ? 'text' : 'password'}"
						autocomplete="off"
						spellcheck="false"
						aria-label="${escapeHtml(p.label)}"
						placeholder="${configured ? 'Enter new value to replace...' : (p.placeholder || 'Enter value...')}"
					/>
					<div class="nx-actions">
						<button type="button" class="nx-btn nx-btn-secondary" data-saas-action="test" data-provider="${p.id}" aria-label="Test ${escapeHtml(p.label)}">Test</button>
						<button type="button" class="nx-btn" data-saas-action="save" data-provider="${p.id}" aria-label="Save ${escapeHtml(p.label)}">Save</button>
						<button type="button" class="nx-btn nx-btn-secondary" data-saas-action="replace" data-provider="${p.id}" aria-label="Replace ${escapeHtml(p.label)}" ${configured ? '' : 'disabled'}>Replace</button>
						<button type="button" class="nx-btn nx-btn-danger" data-saas-action="clear" data-provider="${p.id}" aria-label="Clear ${escapeHtml(p.label)}" ${configured ? '' : 'disabled'}>Clear</button>
					</div>
					<div class="nx-msg" id="msg-${p.id}" role="status"></div>
				</div>
			`;
		}).join('');

		root.querySelectorAll('button[data-saas-action]').forEach(btn => {
			btn.addEventListener('click', () => {
				const action = btn.getAttribute('data-saas-action');
				const provider = btn.getAttribute('data-provider');
				const input = document.getElementById(`key-${provider}`);
				const value = input ? input.value.trim() : '';

				if (action === 'replace') {
					if (input) {
						input.value = '';
						input.focus();
					}
					return;
				}

				if (action === 'test') {
					if (!value) {
						setMsg(provider, 'Enter a value to test', 'err');
						return;
					}
					setMsg(provider, 'Testing...', '');
					vscode.postMessage({ type: 'testSaasKey', provider, value });
				} else if (action === 'save') {
					if (!value) {
						setMsg(provider, 'Enter a value to save', 'err');
						return;
					}
					setMsg(provider, 'Saving...', '');
					vscode.postMessage({ type: 'saveSaasKey', provider, value });
				} else if (action === 'clear') {
					vscode.postMessage({ type: 'clearSaasKey', provider });
				}
			});
		});
	}

	function setMsg(provider, text, cls) {
		const el = document.getElementById(`msg-${provider}`);
		if (!el) {
			return;
		}
		el.className = `nx-msg ${cls || ''}`;
		el.textContent = text;
		if (text) {
			announce(text);
		}
	}

	function renderConnections() {
		const root = document.getElementById('connections');
		if (!root) {
			return;
		}

		const c = state.connections;
		if (!c) {
			root.innerHTML = '<p class="nx-hint">Loading connection status from backend...</p>';
			return;
		}

		const llmRows = Object.entries(c.llm || {}).map(([id, info]) => providerRow(id, overlayLlm(id, info), 'llm'));
		const deployRows = Object.entries(c.deployment || {}).map(([id, info]) => providerRow(id, overlayConnector(id, info), 'deployment'));
		const dbRows = Object.entries(c.database || {}).map(([id, info]) => providerRow(id, info, 'database'));
		const saasRows = Object.entries(c.saas || {}).map(([id, info]) => providerRow(id, info, 'saas'));
		const extraConnectors = ['crewai', 'gpt_researcher'].filter(id => !(c.deployment || {})[id] && !(c.saas || {})[id]);
		const extraRows = extraConnectors.map(id => providerRow(id, { status: connectorCapability(id) }, 'connector'));

		root.innerHTML = `
			${renderOAuthAppCard()}
			<div class="nx-card">
				<div class="nx-label" style="margin-bottom:8px">LLM (IDE keys preferred, .env fallback)</div>
				${llmRows.join('') || '<p class="nx-hint">None</p>'}
			</div>
			<div class="nx-card">
				<div class="nx-label" style="margin-bottom:8px">Deployment (OAuth / tokens)</div>
				${deployRows.join('') || '<p class="nx-hint">None</p>'}
			</div>
			<div class="nx-card">
				<div class="nx-label" style="margin-bottom:8px">Database</div>
				${dbRows.join('') || '<p class="nx-hint">None</p>'}
			</div>
			<div class="nx-card">
				<div class="nx-label" style="margin-bottom:8px">SaaS (API keys in backend .env)</div>
				${saasRows.join('') || '<p class="nx-hint">None</p>'}
			</div>
			${extraRows.length ? `<div class="nx-card">
				<div class="nx-label" style="margin-bottom:8px">Bundled connectors</div>
				${extraRows.join('')}
			</div>` : ''}
			${renderMcpCard()}
		`;

		root.querySelectorAll('button[data-oauth]').forEach(btn => {
			btn.addEventListener('click', () => {
				vscode.postMessage({
					type: btn.getAttribute('data-oauth'),
					provider: btn.getAttribute('data-provider')
				});
			});
		});

		root.querySelectorAll('button[data-oauth-app]').forEach(btn => {
			btn.addEventListener('click', () => {
				const action = btn.getAttribute('data-oauth-app');
				const provider = btn.getAttribute('data-provider');
				const input = document.getElementById(`key-${provider}`);
				const value = input ? input.value.trim() : '';
				if (action === 'save') {
					if (!value) {
						setMsg(provider, 'Enter a value to save', 'err');
						return;
					}
					setMsg(provider, 'Saving...', '');
					vscode.postMessage({ type: 'saveSaasKey', provider, value });
				} else if (action === 'clear') {
					vscode.postMessage({ type: 'clearSaasKey', provider });
				}
			});
		});

		root.querySelectorAll('button[data-test-env]').forEach(btn => {
			btn.addEventListener('click', () => {
				vscode.postMessage({
					type: 'testEnvConnection',
					provider: btn.getAttribute('data-provider')
				});
			});
		});

		root.querySelectorAll('button[data-mcp]').forEach(btn => {
			btn.addEventListener('click', () => {
				if (btn.disabled) {
					return;
				}
				vscode.postMessage({
					type: btn.getAttribute('data-mcp'),
					serverId: btn.getAttribute('data-server')
				});
			});
		});
	}

	function renderOAuthAppCard() {
		const apps = state.oauthApps || {};
		const githubCb = apps.githubCallback || 'http://127.0.0.1:8000/api/auth/github/callback';
		const vercelCb = apps.vercelCallback || 'http://127.0.0.1:8000/api/auth/vercel/callback';
		const fields = [
			{ id: 'github_client_id', label: 'GitHub Client ID', placeholder: 'Ov...' },
			{ id: 'github_client_secret', label: 'GitHub Client Secret', placeholder: 'Client secret' },
			{ id: 'vercel_client_id', label: 'Vercel Client ID', placeholder: 'Client ID' },
			{ id: 'vercel_client_secret', label: 'Vercel Client Secret', placeholder: 'Client secret' }
		];
		const inputs = fields.map(p => {
			const configured = !!state.configured[p.id];
			const prev = document.getElementById(`key-${p.id}`);
			const prevVal = prev ? prev.value : '';
			return `
				<label class="nx-label" for="key-${p.id}">${escapeHtml(p.label)}</label>
				<input id="key-${p.id}" class="nx-input" type="password" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(p.label)}" placeholder="${configured ? 'Saved. Enter a new value to replace...' : escapeHtml(p.placeholder)}" value="${escapeHtml(prevVal)}" />
				<div class="nx-actions">
					<button type="button" class="nx-btn" data-oauth-app="save" data-provider="${p.id}">Save</button>
					<button type="button" class="nx-btn nx-btn-secondary" data-oauth-app="clear" data-provider="${p.id}" ${configured ? '' : 'disabled'}>Clear</button>
				</div>
				<div class="nx-msg" id="msg-${p.id}" role="status"></div>
			`;
		}).join('');
		return `<div class="nx-card">
			<div class="nx-label" style="margin-bottom:8px">OAuth app credentials</div>
			<p class="nx-hint">Nexora does not create the GitHub app. GitHub → Settings → Developer settings → OAuth Apps → New. Paste the callback URL below into the GitHub app. Same for Vercel (create an OAuth App, paste its callback).</p>
			<p class="nx-hint">GitHub callback (exact): <code>${escapeHtml(githubCb)}</code></p>
			<p class="nx-hint">Vercel callback (exact): <code>${escapeHtml(vercelCb)}</code></p>
			${inputs}
		</div>`;
	}

	function mcpStatus(row) {
		if (row.connected) {
			return 'ready';
		}
		if ((row.missing_requires || []).length || (row.transport === 'http' && !row.endpoint)) {
			return 'not_configured';
		}
		return 'not_configured';
	}

	function mcpBlockedReason(row) {
		if ((row.missing_requires || []).length) {
			return 'Save ' + row.missing_requires.join(', ') + ' in SaaS Connectors first';
		}
		if (row.transport === 'http' && !row.endpoint) {
			return 'No local MCP endpoint';
		}
		return '';
	}

	function renderMcpCard() {
		const rows = state.mcpServers || [];
		if (!rows.length) {
			return `<div class="nx-card">
				<div class="nx-label" style="margin-bottom:8px">MCP servers</div>
				<p class="nx-hint">No MCP servers listed. Engine may be offline.</p>
			</div>`;
		}
		const items = rows.map(row => {
			const status = mcpStatus(row);
			const id = escapeHtml(row.id || '');
			const blockedReason = mcpBlockedReason(row);
			const busy = state.mcpBusy === row.id;
			const err = state.mcpError && state.mcpError[row.id];
			const detail = row.connected
				? `${row.transport} | ${row.tools_count || 0} tools`
				: ((row.missing_requires || []).length
					? `Missing ${row.missing_requires.join(', ')}`
					: (!row.endpoint && row.transport === 'http'
						? 'No local MCP endpoint'
						: (row.description || row.transport || '')));
			let action;
			if (row.connected) {
				action = `<button type="button" class="nx-btn nx-btn-secondary" data-mcp="disconnectMcp" data-server="${id}">Disconnect</button>`;
			} else {
				const disabled = blockedReason || busy ? 'disabled' : '';
				const label = busy ? 'Connecting...' : 'Connect';
				const title = escapeHtml(blockedReason || (busy ? 'Connecting...' : 'Connect'));
				action = `<button type="button" class="nx-btn" data-mcp="connectMcp" data-server="${id}" ${disabled} title="${title}">${label}</button>`;
			}
			const errLine = err ? `<div class="nx-msg err">${escapeHtml(err)}</div>` : '';
			return `
				<div class="nx-row">
					<div>
						<div class="nx-label">${escapeHtml(row.name || row.id)}</div>
						<div class="nx-status">${statusDot(status)} ${escapeHtml(detail)}</div>
						${errLine}
					</div>
					<div class="nx-actions" style="margin:0">${action}</div>
				</div>
			`;
		}).join('');
		return `<div class="nx-card">
			<div class="nx-label" style="margin-bottom:8px">MCP servers (8 registered)</div>
			<p class="nx-hint">HTTP sockets use LOCAL_ENDPOINTS. Missing keys or endpoints stay Not configured. Filesystem MCP is stdio (npx), not a browser login.</p>
			${items}
		</div>`;
	}

	function renderA2A() {
		const root = document.getElementById('a2a-root');
		if (!root) {
			return;
		}
		const cardUrl = state.a2aCardUrl || '';
		const prevUrl = document.getElementById('a2a-url') ? document.getElementById('a2a-url').value : '';
		const prevTask = document.getElementById('a2a-task') ? document.getElementById('a2a-task').value : '';
		root.innerHTML = `
			<div class="nx-card">
				<div class="nx-label">A2A agent card</div>
				<p class="nx-hint">${cardUrl ? escapeHtml(cardUrl) : 'Engine URL unavailable'}</p>
				<label class="nx-label" for="a2a-url">External agent URL</label>
				<input id="a2a-url" class="nx-input" type="url" placeholder="https://agent.example/.well-known/agent-card.json" aria-label="External A2A agent URL" />
				<label class="nx-label" for="a2a-task" style="margin-top:8px">Task</label>
				<input id="a2a-task" class="nx-input" type="text" placeholder="Short request to delegate" aria-label="A2A task request" />
				<div class="nx-actions">
					<button type="button" class="nx-btn" id="a2a-delegate">Delegate</button>
				</div>
				<div class="nx-msg" id="msg-a2a" role="status"></div>
			</div>
		`;
		const urlEl = document.getElementById('a2a-url');
		const taskEl = document.getElementById('a2a-task');
		if (urlEl) {
			urlEl.value = prevUrl;
		}
		if (taskEl) {
			taskEl.value = prevTask;
		}
		document.getElementById('a2a-delegate')?.addEventListener('click', () => {
			const agentUrl = urlEl ? urlEl.value.trim() : '';
			const request = taskEl ? taskEl.value.trim() : '';
			if (!agentUrl) {
				setMsg('a2a', 'Enter an external agent URL', 'err');
				return;
			}
			setMsg('a2a', 'Delegating...', '');
			vscode.postMessage({ type: 'a2aDelegate', agentUrl, request });
		});
	}

	function overlayLlm(id, info) {
		if (info?.status === 'error') {
			return Object.assign({}, info || {}, { status: 'failed' });
		}
		if (info?.status === 'connected') {
			return Object.assign({}, info || {}, { status: 'ready' });
		}
		const status = llmCapability(id);
		return Object.assign({}, info || {}, { status });
	}

	function overlayConnector(id, info) {
		if (id === 'crewai' || id === 'gpt_researcher') {
			return Object.assign({}, info || {}, { status: connectorCapability(id) });
		}
		const raw = info?.status;
		const status = raw === 'connected' ? 'ready' : (raw === 'error' ? 'failed' : (raw || 'not_configured'));
		return Object.assign({}, info || {}, { status });
	}

	function providerRow(id, info, category) {
		let status = info?.status || 'not_configured';
		if (status === 'connected') {
			status = 'ready';
		} else if (status === 'error') {
			status = 'failed';
		}
		if (status !== 'ready' && status !== 'not_configured' && status !== 'unavailable' && status !== 'failed') {
			status = 'not_configured';
		}
		const detailParts = [];
		if (info?.username) {
			detailParts.push(`@${info.username}`);
		}
		if (info?.team) {
			detailParts.push(info.team);
		}
		if (info?.models?.length) {
			detailParts.push(info.models.slice(0, 2).join(', '));
		}
		if (info?.error) {
			detailParts.push(info.error);
		}
		const detail = detailParts.join(' · ') || capabilityLabel(status);
		const oauthErr = (id === 'github' || id === 'vercel') && state.oauthError && state.oauthError[id];
		const errLine = oauthErr ? `<div class="nx-msg err">${escapeHtml(oauthErr)}</div>` : '';

		let actions = '';
		if (category === 'deployment' && (id === 'github' || id === 'vercel')) {
			if (status === 'ready') {
				actions = `<button type="button" class="nx-btn nx-btn-secondary" data-oauth="disconnectOAuth" data-provider="${escapeHtml(id)}" aria-label="Disconnect ${escapeHtml(id)}">Disconnect</button>`;
			} else if (status !== 'unavailable') {
				actions = `<button type="button" class="nx-btn" data-oauth="connectOAuth" data-provider="${escapeHtml(id)}" aria-label="Connect ${escapeHtml(id)}">Connect</button>`;
			}
		} else if (category === 'llm' || category === 'saas') {
			actions = `<button type="button" class="nx-btn nx-btn-secondary" data-test-env="1" data-provider="${escapeHtml(id)}" aria-label="Test ${escapeHtml(id)} connection">Test</button>`;
		}

		return `
			<div class="nx-row">
				<div>
					<div class="nx-label">${escapeHtml(id)}</div>
					<div class="nx-status">${statusDot(status)} ${escapeHtml(detail)}</div>
					${errLine}
				</div>
				<div class="nx-actions" style="margin:0">${actions}</div>
			</div>
		`;
	}

	function renderRunMode() {
		const root = document.getElementById('run-mode');
		if (!root) {
			return;
		}
		const modes = [
			{ id: 'ask', label: 'Ask', desc: 'Confirm every file edit and terminal command.' },
			{ id: 'auto-edit', label: 'Auto-edit', desc: 'Apply file edits without asking. Terminal still asks Allow/Deny.' },
			{ id: 'allowlist', label: 'Allowlist', desc: 'Apply file edits without asking. Safe commands (npm, git, python, …) skip Allow/Deny.' },
			{ id: 'run-everything', label: 'Run everything', desc: 'Apply files and run terminal without asking. Dangerous commands stay blocked.' }
		];
		const current = modes.some(m => m.id === state.runMode) ? state.runMode : 'auto-edit';
		const selected = modes.find(m => m.id === current) || modes[1];
		const a = state.agentSettings || {};
		const maxTurns = [10, 15, 25, 40].indexOf(a.maxTurns) >= 0 ? a.maxTurns : 25;

		root.innerHTML = `
			<div class="nx-card">
				<div class="nx-row" style="align-items:flex-start">
					<div>
						<label class="nx-label" for="pref-run-mode">Run Mode</label>
						<p class="nx-hint" id="run-mode-desc">${escapeHtml(selected.desc)}</p>
					</div>
					<select id="pref-run-mode" class="nx-select nx-select-inline" aria-label="Run Mode" aria-describedby="run-mode-desc">
						${modes.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('')}
					</select>
				</div>
			</div>
			<div class="nx-card">
				<div class="nx-row" style="align-items:flex-start">
					<div>
						<label class="nx-label" for="pref-max-turns">Max agent turns</label>
						<p class="nx-hint">Stop the Ask/Agent loop after this many LLM turns.</p>
					</div>
					<select id="pref-max-turns" class="nx-select nx-select-inline" aria-label="Max agent turns">
						<option value="10">10</option>
						<option value="15">15</option>
						<option value="25">25</option>
						<option value="40">40</option>
					</select>
				</div>
			</div>
			${execToggle('pref-include-editors', 'Include open editors', 'Attach the active editor and other open files on send (up to 5).', a.includeOpenEditors !== false)}
			${execToggle('pref-inline-diffs', 'Inline diffs', 'Show a non-blocking diff when Auto-edit applies files. Ask mode still waits for Accept.', a.inlineDiffs !== false)}
			${execToggle('pref-auto-format', 'Auto-format', 'Format the file after a successful write, patch, or insert.', a.autoFormat !== false)}
			${execToggle('pref-auto-approve', 'Auto-approve mode transitions', 'Skip Approve & Execute after Plan and run immediately.', !!a.autoApproveModeSwitch)}
			${execToggle('pref-auto-close-term', 'Auto-close agent terminal', 'Close the Nexora Agent terminal shortly after a command finishes.', a.autoCloseTerminal !== false)}
		`;

		const select = document.getElementById('pref-run-mode');
		if (select) {
			select.value = current;
			select.addEventListener('change', () => {
				const next = modes.find(m => m.id === select.value) || selected;
				const desc = document.getElementById('run-mode-desc');
				if (desc) {
					desc.textContent = next.desc;
				}
				vscode.postMessage({ type: 'saveRunMode', runMode: select.value });
			});
		}
		const turns = document.getElementById('pref-max-turns');
		if (turns) {
			turns.value = String(maxTurns);
			turns.addEventListener('change', () => {
				vscode.postMessage({ type: 'saveConfig', key: 'agent.maxTurns', value: Number(turns.value) });
			});
		}
		bindConfigToggle('pref-include-editors', 'agent.includeOpenEditors');
		bindConfigToggle('pref-inline-diffs', 'agent.inlineDiffs');
		bindConfigToggle('pref-auto-format', 'agent.autoFormat');
		bindConfigToggle('pref-auto-approve', 'agent.autoApproveModeSwitch');
		bindConfigToggle('pref-auto-close-term', 'agent.autoCloseTerminal');
	}

	function renderBrowser() {
		const root = document.getElementById('browser-settings');
		if (!root) {
			return;
		}
		const b = state.browserSettings || {};
		root.innerHTML = `
			${execToggle('pref-open-local-links', 'Open local links in Nexora Browser', 'Localhost URLs from chat open in the in-IDE browser instead of system Chrome.', b.openLocalLinks !== false)}
			${execToggle('pref-allow-agent-browser', 'Allow agent browser control', 'The agent may open, read, click, and type in the browser. Off denies all browser tools (Browser Protection).', b.allowAgentControl !== false)}
		`;
		bindConfigToggle('pref-open-local-links', 'browser.openLocalLinks');
		bindConfigToggle('pref-allow-agent-browser', 'browser.allowAgentControl');
	}

	function execToggle(id, label, hint, checked) {
		return `
			<div class="nx-card">
				<div class="nx-row" style="align-items:flex-start">
					<div>
						<label class="nx-label" for="${id}">${escapeHtml(label)}</label>
						<p class="nx-hint">${escapeHtml(hint)}</p>
					</div>
					<label class="nx-check">
						<input type="checkbox" id="${id}" ${checked ? 'checked' : ''} aria-label="${escapeHtml(label)}" />
					</label>
				</div>
			</div>
		`;
	}

	function bindConfigToggle(id, key) {
		const el = document.getElementById(id);
		if (!el) {
			return;
		}
		el.addEventListener('change', () => {
			vscode.postMessage({ type: 'saveConfig', key: key, value: el.checked });
		});
	}

	function renderPreferences() {
		const root = document.getElementById('preferences');
		if (!root) {
			return;
		}
		const p = state.preferences;

		root.innerHTML = `
			<div class="nx-card">
				<label class="nx-label" for="pref-model">Default model</label>
				<select id="pref-model" class="nx-select" aria-label="Default model">
					<option value="openrouter/openrouter/free">OpenRouter Free</option>
					<option value="openrouter/auto">OpenRouter Auto</option>
					<option value="openai/gpt-4o-mini">GPT-4o Mini (fallback)</option>
					<option value="openai/gpt-4o">GPT-4o</option>
					<option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
				</select>
			</div>
			<div class="nx-card">
				<label class="nx-check">
					<input type="checkbox" id="pref-auto-index" ${p.autoIndexWorkspace ? 'checked' : ''} aria-label="Auto-index workspace" />
					Auto-index workspace
				</label>
			</div>
			<div class="nx-card">
				<label class="nx-check">
					<input type="checkbox" id="pref-costs" ${p.showCostEstimates ? 'checked' : ''} aria-label="Show cost estimates" />
					Show cost estimates
				</label>
			</div>
			<div class="nx-card">
				<div class="nx-row" style="align-items:flex-start">
					<div>
						<label class="nx-label" for="pref-ctrl-enter">Submit with Ctrl+Enter</label>
						<p class="nx-hint">Ctrl+Enter sends. Enter inserts a newline.</p>
					</div>
					<label class="nx-check">
						<input type="checkbox" id="pref-ctrl-enter" ${(state.agentSettings && state.agentSettings.submitWithCtrlEnter) ? 'checked' : ''} aria-label="Submit with Ctrl+Enter" />
					</label>
				</div>
			</div>
		`;

		const model = document.getElementById('pref-model');
		if (model) {
			model.value = p.defaultModel;
			model.addEventListener('change', () => {
				vscode.postMessage({ type: 'savePreferences', preferences: { defaultModel: model.value } });
			});
		}
		const autoIndex = document.getElementById('pref-auto-index');
		if (autoIndex) {
			autoIndex.addEventListener('change', () => {
				vscode.postMessage({ type: 'savePreferences', preferences: { autoIndexWorkspace: autoIndex.checked } });
			});
		}
		const costs = document.getElementById('pref-costs');
		if (costs) {
			costs.addEventListener('change', () => {
				vscode.postMessage({ type: 'savePreferences', preferences: { showCostEstimates: costs.checked } });
			});
		}
		bindConfigToggle('pref-ctrl-enter', 'chat.submitWithCtrlEnter');
	}

	function bindChrome() {
		document.querySelectorAll('.nx-nav-item').forEach(btn => {
			btn.addEventListener('click', () => {
				showSection(btn.getAttribute('data-section'));
			});
		});
		const refresh = document.getElementById('refresh-status');
		if (refresh) {
			refresh.addEventListener('click', () => {
				vscode.postMessage({ type: 'refreshStatus' });
			});
		}
		const refreshAnalytics = document.getElementById('refresh-analytics');
		if (refreshAnalytics) {
			refreshAnalytics.addEventListener('click', () => {
				vscode.postMessage({ type: 'refreshAnalytics' });
			});
		}
		const shortcuts = document.getElementById('show-shortcuts');
		if (shortcuts) {
			shortcuts.addEventListener('click', () => {
				vscode.postMessage({ type: 'showShortcuts' });
			});
		}
	}

	window.addEventListener('message', event => {
		const msg = event.data;
		switch (msg.type) {
			case 'showSection':
				showSection(msg.section);
				break;
			case 'init':
			case 'updateState':
				state = {
					...state,
					keyMasks: msg.keyMasks || state.keyMasks,
					configured: msg.configured || state.configured,
					preferences: msg.preferences || state.preferences,
					runMode: msg.runMode || state.runMode,
					agentSettings: msg.agentSettings || state.agentSettings,
					browserSettings: msg.browserSettings || state.browserSettings,
					connections: msg.connections !== undefined ? msg.connections : state.connections,
					capabilities: msg.capabilities !== undefined ? msg.capabilities : state.capabilities,
					analytics: msg.analytics !== undefined ? msg.analytics : state.analytics,
					mcpServers: msg.mcpServers !== undefined ? msg.mcpServers : state.mcpServers,
					a2aCardUrl: msg.a2aCardUrl !== undefined ? msg.a2aCardUrl : state.a2aCardUrl,
					oauthApps: msg.oauthApps !== undefined ? msg.oauthApps : state.oauthApps
				};
				renderApiKeys();
				renderSaasKeys();
				renderConnections();
				renderRunMode();
				renderBrowser();
				renderPreferences();
				renderAnalytics();
				renderA2A();
				break;
			case 'validateResult':
				setMsg(msg.provider, msg.success ? (msg.details || 'Key is valid') : (msg.error || 'Invalid key'), msg.success ? 'ok' : 'err');
				break;
			case 'saveResult':
				setMsg(msg.provider, msg.success ? 'Saved. This key is now used for Chat / Plan / Agent.' : (msg.error || 'Save failed'), msg.success ? 'ok' : 'err');
				if (msg.success) {
					const input = document.getElementById(`key-${msg.provider}`);
					if (input) {
						input.value = '';
					}
				}
				break;
			case 'clearResult':
				setMsg(msg.provider, msg.success ? 'Cleared from SecretStorage' : (msg.error || 'Clear failed'), msg.success ? 'ok' : 'err');
				break;
			case 'oauthResult':
				if (!state.oauthError) {
					state.oauthError = {};
				}
				if (msg.provider) {
					if (msg.error) {
						state.oauthError[msg.provider] = msg.error;
					} else {
						delete state.oauthError[msg.provider];
					}
				}
				announce(msg.error || msg.message || 'OAuth update');
				renderConnections();
				break;
			case 'mcpProgress':
				state.mcpBusy = msg.busy ? msg.serverId : '';
				renderConnections();
				break;
			case 'mcpResult':
				if (!state.mcpError) {
					state.mcpError = {};
				}
				if (msg.error) {
					state.mcpError[msg.serverId] = msg.error;
				} else if (msg.serverId) {
					delete state.mcpError[msg.serverId];
				}
				state.mcpBusy = '';
				renderConnections();
				break;
			case 'a2aResult':
				setMsg('a2a', msg.success ? (msg.details || 'Delegated') : (msg.error || 'Delegate failed'), msg.success ? 'ok' : 'err');
				break;
			// Week 13: SaaS connector key handling
			case 'saasTestResult':
				setMsg(msg.provider, msg.success ? (msg.details || 'Connection successful') : (msg.error || 'Connection failed'), msg.success ? 'ok' : 'err');
				break;
			case 'saasSaveResult':
				setMsg(msg.provider, msg.success ? 'Saved to backend .env' : (msg.error || 'Save failed'), msg.success ? 'ok' : 'err');
				if (msg.success) {
					const input = document.getElementById(`key-${msg.provider}`);
					if (input) {
						input.value = '';
					}
					state.configured[msg.provider] = true;
					renderSaasKeys();
					renderConnections();
				}
				break;
			case 'saasClearResult':
				setMsg(msg.provider, msg.success ? 'Cleared from backend' : (msg.error || 'Clear failed'), msg.success ? 'ok' : 'err');
				if (msg.success) {
					state.configured[msg.provider] = false;
					renderSaasKeys();
					renderConnections();
				}
				break;
		}
	});

	bindChrome();
	showSection(readInitialSection());
	renderApiKeys();
	renderSaasKeys();
	renderConnections();
	renderRunMode();
	renderBrowser();
	renderPreferences();
	renderAnalytics();
	renderA2A();
	vscode.postMessage({ type: 'ready' });
})();
