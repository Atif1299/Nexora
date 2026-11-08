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
		collapsed: Array.isArray(saved.collapsed) ? saved.collapsed : []
	};
	let lastData = null;

	function saveView() {
		vscode.setState({ filter: view.filter, collapsed: view.collapsed });
	}

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text === null || text === undefined ? '' : String(text);
		return div.innerHTML;
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

	function statusLabel(platform) {
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
		if (!live) {
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
		const meta = !live
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

		list.innerHTML = shown
			? groups
			: `<div class="nx-empty">${view.filter === 'connected' ? 'Nothing connected yet. Connect a platform from the All tab.' : 'No platforms match.'}</div>`;

		const count = categories.reduce((sum, group) => sum + ((group.platforms || []).length), 0);
		announce(data.error ? data.error : (shown === count ? count + ' platforms' : shown + ' of ' + count + ' platforms'));
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
			return;
		}
		const action = btn.getAttribute('data-action');
		const id = btn.getAttribute('data-id');
		if (action && id) {
			vscode.postMessage({ type: action, id });
		}
	});

	window.addEventListener('message', (event) => {
		const msg = event.data || {};
		if (msg.type === 'updateData') {
			render(msg.data || {});
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
