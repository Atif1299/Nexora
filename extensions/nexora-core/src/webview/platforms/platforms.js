/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {
	const vscode = acquireVsCodeApi();

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

	function statusLabel(platform) {
		if (!platform.live) {
			return 'Catalogue';
		}
		const status = platform.capabilityStatus;
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
		if (!platform.live) {
			return '';
		}
		const status = platform.capabilityStatus || 'not_configured';
		const id = escapeHtml(platform.id || '');
		if (status === 'unavailable') {
			return '';
		}
		const buttons = [];
		if (status === 'ready') {
			if (platform.id === 'github' || platform.id === 'vercel' || platform.id === 'supabase' || platform.id === 'stripe' || platform.id === 'v0-dev' || platform.id === 'elevenlabs' || platform.id === 'tavily') {
				buttons.push(`<button type="button" class="nx-btn nx-btn-secondary" data-action="disconnect" data-id="${id}">Disconnect</button>`);
			}
			buttons.push(`<button type="button" class="nx-btn nx-btn-secondary" data-action="configure" data-id="${id}">Configure</button>`);
		} else {
			buttons.push(`<button type="button" class="nx-btn" data-action="connect" data-id="${id}">Connect</button>`);
		}
		return `<div class="nx-platform-actions">${buttons.join('')}</div>`;
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
		if (live && status === 'ready') {
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
				<div>
					<div class="nx-name">${escapeHtml(platform.name || platform.id || '')}</div>
					<div class="nx-meta">${escapeHtml(meta)}</div>
				</div>
				<div class="nx-aside">
					<span class="nx-status">${escapeHtml(statusLabel(platform))}</span>
					${actionButtons(platform)}
				</div>
			</article>
		`;
	}

	function render(data) {
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
				embedding.textContent = 'Preparing semantic search… Embedding platforms in the background.';
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
		if (!categories.length) {
			list.innerHTML = '<div class="nx-empty">No platforms loaded.</div>';
			announce(data.error || 'No platforms loaded');
			return;
		}

		list.innerHTML = categories.map((group) => {
			const platforms = group.platforms || [];
			return `
				<section class="nx-group" aria-label="${escapeHtml(group.category)}">
					<h2>${escapeHtml(group.category)} <span class="nx-count">(${platforms.length})</span></h2>
					<div class="nx-list">
						${platforms.map(renderPlatform).join('')}
					</div>
				</section>
			`;
		}).join('');

		const count = categories.reduce((sum, group) => sum + ((group.platforms || []).length), 0);
		announce(data.error ? data.error : count + ' platforms');
	}

	document.getElementById('refreshBtn')?.addEventListener('click', () => {
		vscode.postMessage({ type: 'refresh' });
	});

	document.getElementById('platform-list')?.addEventListener('click', (event) => {
		const target = event.target;
		if (!target || typeof target.closest !== 'function') {
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
