/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {
	const vscode = acquireVsCodeApi();

	let pendingImport = false;

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

	function paramFields(template) {
		const params = template.parameters || [];
		if (!params.length) {
			return '';
		}
		return params.map((param, index) => {
			const id = `p-${template.id}-${index}`;
			const required = param.required ? ' required' : '';
			const value = param.default === null || param.default === undefined ? '' : String(param.default);
			if (param.choices && param.choices.length) {
				const options = param.choices.map(choice => {
					const selected = String(choice) === value ? ' selected' : '';
					return `<option value="${escapeHtml(choice)}"${selected}>${escapeHtml(choice)}</option>`;
				}).join('');
				return `
					<div class="nx-field">
						<label for="${id}">${escapeHtml(param.name)}${param.required ? ' *' : ''}</label>
						<select id="${id}" name="${escapeHtml(param.name)}"${required}>${options}</select>
					</div>
				`;
			}
			return `
				<div class="nx-field">
					<label for="${id}">${escapeHtml(param.name)}${param.required ? ' *' : ''}</label>
					<input id="${id}" name="${escapeHtml(param.name)}" type="text" value="${escapeHtml(value)}"${required} />
				</div>
			`;
		}).join('');
	}

	function renderCard(template) {
		const tasks = (template.tasks || []).length;
		const source = template.source || 'user';
		return `
			<article class="nx-card" data-id="${escapeHtml(template.id)}">
				<div class="nx-cardHead">
					<div class="nx-cardTitle">${escapeHtml(template.name)}</div>
					<span class="nx-badge">${escapeHtml(source)}</span>
				</div>
				<div class="nx-cardMeta">${escapeHtml(template.description || '')}</div>
				<div class="nx-cardMeta">${escapeHtml(template.category || 'general')} · ${tasks} task${tasks === 1 ? '' : 's'}</div>
				<div class="nx-cardActions">
					<button type="button" class="nx-btn nx-btn-primary" data-action="instantiate" data-id="${escapeHtml(template.id)}">Instantiate</button>
					<button type="button" class="nx-btn nx-btn-secondary" data-action="export" data-id="${escapeHtml(template.id)}">Export</button>
				</div>
				<form class="nx-form" data-form="${escapeHtml(template.id)}" hidden>
					${paramFields(template)}
					<div class="nx-formActions">
						<button type="submit" class="nx-btn nx-btn-primary">Run</button>
						<button type="button" class="nx-btn nx-btn-secondary" data-action="cancel-form">Cancel</button>
					</div>
				</form>
			</article>
		`;
	}

	function renderList(id, templates) {
		const root = document.getElementById(id);
		if (!root) {
			return;
		}
		if (!templates.length) {
			root.innerHTML = '<div class="nx-empty">None yet.</div>';
			return;
		}
		root.innerHTML = templates.map(renderCard).join('');
	}

	function collectParams(form) {
		const params = {};
		form.querySelectorAll('input[name], select[name]').forEach(el => {
			params[el.name] = el.value;
		});
		return params;
	}

	function render(data) {
		const banner = document.getElementById('offline-banner');
		if (banner) {
			if (data.available === false) {
				banner.textContent = 'Backend unreachable - templates below are not current. '
					+ (data.error ? `(${data.error})` : '');
				banner.hidden = false;
			} else {
				banner.textContent = '';
				banner.hidden = true;
			}
		}

		const templates = data.templates || [];
		const builtins = templates.filter(t => t.source === 'builtin');
		const users = templates.filter(t => t.source !== 'builtin');
		renderList('builtin-list', builtins);
		renderList('user-list', users);
		announce(data.available === false ? 'Backend unreachable' : `${templates.length} templates`);
	}

	function renderPreview(preview) {
		const root = document.getElementById('import-preview');
		if (!root) {
			return;
		}
		pendingImport = true;
		root.hidden = false;
		const errors = (preview.errors || []).map(e => `<div class="nx-muted">${escapeHtml(e)}</div>`).join('');
		root.innerHTML = `
			<div class="nx-previewTitle">Import preview</div>
			<div>${escapeHtml(preview.name || 'Untitled')} · ${escapeHtml(String(preview.task_count || 0))} tasks</div>
			<div class="nx-muted">${escapeHtml(preview.description || '')}</div>
			<div>Platforms: ${escapeHtml((preview.platforms || []).join(', ') || 'none')}</div>
			<div>Missing platforms: ${escapeHtml((preview.platforms_missing || []).join(', ') || 'none')}</div>
			<div>Env keys: ${escapeHtml((preview.env_keys || []).join(', ') || 'none')}</div>
			<div>Checksum: ${preview.checksum_valid ? 'valid' : 'invalid'} · ${preview.valid ? 'ready' : 'blocked'}</div>
			${errors}
			<div class="nx-formActions">
				<button type="button" class="nx-btn nx-btn-primary" id="confirmImport" ${preview.valid ? '' : 'disabled'}>Confirm import</button>
				<button type="button" class="nx-btn nx-btn-secondary" id="cancelImport">Cancel</button>
			</div>
		`;
	}

	function hidePreview() {
		pendingImport = false;
		const root = document.getElementById('import-preview');
		if (root) {
			root.hidden = true;
			root.innerHTML = '';
		}
	}

	document.getElementById('refreshBtn')?.addEventListener('click', () => {
		vscode.postMessage({ type: 'refresh' });
	});

	document.getElementById('importBtn')?.addEventListener('click', () => {
		vscode.postMessage({ type: 'import' });
	});

	document.getElementById('templates-root')?.addEventListener('click', (event) => {
		const target = event.target;
		if (!target || !target.getAttribute) {
			return;
		}
		if (target.id === 'confirmImport' && pendingImport) {
			vscode.postMessage({ type: 'confirmImport' });
			return;
		}
		if (target.id === 'cancelImport') {
			hidePreview();
			vscode.postMessage({ type: 'cancelImport' });
			return;
		}
		const action = target.getAttribute('data-action');
		const id = target.getAttribute('data-id');
		if (action === 'export' && id) {
			vscode.postMessage({ type: 'export', id });
			return;
		}
		if (action === 'instantiate' && id) {
			const card = target.closest('.nx-card');
			const form = card && card.querySelector('.nx-form');
			if (form && form.querySelector('input, select')) {
				form.hidden = false;
				return;
			}
			vscode.postMessage({ type: 'instantiate', id, params: {} });
			return;
		}
		if (action === 'cancel-form') {
			const form = target.closest('.nx-form');
			if (form) {
				form.hidden = true;
			}
		}
	});

	document.getElementById('templates-root')?.addEventListener('submit', (event) => {
		const form = event.target;
		if (!form || !form.getAttribute || !form.getAttribute('data-form')) {
			return;
		}
		event.preventDefault();
		const id = form.getAttribute('data-form');
		vscode.postMessage({ type: 'instantiate', id, params: collectParams(form) });
		form.hidden = true;
	});

	window.addEventListener('message', (event) => {
		const msg = event.data || {};
		if (msg.type === 'updateData') {
			hidePreview();
			render(msg.data || {});
		}
		if (msg.type === 'importPreview') {
			renderPreview(msg.preview || {});
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
