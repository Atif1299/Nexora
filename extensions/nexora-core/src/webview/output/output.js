/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* global acquireVsCodeApi */
(function () {
	const vscode = acquireVsCodeApi();

	let tasks = [];
	let selectedTaskId = null;

	const STATUS_ICONS = {
		pending: '...',
		running: '[R]',
		success: 'OK',
		failed: 'X',
		skipped: '>>'
	};

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text || '';
		return div.innerHTML;
	}

	function formatTime(isoString) {
		if (!isoString) {
			return '-';
		}
		try {
			const date = new Date(isoString);
			return date.toLocaleTimeString();
		} catch (e) {
			return isoString;
		}
	}

	function renderTaskList(taskList) {
		tasks = taskList || [];
		const container = document.getElementById('task-list');

		if (!tasks || tasks.length === 0) {
			container.innerHTML = '<div class="out-empty">No tasks executed yet</div>';
			return;
		}

		container.innerHTML = tasks.map(function (task) {
			const isSelected = selectedTaskId === task.taskId;
			const statusIcon = STATUS_ICONS[task.status] || '?';
			const statusClass = task.status || 'pending';

			return `
				<div class="out-taskItem ${isSelected ? 'out-taskSelected' : ''} out-task-${statusClass}"
					 data-task-id="${task.taskId}"
					 role="button"
					 tabindex="0"
					 aria-label="Task ${escapeHtml(task.taskName || task.taskId)}, status ${escapeHtml(statusClass)}">
					<span class="out-taskIcon" aria-hidden="true">${statusIcon}</span>
					<div class="out-taskInfo">
						<span class="out-taskName">${escapeHtml(task.taskName || task.taskId)}</span>
						<span class="out-taskPlatform">${escapeHtml(task.platform || 'unknown')}</span>
					</div>
					${task.duration ? '<span class="out-taskDuration">' + task.duration + 'ms</span>' : ''}
				</div>
			`;
		}).join('');

		container.querySelectorAll('.out-taskItem').forEach(function (item) {
			function select() {
				const taskId = item.getAttribute('data-task-id');
				vscode.postMessage({ type: 'selectTask', taskId: taskId });
			}
			item.addEventListener('click', select);
			item.addEventListener('keydown', function (e) {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					select();
				}
			});
		});
	}

	function renderTaskOutput(output) {
		selectedTaskId = output ? output.taskId : null;
		const container = document.getElementById('output-detail');

		if (!output) {
			container.innerHTML = '<div class="out-empty">Select a task to view output</div>';
			renderTaskList(tasks);
			return;
		}

		const resultJson = output.result ? JSON.stringify(output.result, null, 2) : null;
		const statusClass = output.status || 'pending';
		const statusIcon = STATUS_ICONS[output.status] || '?';

		container.innerHTML = `
			<div class="out-header">
				<div class="out-headerLeft">
					<span class="out-headerIcon">${statusIcon}</span>
					<h3 class="out-headerTitle">${escapeHtml(output.taskName || output.taskId)}</h3>
				</div>
				<span class="out-headerStatus out-status-${statusClass}">${output.status || 'unknown'}</span>
			</div>
			
			<div class="out-meta">
				<div class="out-metaRow">
					<span class="out-metaLabel">Platform:</span>
					<span class="out-metaValue">${escapeHtml(output.platform || 'N/A')}</span>
				</div>
				<div class="out-metaRow">
					<span class="out-metaLabel">Operation:</span>
					<span class="out-metaValue">${escapeHtml(output.operation || 'N/A')}</span>
				</div>
				${output.startedAt ? `
				<div class="out-metaRow">
					<span class="out-metaLabel">Started:</span>
					<span class="out-metaValue">${formatTime(output.startedAt)}</span>
				</div>
				` : ''}
				${output.completedAt ? `
				<div class="out-metaRow">
					<span class="out-metaLabel">Completed:</span>
					<span class="out-metaValue">${formatTime(output.completedAt)}</span>
				</div>
				` : ''}
				${output.duration ? `
				<div class="out-metaRow">
					<span class="out-metaLabel">Duration:</span>
					<span class="out-metaValue">${output.duration}ms</span>
				</div>
				` : ''}
			</div>
			
			${output.error ? `
			<div class="out-section out-sectionError">
				<h4 class="out-sectionTitle">Error</h4>
				<pre class="out-errorText">${escapeHtml(output.error)}</pre>
			</div>
			` : ''}
			
			${resultJson ? `
			<div class="out-section out-sectionResult">
				<div class="out-sectionHeader">
					<h4 class="out-sectionTitle">Result</h4>
					<button class="out-copyBtn" id="copyResultBtn">Copy</button>
				</div>
				<pre class="out-resultJson">${escapeHtml(resultJson)}</pre>
			</div>
			` : ''}
			
			<div class="out-section out-sectionLogs">
				<h4 class="out-sectionTitle">Logs (${(output.logs || []).length})</h4>
				<div class="out-logsContainer" id="logs-container">
					${renderLogs(output.logs)}
				</div>
			</div>
		`;

		const copyBtn = document.getElementById('copyResultBtn');
		if (copyBtn) {
			copyBtn.addEventListener('click', function () {
				vscode.postMessage({ type: 'copyOutput', content: resultJson });
			});
		}

		renderTaskList(tasks);
	}

	function renderLogs(logs) {
		if (!logs || logs.length === 0) {
			return '<div class="out-noLogs">No logs available</div>';
		}

		return logs.map(function (log) {
			return `
				<div class="out-logEntry out-log-${log.level || 'info'}">
					<span class="out-logTime">${formatTime(log.timestamp)}</span>
					<span class="out-logLevel">${(log.level || 'INFO').toUpperCase()}</span>
					<span class="out-logMessage">${escapeHtml(log.message)}</span>
				</div>
			`;
		}).join('');
	}

	function addLog(log) {
		const container = document.getElementById('logs-container');
		if (!container) {
			return;
		}

		const noLogs = container.querySelector('.out-noLogs');
		if (noLogs) {
			noLogs.remove();
		}

		const logHtml = `
			<div class="out-logEntry out-log-${log.level || 'info'}">
				<span class="out-logTime">${formatTime(log.timestamp)}</span>
				<span class="out-logLevel">${(log.level || 'INFO').toUpperCase()}</span>
				<span class="out-logMessage">${escapeHtml(log.message)}</span>
			</div>
		`;

		container.insertAdjacentHTML('beforeend', logHtml);
		container.scrollTop = container.scrollHeight;
	}

	function clearOutput() {
		tasks = [];
		selectedTaskId = null;
		renderTaskList([]);
		renderTaskOutput(null);
	}

	window.addEventListener('message', function (event) {
		const message = event.data;

		switch (message.type) {
			case 'updateTaskList':
				renderTaskList(message.tasks);
				break;
			case 'showTaskOutput':
				renderTaskOutput(message.output);
				break;
			case 'addLog':
				addLog(message.log);
				break;
			case 'clear':
				clearOutput();
				break;
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
