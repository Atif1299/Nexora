/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* global acquireVsCodeApi */
(function () {
	const vscode = acquireVsCodeApi();

	let currentPlan = null;
	let taskElements = {};

	const STATUS_ICONS = {
		pending: '...',
		queued: '[Q]',
		running: '[R]',
		success: 'OK',
		failed: 'X',
		skipped: '>>',
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
					<span class="wf-status wf-status-${statusClass}">${plan.status || 'planning'}</span>
					<span class="wf-cost">Est: $${(plan.estimated_total_cost || 0).toFixed(4)}</span>
				</div>
			</div>
			<div class="wf-container">
				<svg class="wf-connections" id="connections-svg"></svg>
				<div class="wf-levels" id="levels-container"></div>
			</div>
			<div class="wf-legend">
				<span class="wf-legendItem"><span class="wf-dot wf-dot-pending"></span>Pending</span>
				<span class="wf-legendItem"><span class="wf-dot wf-dot-running"></span>Running</span>
				<span class="wf-legendItem"><span class="wf-dot wf-dot-success"></span>Success</span>
				<span class="wf-legendItem"><span class="wf-dot wf-dot-failed"></span>Failed</span>
			</div>
		`;

		const levelsContainer = document.getElementById('levels-container');

		levels.forEach(function (levelTasks, levelIndex) {
			const levelDiv = document.createElement('div');
			levelDiv.className = 'wf-level';
			levelDiv.setAttribute('data-level', levelIndex);

			levelTasks.forEach(function (task) {
				const node = createTaskNode(task);
				levelDiv.appendChild(node);
				taskElements[task.task_id] = node;
			});

			levelsContainer.appendChild(levelDiv);
		});

		setTimeout(function () {
			drawConnections(plan.tasks);
		}, 50);
	}

	function createTaskNode(task) {
		const status = task.status || 'pending';
		const statusIcon = STATUS_ICONS[status] || '?';

		const node = document.createElement('div');
		node.className = 'wf-node wf-node-' + status;
		node.id = 'wf-task-' + task.task_id;
		node.setAttribute('data-task-id', task.task_id);

		node.innerHTML = `
			<div class="wf-nodeHeader">
				<span class="wf-nodeIcon">${statusIcon}</span>
				<span class="wf-nodeName">${escapeHtml(task.name || task.task_id)}</span>
			</div>
			<div class="wf-nodeBody">
				<div class="wf-nodeRow">
					<span class="wf-nodeLabel">Platform:</span>
					<span class="wf-nodeValue">${escapeHtml(task.platform || 'N/A')}</span>
				</div>
				<div class="wf-nodeRow">
					<span class="wf-nodeLabel">Operation:</span>
					<span class="wf-nodeValue">${escapeHtml(task.operation || 'N/A')}</span>
				</div>
				${task.estimated_cost > 0 ? `
				<div class="wf-nodeRow">
					<span class="wf-nodeLabel">Cost:</span>
					<span class="wf-nodeValue">$${task.estimated_cost.toFixed(4)}</span>
				</div>
				` : ''}
			</div>
			${status === 'running' ? '<div class="wf-spinner"></div>' : ''}
		`;

		node.addEventListener('click', function () {
			vscode.postMessage({ type: 'taskClicked', taskId: task.task_id });
		});

		return node;
	}

	function drawConnections(tasks) {
		const svg = document.getElementById('connections-svg');
		if (!svg) {
			return;
		}

		svg.innerHTML = '';
		const rect = svg.getBoundingClientRect();

		const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
		defs.innerHTML = `
			<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
				<polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-editorWidget-border, #6b7280)" />
			</marker>
		`;
		svg.appendChild(defs);

		tasks.forEach(function (task) {
			if (!task.dependencies || task.dependencies.length === 0) {
				return;
			}

			const targetNode = taskElements[task.task_id];
			if (!targetNode) {
				return;
			}

			task.dependencies.forEach(function (depId) {
				const sourceNode = taskElements[depId];
				if (!sourceNode) {
					return;
				}

				const sourceRect = sourceNode.getBoundingClientRect();
				const targetRect = targetNode.getBoundingClientRect();

				const x1 = sourceRect.right - rect.left;
				const y1 = sourceRect.top + sourceRect.height / 2 - rect.top;
				const x2 = targetRect.left - rect.left;
				const y2 = targetRect.top + targetRect.height / 2 - rect.top;

				const midX = (x1 + x2) / 2;
				const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
				path.setAttribute('d', `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
				path.setAttribute('class', 'wf-line');
				path.setAttribute('marker-end', 'url(#arrowhead)');

				svg.appendChild(path);
			});
		});
	}

	function updateTaskStatus(taskId, status, result, error, cost) {
		const node = taskElements[taskId];
		if (!node) {
			return;
		}

		node.className = 'wf-node wf-node-' + status;

		const iconSpan = node.querySelector('.wf-nodeIcon');
		if (iconSpan) {
			iconSpan.textContent = STATUS_ICONS[status] || '?';
		}

		const existingSpinner = node.querySelector('.wf-spinner');
		if (status === 'running' && !existingSpinner) {
			const spinner = document.createElement('div');
			spinner.className = 'wf-spinner';
			node.appendChild(spinner);
		} else if (status !== 'running' && existingSpinner) {
			existingSpinner.remove();
		}

		if (cost !== undefined && cost > 0) {
			const costRow = node.querySelector('.wf-nodeRow:last-child');
			if (costRow) {
				const valueSpan = costRow.querySelector('.wf-nodeValue');
				if (valueSpan && costRow.textContent.includes('Cost')) {
					valueSpan.textContent = '$' + cost.toFixed(4);
				}
			}
		}

		if (currentPlan && currentPlan.tasks) {
			const task = currentPlan.tasks.find(function (t) {
				return t.task_id === taskId;
			});
			if (task) {
				task.status = status;
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
