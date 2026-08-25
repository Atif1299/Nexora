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

	function money(value) {
		const n = Number(value || 0);
		return '$' + n.toFixed(4);
	}

	function announce(msg) {
		const el = document.getElementById('sr-live');
		if (el) {
			el.textContent = msg;
		}
	}

	function renderSummary(summary) {
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
			<div class="nx-card">
				<div class="nx-cardLabel">${escapeHtml(card.label)}</div>
				<div class="nx-cardValue">${escapeHtml(card.value)}</div>
				${card.trend ? `<div class="nx-cardTrend">${escapeHtml(card.trend)} vs last week</div>` : ''}
			</div>
		`).join('');
	}

	function renderDaily(daily) {
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
				<div class="nx-dayRow">
					<span class="nx-muted">${escapeHtml(label)}</span>
					<div class="nx-barTrack"><div class="nx-barFill" style="width:${width}%"></div></div>
					<span>${money(cost)}</span>
				</div>
			`;
		}).join('');
	}

	function renderPlatforms(items) {
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
			<div class="nx-barRow">
				<span>${escapeHtml(row.platform)}</span>
				<div class="nx-barTrack"><div class="nx-barFill" style="width:${Math.max(Number(row.percentage || 0), 0)}%"></div></div>
				<span>${money(row.cost)}</span>
			</div>
		`).join('');
	}

	function renderStats(stats) {
		const root = document.getElementById('execution-stats');
		if (!root) {
			return;
		}
		root.innerHTML = `
			<div class="nx-statGrid">
				<div>Executions<br><strong>${escapeHtml(String(stats.total_executions || 0))}</strong></div>
				<div>Success rate<br><strong>${escapeHtml(String(stats.success_rate || 0))}%</strong></div>
				<div>Avg latency<br><strong>${escapeHtml(String(stats.avg_latency_ms || 0))} ms</strong></div>
				<div>Tokens<br><strong>${escapeHtml(String(stats.tokens_input || 0))} / ${escapeHtml(String(stats.tokens_output || 0))}</strong></div>
			</div>
		`;
	}

	function renderMemory(memory) {
		const root = document.getElementById('memory-insights');
		if (!root) {
			return;
		}
		const files = (memory.top_files || []).map(item => `
			<div class="nx-fileRow">
				<span>${escapeHtml(item.file_path)}</span>
				<span class="nx-muted">${escapeHtml(String(item.count))} hits</span>
			</div>
		`).join('') || '<div class="nx-empty">No retrievals this week.</div>';

		root.innerHTML = `
			<div class="nx-statGrid">
				<div>Workspaces<br><strong>${escapeHtml(String(memory.workspaces_indexed || 0))}</strong></div>
				<div>Indexed files<br><strong>${escapeHtml(String(memory.total_files || 0))}</strong></div>
				<div>Retrievals (7d)<br><strong>${escapeHtml(String(memory.retrievals_this_week || 0))}</strong></div>
				<div>Hit rate<br><strong>${escapeHtml(String(memory.pct_requests_using_memory || 0))}%</strong></div>
			</div>
			<p class="nx-hint" style="margin-top:10px">Hit rate is the share of memory queries that returned context, not all chat requests.</p>
			<div style="margin-top:8px">${files}</div>
		`;
	}

	function render(data) {
		if (!data) {
			return;
		}
		renderSummary(data.summary || {});
		renderDaily(data.daily || []);
		renderPlatforms(data.byPlatform || []);
		renderStats(data.stats || {});
		renderMemory(data.memory || {});
		announce('Analytics updated');
	}

	window.addEventListener('message', (event) => {
		const msg = event.data || {};
		if (msg.type === 'updateData') {
			render(msg.data);
		}
	});

	document.getElementById('refresh')?.addEventListener('click', () => {
		vscode.postMessage({ type: 'refresh' });
	});

	vscode.postMessage({ type: 'ready' });
})();
