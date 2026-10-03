/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {
	const vscode = acquireVsCodeApi();

	let selectedId = '';

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

	function formatWhen(value) {
		if (!value) {
			return '';
		}
		const text = String(value);
		return text.length >= 16 ? text.slice(0, 16).replace('T', ' ') : text;
	}

	function fileList(title, files, cls) {
		const items = files || [];
		if (!items.length) {
			return `<div class="nx-muted">${escapeHtml(title)}: none</div>`;
		}
		return `
			<div class="${cls || ''}">${escapeHtml(title)} (${items.length})</div>
			<ul class="nx-fileList">
				${items.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
			</ul>
		`;
	}

	function renderRail(snapshots) {
		const root = document.getElementById('timeline-rail');
		if (!root) {
			return;
		}
		if (!snapshots.length) {
			root.innerHTML = '<div class="nx-empty">No snapshots for this workspace.</div>';
			return;
		}
		root.innerHTML = snapshots.map(entry => `
			<button type="button" class="nx-node" data-id="${escapeHtml(entry.id)}" data-selected="${entry.id === selectedId ? 'true' : 'false'}">
				<div class="nx-nodeTitle">
					${escapeHtml(entry.summary || entry.id)}
					${entry.is_newest ? '<span class="nx-newest">now</span>' : ''}
				</div>
				<div class="nx-nodeMeta">${escapeHtml(formatWhen(entry.created_at))} · ${escapeHtml(String(entry.file_count || 0))} files</div>
			</button>
		`).join('');
	}

	function renderDetail(detail) {
		const root = document.getElementById('timeline-detail');
		if (!root) {
			return;
		}
		if (!detail) {
			root.innerHTML = '<div class="nx-empty">Select a snapshot.</div>';
			return;
		}
		const events = (detail.events || []).map(ev => `
			<div class="nx-muted">${escapeHtml(formatWhen(ev.at))} · ${escapeHtml(ev.summary || ev.type)}</div>
		`).join('') || '<div class="nx-muted">No correlated events.</div>';
		const files = detail.files || [];
		const diff = detail.diff;
		let diffHtml = '';
		if (diff) {
			diffHtml = `
				<div class="nx-diffBlock">
					<div><strong>Diff vs now</strong></div>
					<div class="nx-muted">${escapeHtml(diff.from_id)} → ${escapeHtml(diff.to_id)} · modified: ${escapeHtml(diff.modified_status || 'undetermined')}</div>
					${fileList('Added', diff.added, 'nx-added')}
					${fileList('Removed', diff.removed, 'nx-removed')}
					${fileList('Modified', diff.modified, '')}
				</div>
			`;
		} else if (detail.is_newest) {
			diffHtml = '<div class="nx-diffBlock nx-muted">This is the current snapshot.</div>';
		}
		root.innerHTML = `
			<h3>${escapeHtml(detail.summary || detail.id)}</h3>
			<div class="nx-muted">${escapeHtml(formatWhen(detail.created_at))} · ${escapeHtml(String(detail.file_count || 0))} files</div>
			<div style="margin-top:8px">${events}</div>
			${fileList('Files', files, '')}
			${diffHtml}
		`;
	}

	function render(data) {
		const banner = document.getElementById('offline-banner');
		if (banner) {
			if (data.available === false) {
				banner.textContent = 'Backend unreachable - timeline is not current. '
					+ (data.error ? `(${data.error})` : '');
				banner.hidden = false;
			} else {
				banner.textContent = '';
				banner.hidden = true;
			}
		}
		if (!data.workspaceId) {
			const rail = document.getElementById('timeline-rail');
			const detail = document.getElementById('timeline-detail');
			if (rail) {
				rail.innerHTML = '<div class="nx-empty">Index this workspace to see snapshots.</div>';
			}
			if (detail) {
				detail.innerHTML = '<div class="nx-empty">No workspace id.</div>';
			}
			announce('Workspace not indexed');
			return;
		}
		renderRail(data.snapshots || []);
		if (!selectedId) {
			renderDetail(null);
		}
		announce(`${(data.snapshots || []).length} snapshots`);
	}

	document.getElementById('refreshBtn')?.addEventListener('click', () => {
		vscode.postMessage({ type: 'refresh' });
	});

	document.getElementById('timeline-rail')?.addEventListener('click', (event) => {
		const node = event.target && event.target.closest ? event.target.closest('.nx-node') : null;
		if (!node) {
			return;
		}
		const id = node.getAttribute('data-id');
		if (!id) {
			return;
		}
		selectedId = id;
		document.querySelectorAll('.nx-node').forEach(el => {
			el.setAttribute('data-selected', el.getAttribute('data-id') === id ? 'true' : 'false');
		});
		vscode.postMessage({ type: 'selectSnapshot', id });
	});

	window.addEventListener('message', (event) => {
		const msg = event.data || {};
		if (msg.type === 'updateData') {
			selectedId = '';
			render(msg.data || {});
		}
		if (msg.type === 'updateDetail') {
			selectedId = msg.detail && msg.detail.id ? msg.detail.id : selectedId;
			document.querySelectorAll('.nx-node').forEach(el => {
				el.setAttribute('data-selected', el.getAttribute('data-id') === selectedId ? 'true' : 'false');
			});
			renderDetail(msg.detail);
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
