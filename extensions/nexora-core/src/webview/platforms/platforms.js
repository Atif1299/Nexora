/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {
	const vscode = acquireVsCodeApi();

	/** Filter text, the All / Connected / Available tab, and collapsed groups; kept while the panel is hidden. */
	const saved = vscode.getState() || {};
	const view = {
		query: '',
		filter: saved.filter === 'connected' || saved.filter === 'live' ? saved.filter : 'all',
		collapsed: Array.isArray(saved.collapsed) ? saved.collapsed : [],
		discoverOpen: saved.discoverOpen === true
	};
	let lastData = null;
	/** The open detail view: the row's id and the tools the panel sent (null while loading). */
	const detail = { id: '', data: null };

	function saveView() {
		vscode.setState({ filter: view.filter, collapsed: view.collapsed, discoverOpen: view.discoverOpen });
	}

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text === null || text === undefined ? '' : String(text);
		// Safe inside attributes too: names and descriptions come from MCP servers and config files.
		return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	function announce(msg) {
		const el = document.getElementById('sr-live');
		if (el) {
			el.textContent = msg;
		}
	}

	function isBlocked(status) {
		return status === 'not_configured' || status === 'unavailable' || status === 'failed';
	}

	/** Rows whose Connect is a browser sign-in (GitHub, Vercel). Key rows open Settings instead. */
	function isBrowserOAuth(platform) {
		return platform.id === 'github' || platform.id === 'vercel';
	}

	function isConnected(platform) {
		return !!platform.live && platform.capabilityStatus === 'ready';
	}

	const USE_IN = { chat: 'Chat', agent: 'Agent', plans: 'Plans', models: 'Models', code_steps: 'Code steps' };

	/** Mirrors services/platformUsage.ts: the chips under a row. */
	function useInLabels(usage) {
		return usage && Array.isArray(usage.usable_in) ? usage.usable_in.map((key) => USE_IN[key] || key) : [];
	}

	/** Mirrors services/platformUsage.ts toolSummary. */
	function toolSummary(usage) {
		const tools = usage && usage.tools;
		if (!tools || !tools.total) {
			return '';
		}
		const changing = tools.write + tools.destructive;
		const count = tools.enabled === tools.total ? `${tools.total} tools` : `${tools.enabled} of ${tools.total} tools on`;
		return changing ? `${count}, ${changing} can change things` : `${count}, read only`;
	}

	function statusLabel(platform) {
		if (platform.custom) {
			return SERVER_STATE[platform.custom.state] || platform.custom.state;
		}
		if (platform.discover) {
			return 'Not usable yet';
		}
		// Model rows: the key lives in Settings, so the only question is whether one is saved.
		if (platform.keyProvider) {
			if (platform.capabilityStatus === 'ready') {
				return 'Ready';
			}
			return platform.capabilityStatus === 'failed' ? 'Failed' : 'Add a key';
		}
		if (!platform.live) {
			return 'Catalogue';
		}
		const status = platform.capabilityStatus;
		if (platform.setupHint) {
			return 'Setup needed';
		}
		if (status === 'not_configured' && isBrowserOAuth(platform)) {
			return 'Not connected';
		}
		if (status === 'not_configured') {
			return 'Not configured';
		}
		if (status === 'unavailable') {
			return 'Unavailable';
		}
		if (status === 'failed') {
			return 'Failed';
		}
		if (status === 'ready') {
			return 'Ready';
		}
		return 'Not configured';
	}

	function actionButtons(platform) {
		if (platform.custom) {
			return customActions(platform.custom);
		}
		if (platform.discover) {
			return '';
		}
		const id = escapeHtml(platform.id || '');
		// LLM rows: the key lives in Settings > LLM API Keys, so Configure is the only action.
		if (platform.keyProvider) {
			return `<div class="nx-platform-actions"><button type="button" class="nx-btn nx-btn-secondary" data-action="configure" data-id="${id}">Configure</button></div>`;
		}
		if (!platform.live) {
			return '';
		}
		const status = platform.capabilityStatus || 'not_configured';
		if (status === 'unavailable') {
			return '';
		}
		const buttons = [];
		if (status === 'ready') {
			// Anything with a sign-in or a stored credential can be disconnected.
			if (platform.mcpServerId || platform.disconnectable) {
				buttons.push(`<button type="button" class="nx-btn nx-btn-secondary" data-action="disconnect" data-id="${id}">Disconnect</button>`);
			}
			// Configure only where Settings actually has something to show, so the
			// button is never a no-op (Clerk, for example, has nothing to set).
			if (platform.configurable) {
				buttons.push(`<button type="button" class="nx-btn nx-btn-secondary" data-action="configure" data-id="${id}">Configure</button>`);
			}
		} else {
			const label = platform.setupHint ? 'Set up' : 'Connect';
			buttons.push(`<button type="button" class="nx-btn" data-action="connect" data-id="${id}">${label}</button>`);
		}
		return buttons.length ? `<div class="nx-platform-actions">${buttons.join('')}</div>` : '';
	}

	function tooltip(platform) {
		const parts = [platform.name || ''];
		if (platform.description) {
			parts.push(platform.description);
		}
		if (platform.capabilityReason) {
			parts.push(platform.capabilityReason);
		}
		if (platform.capabilities && platform.capabilities.length > 0) {
			parts.push('Capabilities: ' + platform.capabilities.join(', '));
		}
		if (platform.api_type) {
			parts.push('API: ' + platform.api_type);
		}
		return parts.join('\n');
	}

	function renderPlatform(platform) {
		const status = platform.capabilityStatus || '';
		const live = !!platform.live;
		const blocked = live && isBlocked(status);
		const classes = ['nx-platform'];
		if (platform.discover) {
			classes.push('is-discover');
		} else if (!live && !platform.keyProvider) {
			classes.push('is-catalogue');
		}
		if (blocked) {
			classes.push('is-blocked');
		}
		if (status === 'failed') {
			classes.push('is-failed');
		}
		if (isConnected(platform)) {
			classes.push('is-connected');
		}
		const usage = platform.usage;
		const chips = platform.discover ? [] : useInLabels(usage);
		const tools = toolSummary(usage);
		const meta = platform.discover
			? ((usage && usage.reason) || 'No way to use it in Nexora yet')
			: !live
			? (platform.description || 'Discovery only')
			: (blocked && platform.capabilityReason
				? platform.capabilityReason
				: (platform.description || platform.category || ''));
		return `
			<article class="${classes.join(' ')}" data-status="${escapeHtml(status || (live ? 'not_configured' : 'catalogue'))}" data-id="${escapeHtml(platform.id || '')}" data-live="${live ? '1' : '0'}" title="${escapeHtml(tooltip(platform))}">
				<span class="nx-dot" aria-hidden="true"></span>
				<div class="nx-platform-main">
					<div class="nx-name-row">
						<span class="nx-name">${escapeHtml(platform.name || platform.id || '')}</span>
						<span class="nx-status">${escapeHtml(statusLabel(platform))}</span>
					</div>
					<div class="nx-meta">${escapeHtml(meta)}</div>
					${chips.length || tools ? `<div class="nx-useins">${chips.map((c) => `<span class="nx-chip">${escapeHtml(c)}</span>`).join('')}${tools ? `<span class="nx-tools">${escapeHtml(tools)}</span>` : ''}</div>` : ''}
				</div>
				${actionButtons(platform)}
			</article>
		`;
	}

	function matches(platform) {
		if (view.filter === 'connected' && !isConnected(platform)) {
			return false;
		}
		if (view.filter === 'live' && !platform.live) {
			return false;
		}
		const q = view.query.trim().toLowerCase();
		if (!q) {
			return true;
		}
		const text = [platform.name, platform.id, platform.description, platform.category].join(' ').toLowerCase();
		return text.indexOf(q) !== -1;
	}

	function renderTabs(categories) {
		let connected = 0;
		let live = 0;
		let all = 0;
		categories.forEach((group) => (group.platforms || []).forEach((platform) => {
			all++;
			if (platform.live) {
				live++;
			}
			if (isConnected(platform)) {
				connected++;
			}
		}));
		const counts = { all, connected, live };
		document.querySelectorAll('.nx-seg button[data-filter]').forEach((btn) => {
			const filter = btn.getAttribute('data-filter');
			btn.setAttribute('aria-pressed', filter === view.filter ? 'true' : 'false');
			const count = btn.querySelector('.nx-seg-count');
			if (count) {
				count.textContent = String(counts[filter] || 0);
			}
		});
	}

	const EFFECT_LABEL = { read: 'Read', write: 'Write', destructive: 'Destructive' };

	function findRow(id) {
		if (!lastData) {
			return null;
		}
		const server = findServer(id);
		if (server) {
			return serverAsRow(server);
		}
		for (const group of lastData.categories || []) {
			for (const p of group.platforms || []) {
				if (p.id === id) {
					return p;
				}
			}
		}
		const found = (lastData.discover || []).find((p) => p.id === id);
		return found ? Object.assign({}, found, { discover: true }) : null;
	}

	function toolRow(tool) {
		const effect = EFFECT_LABEL[tool.effect] || tool.effect;
		const canTry = tool.string_inputs_only && tool.enabled;
		const tryTitle = !tool.enabled ? 'Switch the tool on to try it' : (tool.string_inputs_only ? 'Run it once, with your approval' : 'Needs structured inputs; use it from chat');
		return `
			<div class="nx-tool${tool.enabled ? '' : ' is-off'}" data-tool="${escapeHtml(tool.name)}">
				<div class="nx-tool-main">
					<div class="nx-name-row">
						<span class="nx-tool-name">${escapeHtml(tool.title || tool.name)}</span>
						<span class="nx-effect nx-effect-${escapeHtml(tool.effect)}">${escapeHtml(effect)}</span>
					</div>
					<div class="nx-meta">${escapeHtml(tool.description || tool.name)}</div>
				</div>
				<button type="button" class="nx-btn nx-btn-secondary nx-try" data-try="${escapeHtml(tool.name)}" title="${escapeHtml(tryTitle)}" ${canTry ? '' : 'disabled'}>Try</button>
				<label class="nx-switch" title="${tool.enabled ? 'On: agents and plans can use it' : 'Off: hidden from agents and plans'}">
					<input type="checkbox" data-switch="${escapeHtml(tool.name)}" ${tool.enabled ? 'checked' : ''} aria-label="${escapeHtml((tool.title || tool.name) + ' on or off')}">
					<span class="nx-switch-slider"></span>
				</label>
			</div>`;
	}

	function renderDetail() {
		const root = document.getElementById('platforms-root');
		const el = document.getElementById('platform-detail');
		if (!root || !el) {
			return;
		}
		if (detail.id === IMPORT_ID && ui.importing) {
			root.classList.add('is-detail');
			el.hidden = false;
			el.innerHTML = importHtml();
			return;
		}
		const row = detail.id ? findRow(detail.id) : null;
		if (!row) {
			root.classList.remove('is-detail');
			el.hidden = true;
			el.innerHTML = '';
			return;
		}
		root.classList.add('is-detail');
		el.hidden = false;
		const data = detail.data;
		let tools;
		if (!data) {
			tools = '<div class="nx-empty">Loading tools...</div>';
		} else if (!data.server) {
			const where = useInLabels(row.usage).join(', ');
			tools = `<div class="nx-empty">${where ? `Nexora uses this platform in: ${escapeHtml(where)}. It has no tool list of its own.` : 'This platform has no tool list.'}</div>`;
		} else if (data.unavailable) {
			tools = '<div class="nx-empty">The tool list needs a newer Nexora engine.</div>';
		} else if (!data.connected) {
			tools = '<div class="nx-empty">Connect to see its tools and choose which ones agents and plans may use.</div>';
		} else if (!data.tools.length) {
			tools = '<div class="nx-empty">No tools found yet. Refresh in a moment.</div>';
		} else {
			const on = data.tools.filter((t) => t.enabled).length;
			tools = `<div class="nx-detail-sub">Tools <span class="nx-count">${on} of ${data.tools.length} on</span></div>
				<div class="nx-list">${data.tools.map(toolRow).join('')}</div>`;
		}
		const chips = row.discover ? [] : useInLabels(row.usage);
		const status = row.discover ? 'discover' : (row.capabilityStatus || '');
		el.innerHTML = `
			<button type="button" class="nx-back" data-back="1"><svg class="nx-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 4 6 8l4 4"/></svg>Platforms</button>
			<div class="nx-detail-head nx-platform${row.capabilityStatus === 'ready' && row.live ? ' is-connected' : ''}${row.capabilityStatus === 'failed' ? ' is-failed' : ''}" data-status="${escapeHtml(status)}">
				<span class="nx-dot" aria-hidden="true"></span>
				<div class="nx-platform-main">
					<div class="nx-name-row"><span class="nx-detail-name">${escapeHtml(row.name || row.id)}</span><span class="nx-status">${escapeHtml(statusLabel(row))}</span></div>
					<div class="nx-meta nx-meta-full">${escapeHtml(row.description || (row.usage && row.usage.reason) || '')}</div>
					${chips.length ? `<div class="nx-useins">${chips.map((c) => `<span class="nx-chip">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
				</div>
			</div>
			${actionButtons(row)}
			${tools}`;
	}

	function openDetail(id) {
		detail.id = id;
		detail.data = null;
		renderDetail();
		vscode.postMessage({ type: 'details', id });
	}

	function closeDetail() {
		ui.importing = null;
		detail.id = '';
		detail.data = null;
		renderDetail();
	}


	// --- Your MCP servers -------------------------------------------------------------------

	const SERVER_STATE = { connected: 'Connected', available: 'Not connected', needs_approval: 'Needs approval', disabled: 'Off', error: 'Error' };
	const SCOPE_LABEL = { user: 'You', project: 'Project', plugin: 'Plugin', bundled: 'Built in' };
	const TRUST_LABEL = { '': 'Use my approval setting', ask: 'Ask before every call', 'trust-read-only': 'Run read-only calls without asking', 'never-ask': 'Never ask' };
	const IMPORT_ID = '__import__';
	/** The Add/Edit form and the Import screen; both live only in this webview. */
	const ui = { form: null, importing: null };

	function myServers() {
		const mine = lastData && lastData.myServers ? lastData.myServers.servers || [] : [];
		return mine.filter((s) => s.scope !== 'bundled');
	}

	function findServer(id) {
		return myServers().find((s) => s.id === id) || null;
	}

	function serverSummary(s) {
		return s.transport === 'http' ? (s.url || '') : [s.command || ''].concat(s.args || []).join(' ');
	}

	function serverToolsText(s) {
		if (!s.tools || !s.tools.total) {
			return '';
		}
		return s.tools.enabled === s.tools.total ? s.tools.total + ' tools' : s.tools.enabled + ' of ' + s.tools.total + ' tools on';
	}

	function serverMatches(s) {
		if (view.filter === 'connected' && s.state !== 'connected') {
			return false;
		}
		const q = view.query.trim().toLowerCase();
		return !q || (s.name + ' ' + serverSummary(s)).toLowerCase().indexOf(q) !== -1;
	}

	function primaryServerAction(s) {
		const kinds = { needs_approval: ['approve', 'Approve'], disabled: ['enable', 'Turn on'], error: ['edit', 'Edit'], available: ['connect', 'Connect'] };
		const pick = kinds[s.state];
		return pick ? '<button type="button" class="nx-btn" data-server-action="' + pick[0] + '">' + pick[1] + '</button>' : '';
	}

	function serverRow(s) {
		const classes = ['nx-platform', 'nx-server'];
		if (s.state === 'connected') {
			classes.push('is-connected');
		} else if (s.state === 'error') {
			classes.push('is-failed');
		} else {
			classes.push('is-blocked');
		}
		const tools = serverToolsText(s);
		const action = primaryServerAction(s);
		return '<article class="' + classes.join(' ') + '" data-server="' + escapeHtml(s.id) + '" title="' + escapeHtml(serverSummary(s)) + '">'
			+ '<span class="nx-dot" aria-hidden="true"></span>'
			+ '<div class="nx-platform-main">'
			+ '<div class="nx-name-row"><span class="nx-name">' + escapeHtml(s.name) + '</span><span class="nx-status">' + escapeHtml(SERVER_STATE[s.state] || s.state) + '</span></div>'
			+ '<div class="nx-meta' + (s.error ? ' nx-meta-error' : '') + '">' + escapeHtml(s.error || s.notice || serverSummary(s)) + '</div>'
			+ '<div class="nx-useins"><span class="nx-chip">' + escapeHtml(SCOPE_LABEL[s.scope] || s.scope) + '</span>'
			+ (tools ? '<span class="nx-tools">' + escapeHtml(tools) + '</span>' : '') + '</div>'
			+ '</div>'
			+ (action ? '<div class="nx-platform-actions">' + action + '</div>' : '')
			+ '</article>';
	}

	function defaultForm() {
		return { name: '', kind: 'url', url: '', command: '', args: '', env: '', headers: '', scope: 'user', trust: '' };
	}

	function formFromServer(s) {
		return {
			name: s.name,
			kind: s.transport === 'http' ? 'url' : 'command',
			url: s.url || '',
			command: s.command || '',
			args: (s.args || []).join('\n'),
			// An empty value keeps the saved one (secrets are never sent to the IDE).
			env: (s.env_keys || []).map((k) => k + '=').join('\n'),
			headers: (s.header_keys || []).map((k) => k + '=').join('\n'),
			scope: s.scope === 'project' ? 'project' : 'user',
			trust: s.trust || ''
		};
	}

	function readForm() {
		if (!ui.form) {
			return;
		}
		const value = (id) => {
			const el = document.getElementById(id);
			return el ? el.value : '';
		};
		const kind = document.querySelector('input[name="f-kind"]:checked');
		ui.form.values = {
			name: value('f-name'),
			kind: kind ? kind.value : ui.form.values.kind,
			url: value('f-url'),
			command: value('f-command'),
			args: value('f-args'),
			env: value('f-env'),
			headers: value('f-headers'),
			scope: value('f-scope') || 'user',
			trust: value('f-trust')
		};
	}

	function option(value, label, current, disabled) {
		return '<option value="' + escapeHtml(value) + '"' + (value === current ? ' selected' : '') + (disabled ? ' disabled' : '') + '>' + escapeHtml(label) + '</option>';
	}

	function formHtml() {
		const f = ui.form.values;
		const editing = !!ui.form.edit;
		const hasFolder = !!(lastData && lastData.myServers && lastData.myServers.workspace);
		const errors = ui.form.errors && ui.form.errors.length
			? '<div class="nx-form-errors" role="alert">' + ui.form.errors.map((e) => '<div>' + escapeHtml(e) + '</div>').join('') + '</div>' : '';
		const field = (id, label, input, hint) => '<label class="nx-field" for="' + id + '"><span>' + label + '</span>' + input + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
		const isUrl = f.kind === 'url';
		return '<div class="nx-form">'
			+ '<div class="nx-form-title">' + (editing ? 'Edit ' + escapeHtml(ui.form.edit.name) : 'Add an MCP server') + '</div>'
			+ errors
			+ field('f-name', 'Name', '<input id="f-name" type="text" value="' + escapeHtml(f.name) + '" spellcheck="false" autocomplete="off">')
			+ '<div class="nx-field"><span>Type</span><div class="nx-radios">'
			+ '<label><input type="radio" name="f-kind" value="url"' + (isUrl ? ' checked' : '') + '> Web address</label>'
			+ '<label><input type="radio" name="f-kind" value="command"' + (isUrl ? '' : ' checked') + '> Command on this PC</label>'
			+ '</div></div>'
			+ (isUrl
				? field('f-url', 'Address', '<input id="f-url" type="text" placeholder="https://example.com/mcp" value="' + escapeHtml(f.url) + '" spellcheck="false">')
					+ field('f-headers', 'Headers', '<textarea id="f-headers" rows="2" placeholder="Authorization=Bearer ..." spellcheck="false">' + escapeHtml(f.headers) + '</textarea>',
						'KEY=VALUE per line. Values that look like keys are saved encrypted.' + (editing ? ' Leave a value empty to keep it.' : ''))
				: field('f-command', 'Command', '<input id="f-command" type="text" placeholder="npx" value="' + escapeHtml(f.command) + '" spellcheck="false">')
					+ field('f-args', 'Arguments', '<textarea id="f-args" rows="2" placeholder="-y&#10;@modelcontextprotocol/server-github" spellcheck="false">' + escapeHtml(f.args) + '</textarea>', 'One per line.')
					+ field('f-env', 'Environment', '<textarea id="f-env" rows="2" placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=..." spellcheck="false">' + escapeHtml(f.env) + '</textarea>',
						'KEY=VALUE per line. Values that look like keys are saved encrypted.' + (editing ? ' Leave a value empty to keep it.' : '')))
			+ (editing ? '' : field('f-scope', 'For', '<select id="f-scope">' + option('user', 'Me, in every project', f.scope) + option('project', hasFolder ? 'This project (.nexora/mcp.json)' : 'This project (open a folder first)', f.scope, !hasFolder) + '</select>'))
			+ field('f-trust', 'Approval', '<select id="f-trust">' + Object.keys(TRUST_LABEL).map((k) => option(k, TRUST_LABEL[k], f.trust)).join('') + '</select>')
			+ '<div class="nx-form-actions">'
			+ '<button type="button" class="nx-btn" data-form="save"' + (ui.form.busy ? ' disabled' : '') + '>' + (ui.form.busy ? 'Saving...' : 'Save') + '</button>'
			+ '<button type="button" class="nx-btn nx-btn-secondary" data-form="cancel">Cancel</button>'
			+ '</div></div>';
	}

	function renderMyServers(data) {
		if (!data.myServers) {
			return '';
		}
		const servers = myServers().filter(serverMatches);
		const configErrors = Object.keys(data.myServers.config_errors || {}).map((k) => data.myServers.config_errors[k]);
		const body = servers.length
			? '<div class="nx-list">' + servers.map(serverRow).join('') + '</div>'
			: (ui.form ? '' : '<div class="nx-empty nx-mine-empty">Add a server by address or command, or import the ones you use in Cursor, Claude Code, VS Code or Claude Desktop.</div>');
		return '<section class="nx-group nx-mine" aria-label="Your MCP servers">'
			+ '<div class="nx-mine-head"><span class="nx-group-name">Your MCP servers</span>'
			+ '<span class="nx-count">' + myServers().length + '</span>'
			+ '<button type="button" class="nx-icon-text" data-mine="add" title="Add an MCP server">+ Add</button>'
			+ '<button type="button" class="nx-icon-text" data-mine="import" title="Import from Cursor, Claude Code, VS Code or Claude Desktop">Import</button></div>'
			+ configErrors.map((e) => '<div class="nx-banner">' + escapeHtml(e) + '</div>').join('')
			+ (ui.form ? formHtml() : '')
			+ body
			+ '</section>';
	}

	function serverAsRow(s) {
		return {
			id: s.id,
			name: s.name,
			custom: s,
			description: s.error || s.notice || serverSummary(s),
			capabilityStatus: s.state === 'connected' ? 'ready' : (s.state === 'error' ? 'failed' : 'not_configured'),
			live: true,
			usage: { usable_in: ['chat', 'agent', 'plans'], state: s.state, reason: '', tools: null, undo: false, listed: true },
			mcpServerId: s.id
		};
	}

	function customActions(s) {
		// A plugin's server is turned off or removed with its plugin, in Customize.
		if (s.scope === 'plugin') {
			return '<div class="nx-platform-actions">' + primaryServerAction(s)
				+ '<button type="button" class="nx-btn nx-btn-secondary" data-server-action="plugins">Manage in Customize</button></div>'
				+ '<div class="nx-meta nx-meta-full">Comes with a plugin - ' + escapeHtml(serverSummary(s)) + '</div>';
		}
		const buttons = [primaryServerAction(s)];
		buttons.push('<button type="button" class="nx-btn nx-btn-secondary" data-server-action="edit">Edit</button>');
		if (s.state !== 'needs_approval') {
			buttons.push('<button type="button" class="nx-btn nx-btn-secondary" data-server-action="' + (s.enabled ? 'disable' : 'enable') + '">' + (s.enabled ? 'Turn off' : 'Turn on') + '</button>');
		}
		buttons.push('<button type="button" class="nx-btn nx-btn-secondary" data-server-action="remove">Remove</button>');
		return '<div class="nx-platform-actions">' + buttons.join('') + '</div>'
			+ '<label class="nx-field nx-trust"><span>Approval for this server</span><select data-trust="1">'
			+ Object.keys(TRUST_LABEL).map((k) => option(k, TRUST_LABEL[k], s.trust || '')).join('') + '</select></label>'
			+ '<div class="nx-meta nx-meta-full">' + escapeHtml(SCOPE_LABEL[s.scope] || s.scope) + ' - ' + escapeHtml(serverSummary(s)) + '</div>';
	}

	function saveWithTrust(s, trust) {
		const values = formFromServer(s);
		values.trust = trust;
		vscode.postMessage({ type: 'saveServer', form: values, edit: { scope: s.scope, name: s.name } });
	}

	function serverAction(action, s) {
		if (!s) {
			return;
		}
		if (action === 'approve') {
			vscode.postMessage({ type: 'approveServer', name: s.name });
		} else if (action === 'enable' || action === 'disable') {
			vscode.postMessage({ type: 'enableServer', scope: s.scope, name: s.name, enabled: action === 'enable' });
		} else if (action === 'connect') {
			vscode.postMessage({ type: 'connectServer', id: s.id });
		} else if (action === 'plugins') {
			vscode.postMessage({ type: 'openCustomize', section: 'plugins' });
		} else if (action === 'remove') {
			vscode.postMessage({ type: 'removeServer', scope: s.scope, name: s.name });
		} else if (action === 'edit') {
			ui.form = { edit: { scope: s.scope, name: s.name }, values: formFromServer(s), errors: [], busy: false };
			if (detail.id) {
				closeDetail();
			}
			rerender();
		}
	}

	function importHtml() {
		const state = ui.importing;
		const back = '<button type="button" class="nx-back" data-back="1"><svg class="nx-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 4 6 8l4 4"/></svg>Platforms</button>';
		const head = '<div class="nx-detail-name">Import MCP servers</div><p class="nx-hint">Copies the servers you choose into Nexora. Keys are moved to Nexora\'s encrypted store; the other tools\' files are not changed.</p>';
		if (!state.sources) {
			return back + head + '<div class="nx-empty">Looking for configs...</div>';
		}
		const groups = state.sources.filter((src) => (src.servers || []).length || src.error);
		if (!groups.length) {
			return back + head + '<div class="nx-empty">No MCP servers found in Cursor, Claude Code, VS Code or Claude Desktop on this PC.</div>';
		}
		const hasFolder = !!state.workspace;
		const list = groups.map((src) => '<div class="nx-import-source"><div class="nx-detail-sub">' + escapeHtml(src.label) + ' <span class="nx-count" title="' + escapeHtml(src.path) + '">' + escapeHtml(src.path) + '</span></div>'
			+ (src.error ? '<div class="nx-banner">' + escapeHtml(src.error) + '</div>' : '')
			+ '<div class="nx-list">' + (src.servers || []).map((sv) => '<label class="nx-import-row' + (sv.exists ? ' is-added' : '') + '">'
				+ '<input type="checkbox" data-import-source="' + escapeHtml(src.id) + '" data-import-name="' + escapeHtml(sv.name) + '"' + (sv.exists ? ' disabled' : '') + '>'
				+ '<span class="nx-import-main"><span class="nx-name-row"><span class="nx-name">' + escapeHtml(sv.name) + '</span><span class="nx-status">' + (sv.exists ? 'Added' : escapeHtml(sv.transport === 'http' ? 'Web address' : 'Command')) + '</span></span>'
				+ '<span class="nx-meta">' + escapeHtml(sv.summary) + '</span>'
				+ (sv.secret_keys && sv.secret_keys.length ? '<span class="nx-meta">Keys saved encrypted: ' + escapeHtml(sv.secret_keys.join(', ')) + '</span>' : '')
				+ '</span></label>').join('') + '</div></div>').join('');
		return back + head + list
			+ '<label class="nx-field"><span>Add them for</span><select id="import-scope">' + option('user', 'Me, in every project', 'user') + option('project', hasFolder ? 'This project (.nexora/mcp.json)' : 'This project (open a folder first)', '', !hasFolder) + '</select></label>'
			+ '<div class="nx-form-actions"><button type="button" class="nx-btn" data-import-apply="1"' + (state.busy ? ' disabled' : '') + '>' + (state.busy ? 'Importing...' : 'Import selected') + '</button></div>';
	}

	function openImport() {
		ui.importing = { sources: null, workspace: null, busy: false };
		detail.id = IMPORT_ID;
		detail.data = null;
		renderDetail();
		vscode.postMessage({ type: 'importPreview' });
	}

	function render(data) {
		lastData = data;
		const loading = document.getElementById('loading');
		const list = document.getElementById('platform-list');
		const banner = document.getElementById('offline-banner');
		const embedding = document.getElementById('embedding-banner');

		if (banner) {
			if (data.error) {
				banner.textContent = data.error;
				banner.hidden = false;
			} else {
				banner.textContent = '';
				banner.hidden = true;
			}
		}

		if (embedding) {
			if (data.embeddingInProgress) {
				embedding.textContent = 'Preparing semantic search. Platforms are being indexed in the background.';
				embedding.hidden = false;
			} else {
				embedding.textContent = '';
				embedding.hidden = true;
			}
		}

		if (loading) {
			loading.hidden = !data.isLoading;
		}

		if (!list) {
			return;
		}

		if (data.isLoading && (!data.categories || data.categories.length === 0)) {
			list.innerHTML = '';
			announce('Loading platforms');
			return;
		}

		if (data.embeddingInProgress && (!data.categories || data.categories.length === 0) && !data.isLoading) {
			list.innerHTML = '';
			announce('Preparing semantic search');
			return;
		}

		const categories = data.categories || [];
		renderTabs(categories);
		if (!categories.length) {
			list.innerHTML = '<div class="nx-empty">No platforms loaded.</div>';
			announce(data.error || 'No platforms loaded');
			return;
		}

		let shown = 0;
		const groups = categories.map((group) => {
			const platforms = (group.platforms || []).filter(matches);
			if (!platforms.length) {
				return '';
			}
			shown += platforms.length;
			// While filtering, every group with a match stays open so nothing is hidden behind a fold.
			const open = view.query.trim() !== '' || view.collapsed.indexOf(group.category) === -1;
			const ready = platforms.filter(isConnected).length;
			return `
				<section class="nx-group${open ? '' : ' is-collapsed'}" aria-label="${escapeHtml(group.category)}">
					<button type="button" class="nx-group-head" data-group="${escapeHtml(group.category)}" aria-expanded="${open ? 'true' : 'false'}">
						<svg class="nx-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>
						<span class="nx-group-name">${escapeHtml(group.category)}</span>
						<span class="nx-count">${ready ? `${ready} of ${platforms.length} ready` : platforms.length}</span>
					</button>
					<div class="nx-list">
						${platforms.map(renderPlatform).join('')}
					</div>
				</section>
			`;
		}).join('');

		const discover = view.filter === 'all'
			? (data.discover || []).map((p) => Object.assign({}, p, { discover: true })).filter(matches)
			: [];
		const open = view.discoverOpen || view.query.trim() !== '';
		const discoverGroup = discover.length ? `
			<section class="nx-group nx-discover${open ? '' : ' is-collapsed'}" aria-label="Discover">
				<button type="button" class="nx-group-head" data-discover="1" aria-expanded="${open ? 'true' : 'false'}">
					<svg class="nx-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>
					<span class="nx-group-name">Discover</span>
					<span class="nx-count">${discover.length}, not usable in Nexora yet</span>
				</button>
				<div class="nx-list">${discover.map(renderPlatform).join('')}</div>
			</section>` : '';
		const mine = renderMyServers(data);
		list.innerHTML = mine + (shown
			? groups + discoverGroup
			: (discoverGroup || `<div class="nx-empty">${view.filter === 'connected' ? 'Nothing connected yet. Connect a platform from the All tab.' : 'No platforms match.'}</div>`));

		const count = categories.reduce((sum, group) => sum + ((group.platforms || []).length), 0);
		announce(data.error ? data.error : (shown === count ? count + ' platforms' : shown + ' of ' + count + ' platforms'));
		if (detail.id && detail.id !== IMPORT_ID) {
			// A sign-in or a key may have changed the row: show it, and ask for its tools again.
			renderDetail();
			vscode.postMessage({ type: 'details', id: detail.id });
		}
	}

	function rerender() {
		if (lastData) {
			render(lastData);
		}
	}

	document.getElementById('refreshBtn')?.addEventListener('click', () => {
		vscode.postMessage({ type: 'refresh' });
	});

	const search = document.getElementById('platform-search');
	search?.addEventListener('input', () => {
		view.query = search.value;
		rerender();
	});
	search?.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			search.value = '';
			view.query = '';
			rerender();
		}
	});

	document.querySelectorAll('.nx-seg button[data-filter]').forEach((btn) => {
		btn.addEventListener('click', () => {
			view.filter = btn.getAttribute('data-filter') || 'all';
			saveView();
			rerender();
		});
	});

	document.getElementById('platform-list')?.addEventListener('click', (event) => {
		const target = event.target;
		if (!target || typeof target.closest !== 'function') {
			return;
		}
		if (target.closest('button[data-discover]')) {
			view.discoverOpen = !view.discoverOpen;
			saveView();
			rerender();
			return;
		}
		const mineBtn = target.closest('button[data-mine]');
		if (mineBtn) {
			if (mineBtn.getAttribute('data-mine') === 'add') {
				ui.form = { edit: null, values: defaultForm(), errors: [], busy: false };
				rerender();
				const name = document.getElementById('f-name');
				if (name) {
					name.focus();
				}
			} else {
				openImport();
			}
			return;
		}
		const formBtn = target.closest('button[data-form]');
		if (formBtn && ui.form) {
			if (formBtn.getAttribute('data-form') === 'save') {
				readForm();
				ui.form.busy = true;
				ui.form.errors = [];
				rerender();
				vscode.postMessage({ type: 'saveServer', form: ui.form.values, edit: ui.form.edit });
			} else {
				ui.form = null;
				rerender();
			}
			return;
		}
		if (target.closest('.nx-form')) {
			return;
		}
		const serverBtn = target.closest('button[data-server-action]');
		if (serverBtn) {
			const owner = serverBtn.closest('[data-server]');
			serverAction(serverBtn.getAttribute('data-server-action'), findServer(owner ? owner.getAttribute('data-server') : ''));
			return;
		}
		const serverRowEl = target.closest('.nx-platform[data-server]');
		if (serverRowEl) {
			openDetail(serverRowEl.getAttribute('data-server'));
			return;
		}
		const head = target.closest('button[data-group]');
		if (head) {
			const name = head.getAttribute('data-group') || '';
			const at = view.collapsed.indexOf(name);
			if (at === -1) {
				view.collapsed.push(name);
			} else {
				view.collapsed.splice(at, 1);
			}
			saveView();
			rerender();
			return;
		}
		const btn = target.closest('button[data-action]');
		if (!btn) {
			const article = target.closest('.nx-platform');
			if (article && article.getAttribute('data-id')) {
				openDetail(article.getAttribute('data-id'));
			}
			return;
		}
		const action = btn.getAttribute('data-action');
		const id = btn.getAttribute('data-id');
		if (action && id) {
			vscode.postMessage({ type: action, id });
		}
	});

	document.getElementById('platform-detail')?.addEventListener('click', (event) => {
		const target = event.target;
		if (!target || typeof target.closest !== 'function') {
			return;
		}
		if (target.closest('button[data-back]')) {
			closeDetail();
			return;
		}
		if (target.closest('button[data-import-apply]') && ui.importing) {
			const scope = (document.getElementById('import-scope') || {}).value || 'user';
			const items = Array.prototype.slice.call(document.querySelectorAll('input[data-import-source]:checked')).map((box) => ({
				source: box.getAttribute('data-import-source'), name: box.getAttribute('data-import-name'), scope
			}));
			if (items.length) {
				ui.importing.busy = true;
				renderDetail();
				vscode.postMessage({ type: 'importApply', items });
			}
			return;
		}
		const serverBtn = target.closest('button[data-server-action]');
		if (serverBtn) {
			serverAction(serverBtn.getAttribute('data-server-action'), findServer(detail.id));
			return;
		}
		const tryBtn = target.closest('button[data-try]');
		if (tryBtn && !tryBtn.disabled) {
			vscode.postMessage({ type: 'tryTool', id: detail.id, tool: tryBtn.getAttribute('data-try') });
			return;
		}
		const btn = target.closest('button[data-action]');
		if (btn) {
			vscode.postMessage({ type: btn.getAttribute('data-action'), id: btn.getAttribute('data-id') });
		}
	});

	document.getElementById('platform-detail')?.addEventListener('change', (event) => {
		const input = event.target;
		if (input && input.getAttribute && input.getAttribute('data-trust')) {
			const s = findServer(detail.id);
			if (s) {
				saveWithTrust(s, input.value);
			}
			return;
		}
		if (input && input.getAttribute && input.getAttribute('data-switch')) {
			vscode.postMessage({ type: 'setToolEnabled', id: detail.id, tool: input.getAttribute('data-switch'), enabled: !!input.checked });
		}
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && detail.id && event.target !== search) {
			closeDetail();
		}
	});

	document.getElementById('platform-list')?.addEventListener('change', (event) => {
		const input = event.target;
		if (input && input.name === 'f-kind' && ui.form) {
			readForm();
			rerender();
		}
	});

	window.addEventListener('message', (event) => {
		const msg = event.data || {};
		if (msg.type === 'serverFormResult' && ui.form) {
			if (msg.errors && msg.errors.length) {
				ui.form.errors = msg.errors;
				ui.form.busy = false;
			} else {
				ui.form = null;
			}
			rerender();
			return;
		}
		if (msg.type === 'importSources' && ui.importing) {
			ui.importing.sources = msg.sources || [];
			ui.importing.workspace = msg.workspace || null;
			renderDetail();
			return;
		}
		if (msg.type === 'importDone') {
			closeDetail();
			return;
		}
		if (msg.type === 'serverRemoved' && detail.id && !findServer(detail.id)) {
			closeDetail();
			return;
		}
		if (msg.type === 'updateData') {
			render(msg.data || {});
		} else if (msg.type === 'platformDetail' && msg.detail && msg.detail.id === detail.id) {
			detail.data = msg.detail;
			renderDetail();
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
