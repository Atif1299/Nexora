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

	let state = {
		keyMasks: {},
		configured: {},
		preferences: {
			defaultModel: 'openrouter/openrouter/free',
			autoIndexWorkspace: true,
			showCostEstimates: true,
			theme: 'auto'
		},
		connections: null
	};

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

	function statusDot(status) {
		const s = status || 'not_configured';
		return `<span class="nx-dot ${escapeHtml(s)}" aria-hidden="true"></span>`;
	}

	function renderApiKeys() {
		const root = document.getElementById('api-keys');
		if (!root) {
			return;
		}

		root.innerHTML = PROVIDERS.map(p => {
			const configured = !!state.configured[p.id];
			const statusText = configured ? 'Saved locally (••••••••)' : 'Not saved in IDE';
			return `
				<div class="nx-card" data-provider="${p.id}">
					<div class="nx-row">
						<span class="nx-label">${escapeHtml(p.label)}</span>
						<span class="nx-status">${statusDot(configured ? 'connected' : 'not_configured')}${statusText}</span>
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
			const statusText = configured ? 'Saved (••••••••)' : 'Not configured';
			return `
				<div class="nx-card" data-provider="${p.id}">
					<div class="nx-row">
						<span class="nx-label">${escapeHtml(p.label)}</span>
						<span class="nx-status">${statusDot(configured ? 'connected' : 'not_configured')}${statusText}</span>
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

		const llmRows = Object.entries(c.llm || {}).map(([id, info]) => providerRow(id, info, 'llm'));
		const deployRows = Object.entries(c.deployment || {}).map(([id, info]) => providerRow(id, info, 'deployment'));
		const dbRows = Object.entries(c.database || {}).map(([id, info]) => providerRow(id, info, 'database'));
		const saasRows = Object.entries(c.saas || {}).map(([id, info]) => providerRow(id, info, 'saas'));

		root.innerHTML = `
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
		`;

		root.querySelectorAll('button[data-oauth]').forEach(btn => {
			btn.addEventListener('click', () => {
				vscode.postMessage({
					type: btn.getAttribute('data-oauth'),
					provider: btn.getAttribute('data-provider')
				});
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
	}

	function providerRow(id, info, category) {
		const status = info?.status || 'not_configured';
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
		const detail = detailParts.join(' · ') || status.replace('_', ' ');

		let actions = '';
		if (category === 'deployment' && (id === 'github' || id === 'vercel')) {
			if (status === 'connected') {
				actions = `<button type="button" class="nx-btn nx-btn-secondary" data-oauth="disconnectOAuth" data-provider="${escapeHtml(id)}" aria-label="Disconnect ${escapeHtml(id)}">Disconnect</button>`;
			} else {
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
				</div>
				<div class="nx-actions" style="margin:0">${actions}</div>
			</div>
		`;
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
	}

	function bindChrome() {
		const refresh = document.getElementById('refresh-status');
		if (refresh) {
			refresh.addEventListener('click', () => {
				vscode.postMessage({ type: 'refreshStatus' });
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
			case 'init':
			case 'updateState':
				state = {
					...state,
					keyMasks: msg.keyMasks || state.keyMasks,
					configured: msg.configured || state.configured,
					preferences: msg.preferences || state.preferences,
					connections: msg.connections !== undefined ? msg.connections : state.connections
				};
				renderApiKeys();
				renderSaasKeys();
				renderConnections();
				renderPreferences();
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
				announce(msg.message || 'OAuth update');
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
				}
				break;
			case 'saasClearResult':
				setMsg(msg.provider, msg.success ? 'Cleared from backend' : (msg.error || 'Clear failed'), msg.success ? 'ok' : 'err');
				if (msg.success) {
					state.configured[msg.provider] = false;
					renderSaasKeys();
				}
				break;
		}
	});

	bindChrome();
	renderApiKeys();
	renderSaasKeys();
	renderConnections();
	renderPreferences();
	vscode.postMessage({ type: 'ready' });
})();
