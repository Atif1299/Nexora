/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* global acquireVsCodeApi */
(function () {
	const vscode = acquireVsCodeApi();

	let currentPlan = null;
	let taskElements = {};

	const STATUS_LABELS = {
		pending: 'pending',
		queued: 'queued',
		running: 'running',
		success: 'success',
		failed: 'failed',
		skipped: 'skipped',
		cancelled: 'cancelled'
	};

	const STATUS_MARKS = {
		pending: 'o',
		queued: 'q',
		running: '>',
		success: '+',
		failed: 'x',
		skipped: '-',
		cancelled: 'x'
	};

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text || '';
		return div.innerHTML;
	}

	function buildLevels(tasks) {
		const levels = [];
		const assigned = new Set();

		let currentLevel = tasks.filter(function (t) {
			return !t.dependencies || t.dependencies.length === 0;
		});

		while (currentLevel.length > 0) {
			levels.push(currentLevel);
			currentLevel.forEach(function (t) {
				assigned.add(t.task_id);
			});

			currentLevel = tasks.filter(function (t) {
				return !assigned.has(t.task_id) &&
					t.dependencies &&
					t.dependencies.every(function (dep) {
						return assigned.has(dep);
					});
			});
		}

		const remaining = tasks.filter(function (t) {
			return !assigned.has(t.task_id);
		});
		if (remaining.length > 0) {
			levels.push(remaining);
		}

		return levels;
	}

	function renderWorkflow(plan) {
		const root = document.getElementById('workflow-root');
		if (!root) {
			return;
		}

		currentPlan = plan;
		taskElements = {};

		if (!plan || !plan.tasks || plan.tasks.length === 0) {
			root.innerHTML = `
				<div class="wf-empty">
					<div class="wf-emptyIcon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<rect x="3" y="3" width="7" height="7" rx="1"/>
							<rect x="14" y="3" width="7" height="7" rx="1"/>
							<rect x="14" y="14" width="7" height="7" rx="1"/>
							<rect x="3" y="14" width="7" height="7" rx="1"/>
							<path d="M10 6.5h4"/>
							<path d="M17.5 10v4"/>
							<path d="M14 17.5h-4"/>
							<path d="M6.5 14v-4"/>
						</svg>
					</div>
					<h3 class="wf-emptyTitle">No Tasks</h3>
					<p class="wf-emptyText">The workflow has no tasks to display</p>
				</div>
			`;
			return;
		}

		const levels = buildLevels(plan.tasks);
		const statusClass = (plan.status || 'planning').toLowerCase().replace(/_/g, '-');

		root.innerHTML = `
			<div class="wf-header">
				<h3 class="wf-title">${escapeHtml(plan.user_request || 'Workflow')}</h3>
				<div class="wf-meta">
					<span class="wf-status wf-status-${statusClass}">${escapeHtml(plan.status || 'planning')}</span>
					<span class="wf-cost">Est: $${(plan.estimated_total_cost || 0).toFixed(4)}</span>
				</div>
			</div>
			<div class="wf-container">
				<div class="wf-levels" id="levels-container"></div>
			</div>
			<div class="wf-legend">
				<span class="wf-legendItem"><span class="wf-dot wf-dot-pending"></span>Pending</span>
				<span class="wf-legendItem"><span class="wf-dot wf-dot-running"></span>Running</span>
				<span class="wf-legendItem"><span class="wf-dot wf-dot-success"></span>Success</span>
				<span class="wf-legendItem"><span class="wf-dot wf-dot-failed"></span>Failed</span>
				<span class="wf-legendItem"><span class="wf-dot wf-dot-skipped"></span>Skipped</span>
			</div>
		`;

		const levelsContainer = document.getElementById('levels-container');

		levels.forEach(function (levelTasks, levelIndex) {
			if (levelIndex > 0) {
				const arrowCol = document.createElement('div');
				arrowCol.className = 'wf-levelArrow';
				arrowCol.setAttribute('aria-hidden', 'true');
				arrowCol.textContent = '->';
				levelsContainer.appendChild(arrowCol);
			}

			const levelDiv = document.createElement('div');
			levelDiv.className = 'wf-level';
			levelDiv.setAttribute('data-level', String(levelIndex));

			levelTasks.forEach(function (task) {
				const node = createTaskNode(task);
				levelDiv.appendChild(node);
				taskElements[task.task_id] = node;
			});

			levelsContainer.appendChild(levelDiv);
		});
	}

	function createTaskNode(task) {
		const status = (task.status || 'pending').toLowerCase();
		const statusMark = STATUS_MARKS[status] || '?';
		const statusLabel = STATUS_LABELS[status] || status;

		const node = document.createElement('div');
		node.className = 'wf-node wf-node-' + status;
		node.id = 'wf-task-' + task.task_id;
		node.setAttribute('data-task-id', task.task_id);
		node.setAttribute('data-status', status);
		node.setAttribute('role', 'button');
		node.setAttribute('tabindex', '0');
		node.setAttribute('aria-label', 'Task ' + (task.name || task.task_id) + ', status ' + statusLabel);

		const errorHtml = (status === 'skipped' || status === 'failed') && task.error
			? `<div class="wf-nodeError">${escapeHtml(task.error)}</div>`
			: '';

		node.innerHTML = `
			<div class="wf-nodeHeader">
				<span class="wf-nodeIcon">${statusMark}</span>
				<span class="wf-nodeName">${escapeHtml(task.name || task.task_id)}</span>
			</div>
			<div class="wf-nodeBody">
				<div class="wf-nodeStatus">${escapeHtml(statusLabel)}</div>
				${errorHtml}
			</div>
			${status === 'running' ? '<div class="wf-spinner"></div>' : ''}
		`;

		function openTask() {
			vscode.postMessage({ type: 'taskClicked', taskId: task.task_id });
		}

		node.addEventListener('click', openTask);
		node.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openTask();
			}
		});

		return node;
	}

	function updateTaskStatus(taskId, status, result, error, cost) {
		const normalized = (status || 'pending').toLowerCase();
		const node = taskElements[taskId];
		if (!node) {
			if (currentPlan && currentPlan.tasks) {
				const task = currentPlan.tasks.find(function (t) {
					return t.task_id === taskId;
				});
				if (task) {
					task.status = normalized;
					if (result !== undefined) {
						task.result = result;
					}
					if (error !== undefined) {
						task.error = error;
					}
					if (cost !== undefined) {
						task.actual_cost = cost;
					}
					renderWorkflow(currentPlan);
				}
			}
			return;
		}

		node.className = 'wf-node wf-node-' + normalized;
		node.setAttribute('data-status', normalized);

		const iconSpan = node.querySelector('.wf-nodeIcon');
		if (iconSpan) {
			iconSpan.textContent = STATUS_MARKS[normalized] || '?';
		}

		const statusEl = node.querySelector('.wf-nodeStatus');
		if (statusEl) {
			statusEl.textContent = STATUS_LABELS[normalized] || normalized;
		}

		let errorEl = node.querySelector('.wf-nodeError');
		if ((normalized === 'skipped' || normalized === 'failed') && error) {
			if (!errorEl) {
				const body = node.querySelector('.wf-nodeBody');
				if (body) {
					errorEl = document.createElement('div');
					errorEl.className = 'wf-nodeError';
					body.appendChild(errorEl);
				}
			}
			if (errorEl) {
				errorEl.textContent = error;
			}
		} else if (errorEl) {
			errorEl.remove();
		}

		const existingSpinner = node.querySelector('.wf-spinner');
		if (normalized === 'running' && !existingSpinner) {
			const spinner = document.createElement('div');
			spinner.className = 'wf-spinner';
			node.appendChild(spinner);
		} else if (normalized !== 'running' && existingSpinner) {
			existingSpinner.remove();
		}

		if (currentPlan && currentPlan.tasks) {
			const task = currentPlan.tasks.find(function (t) {
				return t.task_id === taskId;
			});
			if (task) {
				task.status = normalized;
				if (result !== undefined) {
					task.result = result;
				}
				if (error !== undefined) {
					task.error = error;
				}
				if (cost !== undefined) {
					task.actual_cost = cost;
				}
			}
		}
	}

	function clearWorkflow() {
		currentPlan = null;
		taskElements = {};
		const root = document.getElementById('workflow-root');
		if (!root) {
			return;
		}
		root.innerHTML = `
			<div class="wf-empty">
				<div class="wf-emptyIcon">
					<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<rect x="3" y="3" width="7" height="7" rx="1"/>
						<rect x="14" y="3" width="7" height="7" rx="1"/>
						<rect x="14" y="14" width="7" height="7" rx="1"/>
						<rect x="3" y="14" width="7" height="7" rx="1"/>
						<path d="M10 6.5h4"/>
						<path d="M17.5 10v4"/>
						<path d="M14 17.5h-4"/>
						<path d="M6.5 14v-4"/>
					</svg>
				</div>
				<h3 class="wf-emptyTitle">No Active Workflow</h3>
				<p class="wf-emptyText">Start a new orchestration in Chat to see the workflow graph</p>
			</div>
		`;
	}

	window.addEventListener('message', function (event) {
		const message = event.data;
		if (!message || !message.type) {
			return;
		}

		switch (message.type) {
			case 'updatePlan':
				renderWorkflow(message.plan);
				break;
			case 'updateTaskStatus':
				updateTaskStatus(message.taskId, message.status, message.result, message.error, message.cost);
				break;
			case 'clearPlan':
				clearWorkflow();
				break;
		}
	});

	vscode.postMessage({ type: 'ready' });
}());
