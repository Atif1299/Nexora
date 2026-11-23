/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Constellation: the workspace drawn as a graph, with the files a running plan touches lit up.
 *
 * The codebase stays quiet on purpose. Import edges are hidden until a node is
 * selected or a step is running, because drawing every edge at once produces a
 * hairball that answers nothing. What moves is the work, not the map.
 *
 * Blast radius is computed here from the engine's import edges: the files that
 * import something a step is editing. Every edge drawn resolves to a real file,
 * so "what depends on this" is answerable for all of them.
 */
(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Built from their code points so this file stays ASCII, as the repository's hygiene check requires.
	const DOT = String.fromCharCode(0xB7);
	const ELLIPSIS = String.fromCharCode(0x2026);

	// Group colours, assigned to top-level folders in the order they are met, so a
	// repository always draws the same way between reloads.
	const PALETTE = [
		'--vscode-charts-green', '--vscode-charts-blue', '--vscode-charts-purple',
		'--vscode-charts-orange', '--vscode-charts-yellow', '--vscode-charts-red'
	];
	const FALLBACK = ['#4EC9B0', '#569CD6', '#C586C0', '#CE9178', '#D7BA7D', '#F48771'];

	const canvas = document.getElementById('cn-canvas');
	const overlay = document.getElementById('cn-overlay');
	const legend = document.getElementById('cn-legend');
	const rail = document.getElementById('cn-rail');
	const sideName = document.getElementById('cn-selName');
	const sideBody = document.getElementById('cn-selBody');
	const ctx = canvas.getContext('2d');

	const state = {
		nodes: [], byId: {}, edges: [], groups: [], groupColour: {},
		plan: null, steps: [], activeStep: -1, selected: null,
		lit: {}, blast: {}, settle: 0, width: 0, height: 0
	};

	// ---------------------------------------------------------------- utilities

	function readColour(variable, fallback) {
		const value = getComputedStyle(document.documentElement).getPropertyValue(variable);
		return (value && value.trim()) || fallback;
	}

	function escapeHtml(text) {
		return String(text === undefined || text === null ? '' : text)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function post(type, payload) {
		const message = { type: type };
		if (payload) {
			Object.keys(payload).forEach(function (key) { message[key] = payload[key]; });
		}
		vscode.postMessage(message);
	}

	// ---------------------------------------------------------------- the graph

	/** Lay the groups out on a ring so clusters start apart instead of untangling from a knot. */
	function anchorFor(index, total) {
		if (total <= 1) {
			return [0.5, 0.5];
		}
		const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
		return [0.5 + Math.cos(angle) * 0.27, 0.5 + Math.sin(angle) * 0.26];
	}

	function buildGraph(payload) {
		const nodes = [];
		const byId = {};
		const groups = [];
		const folders = {};

		(payload.folders || []).forEach(function (folder) {
			if (groups.indexOf(folder.group) === -1) {
				groups.push(folder.group);
			}
		});
		(payload.nodes || []).forEach(function (file) {
			if (groups.indexOf(file.group) === -1) {
				groups.push(file.group);
			}
		});

		const anchors = {};
		groups.forEach(function (group, index) {
			anchors[group] = anchorFor(index, groups.length);
		});

		// Folder nodes first: files hang off them, which is what makes clusters.
		(payload.folders || []).forEach(function (folder) {
			const node = {
				id: 'dir:' + folder.id, path: folder.id, label: folder.label,
				group: folder.group, folder: true, parent: folder.parent ? 'dir:' + folder.parent : null,
				radius: Math.min(9, 4.5 + Math.sqrt(folder.files || 1)), files: folder.files || 0
			};
			nodes.push(node);
			byId[node.id] = node;
			folders[folder.id] = node;
		});

		(payload.nodes || []).forEach(function (file) {
			const node = {
				id: file.id, path: file.id, label: file.label, group: file.group,
				folder: false, language: file.language, size: file.size_bytes || 0,
				key: !!file.key, parent: file.dir ? 'dir:' + file.dir : null,
				radius: file.key ? 4.6 : 3.2
			};
			nodes.push(node);
			byId[node.id] = node;
		});

		// Seed positions near each group's anchor; the simulation does the rest.
		nodes.forEach(function (node, index) {
			const anchor = anchors[node.group] || [0.5, 0.5];
			const angle = index * 2.3999632;
			const spread = node.folder ? 0.035 : 0.075 + (index % 7) * 0.008;
			node.x = anchor[0] + Math.cos(angle) * spread;
			node.y = anchor[1] + Math.sin(angle) * spread;
			node.vx = 0;
			node.vy = 0;
			node.anchor = anchor;
		});

		const edges = [];
		(payload.edges || []).forEach(function (edge) {
			const from = byId[edge.source];
			const to = byId[edge.target];
			if (from && to) {
				edges.push({ from: from, to: to });
				(from.out || (from.out = [])).push(to);
				(to.in || (to.in = [])).push(from);
			}
		});

		state.nodes = nodes;
		state.byId = byId;
		state.edges = edges;
		state.groups = groups;
		state.folders = folders;
		state.groupColour = {};
		groups.forEach(function (group, index) {
			state.groupColour[group] = readColour(PALETTE[index % PALETTE.length], FALLBACK[index % FALLBACK.length]);
		});
		state.settle = 0;
		state.selected = null;
		renderLegend();
	}

	function renderLegend() {
		legend.innerHTML = state.groups.slice(0, 7).map(function (group) {
			return '<span><i class="cn-swatch" data-group="' + escapeHtml(group) + '"></i>' + escapeHtml(group) + '</span>';
		}).join('');
		// The swatch colour is data, not styling, so it is painted rather than inlined.
		Array.prototype.forEach.call(legend.querySelectorAll('.cn-swatch'), function (element) {
			element.style.backgroundColor = state.groupColour[element.getAttribute('data-group')] || '#888';
		});
	}

	// ------------------------------------------------------------ plan and light

	function statusOf(task) {
		return String(task && task.status ? task.status : 'pending').toLowerCase();
	}

	/** Which files are lit, and what the blast radius around the active step is. */
	function recompute() {
		const lit = {};
		const blast = {};
		state.steps.forEach(function (task, index) {
			const status = statusOf(task);
			if (status === 'pending' || status === 'queued') {
				return;
			}
			const files = filesOf(task);
			files.forEach(function (path) {
				const weight = (status === 'running' || index === state.activeStep) ? 2 : 1;
				lit[path] = Math.max(lit[path] || 0, weight);
			});
		});

		// Blast radius: everything that imports a file this plan has changed, and that the
		// plan is not itself changing. A file the plan already edits is not collateral.
		Object.keys(lit).forEach(function (path) {
			const node = state.byId[path];
			if (!node || !node.in) {
				return;
			}
			node.in.forEach(function (importer) {
				if (!lit[importer.path]) {
					blast[importer.path] = 1;
				}
			});
		});

		state.lit = lit;
		state.blast = blast;

		state.nodes.forEach(function (node) {
			node.lit = node.folder ? 0 : (lit[node.path] || 0);
			node.blast = node.folder ? 0 : (blast[node.path] ? 1 : 0);
		});
		// A folder glows when anything inside it does, so a cluster reads at a distance.
		state.nodes.forEach(function (node) {
			if (node.folder || !node.lit || !node.parent) {
				return;
			}
			let parent = state.byId[node.parent];
			while (parent) {
				parent.lit = Math.max(parent.lit || 0, 1);
				parent = parent.parent ? state.byId[parent.parent] : null;
			}
		});

		updateChips();
	}

	function filesOf(task) {
		const result = task && task.result;
		const files = result && result.files;
		if (!Array.isArray(files)) {
			return [];
		}
		return files.map(function (entry) {
			if (typeof entry === 'string') {
				return entry.replace(/\\/g, '/');
			}
			return String((entry && (entry.path || entry.file)) || '').replace(/\\/g, '/');
		}).filter(Boolean);
	}

	function updateChips() {
		const counts = document.getElementById('cn-counts');
		const live = document.getElementById('cn-live');
		const blastChip = document.getElementById('cn-blast');
		const spend = document.getElementById('cn-spend');

		counts.textContent = state.nodes.filter(function (n) { return !n.folder; }).length +
			' files ' + DOT + ' ' + state.edges.length + ' imports';

		const running = state.steps.filter(function (task) { return statusOf(task) === 'running'; }).length;
		live.hidden = running === 0;
		live.querySelector('.cn-liveText').textContent =
			running + (running === 1 ? ' agent running' : ' agents running');

		const blastCount = Object.keys(state.blast).length;
		blastChip.hidden = blastCount === 0;
		blastChip.textContent = 'blast radius: ' + blastCount + (blastCount === 1 ? ' file' : ' files');

		const spent = state.steps.reduce(function (total, task) {
			const cost = Number(task && (task.actual_cost || 0)) + Number(task && (task.prior_attempts_cost || 0));
			return total + (isFinite(cost) ? cost : 0);
		}, 0);
		spend.hidden = !state.steps.length;
		spend.textContent = '$' + spent.toFixed(4);
	}

	function renderRail() {
		if (!state.steps.length) {
			rail.innerHTML = '<span class="cn-railEmpty">No plan is running. Ask Nexora to build something, approve the plan, and the files each step touches light up here.</span>';
			return;
		}
		rail.innerHTML = '';
		state.steps.forEach(function (task, index) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'cn-stepBtn';
			button.setAttribute('data-status', statusOf(task));
			button.setAttribute('aria-pressed', String(index === state.activeStep));
			button.innerHTML = '<i class="cn-dot" aria-hidden="true"></i><span></span>';
			button.querySelector('span').textContent = task.name || task.task_id || ('Step ' + (index + 1));
			button.addEventListener('click', function () {
				state.activeStep = state.activeStep === index ? -1 : index;
				state.selected = null;
				showStep(state.activeStep >= 0 ? state.steps[state.activeStep] : null);
				recompute();
				renderRail();
			});
			rail.appendChild(button);
		});
	}

	// ------------------------------------------------------------- the inspector

	function showEmpty() {
		sideName.textContent = 'Nothing selected';
		sideBody.className = 'cn-empty';
		sideBody.textContent = 'Click a node to see what it is, what imports it, and which step is touching it.';
	}

	function listOf(nodes, arrow) {
		if (!nodes || !nodes.length) {
			return '';
		}
		return '<div class="cn-list">' + nodes.slice(0, 8).map(function (node) {
			return '<button type="button" class="cn-listItem" data-open="' + escapeHtml(node.path) + '">' +
				'<em>' + arrow + '</em><span>' + escapeHtml(node.path) + '</span></button>';
		}).join('') + '</div>';
	}

	function stepTouching(path) {
		for (let i = 0; i < state.steps.length; i++) {
			if (filesOf(state.steps[i]).indexOf(path) !== -1) {
				return state.steps[i];
			}
		}
		return null;
	}

	function showNode(node) {
		if (!node) {
			showEmpty();
			return;
		}
		sideName.textContent = node.path;
		sideBody.className = '';
		const importers = node.in || [];
		const imports = node.out || [];
		let html = '';
		html += '<div class="cn-kv"><span>Kind</span><b>' + (node.folder ? 'folder' : escapeHtml(node.language || 'file')) + '</b></div>';
		html += '<div class="cn-kv"><span>Area</span><b>' + escapeHtml(node.group) + '</b></div>';
		if (node.folder) {
			html += '<div class="cn-kv"><span>Files</span><b>' + node.files + '</b></div>';
		} else {
			html += '<div class="cn-kv"><span>Size</span><b>' + Math.max(1, Math.round(node.size / 1024)) + ' KB</b></div>';
			html += '<div class="cn-kv"><span>Imported by</span><b>' + importers.length + '</b></div>';
			html += '<div class="cn-kv"><span>Imports</span><b>' + imports.length + '</b></div>';
		}
		if (importers.length) {
			html += '<div><span class="cn-k">Imported by</span>' + listOf(importers, '&larr;') + '</div>';
		}
		if (imports.length) {
			html += '<div><span class="cn-k">Imports</span>' + listOf(imports, '&rarr;') + '</div>';
		}
		const task = node.folder ? null : stepTouching(node.path);
		if (task) {
			html += '<div><span class="cn-k">Touched by</span><div class="cn-step"><b>' +
				escapeHtml(task.name || task.task_id) + '</b><small>' +
				escapeHtml(task.platform || task.capability || 'step') + ' ' + DOT + ' $' +
				Number(task.actual_cost || task.estimated_cost || 0).toFixed(4) + '</small></div></div>';
		}
		if (!node.folder) {
			html += '<div class="cn-actions"><button type="button" class="nx-btn nx-btn-primary" data-open="' +
				escapeHtml(node.path) + '">Open file</button></div>';
		}
		sideBody.innerHTML = html;
	}

	function showStep(task) {
		if (!task) {
			showEmpty();
			return;
		}
		sideName.textContent = task.name || task.task_id;
		sideBody.className = '';
		const files = filesOf(task);
		let html = '';
		html += '<div class="cn-kv"><span>Status</span><b>' + escapeHtml(statusOf(task)) + '</b></div>';
		html += '<div class="cn-kv"><span>Runs on</span><b>' + escapeHtml(task.platform || task.capability || 'step') + '</b></div>';
		if (task.route && task.route.target) {
			html += '<div class="cn-kv"><span>Route</span><b>' + escapeHtml(task.route.kind + ':' + task.route.target) + '</b></div>';
		}
		html += '<div class="cn-kv"><span>Cost</span><b>$' +
			Number(task.actual_cost || task.estimated_cost || 0).toFixed(4) + '</b></div>';
		html += '<div class="cn-kv"><span>Files changed</span><b>' + files.length + '</b></div>';
		if (files.length) {
			html += '<div><span class="cn-k">Changed</span>' + listOf(files.map(function (path) {
				return state.byId[path] || { path: path };
			}), '&bull;') + '</div>';
		}
		const blast = Object.keys(state.blast);
		if (blast.length) {
			html += '<div><span class="cn-k">Blast radius</span>' + listOf(blast.map(function (path) {
				return state.byId[path] || { path: path };
			}), '&larr;') + '</div>';
		}
		sideBody.innerHTML = html;
	}

	sideBody.addEventListener('click', function (event) {
		const target = event.target.closest('[data-open]');
		if (target) {
			post('openFile', { path: target.getAttribute('data-open') });
		}
	});

	// ------------------------------------------------------------- the simulation

	function resize() {
		const rect = canvas.getBoundingClientRect();
		const ratio = Math.min(window.devicePixelRatio || 1, 2);
		state.width = rect.width;
		state.height = rect.height;
		canvas.width = Math.max(1, Math.round(rect.width * ratio));
		canvas.height = Math.max(1, Math.round(rect.height * ratio));
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	}

	function simulate() {
		const nodes = state.nodes;
		const count = nodes.length;
		for (let i = 0; i < count; i++) {
			const a = nodes[i];
			for (let j = i + 1; j < count; j++) {
				const b = nodes[j];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const d2 = dx * dx + dy * dy + 0.0004;
				if (d2 > 0.04) {
					continue;
				}
				const push = 0.000022 / d2;
				a.vx -= dx * push; a.vy -= dy * push;
				b.vx += dx * push; b.vy += dy * push;
			}
		}
		// Containment: a file is held by its folder, a folder by the one above it.
		for (let k = 0; k < count; k++) {
			const node = nodes[k];
			const parent = node.parent ? state.byId[node.parent] : null;
			if (parent) {
				spring(node, parent, node.folder ? 0.07 : 0.035, 0.03);
			}
			const anchor = node.anchor;
			node.vx += (anchor[0] - node.x) * 0.004;
			node.vy += (anchor[1] - node.y) * 0.004;
			node.vx *= 0.85;
			node.vy *= 0.85;
			node.x += node.vx;
			node.y += node.vy;
			node.x = Math.max(0.04, Math.min(0.96, node.x));
			node.y = Math.max(0.06, Math.min(0.94, node.y));
		}
	}

	function spring(a, b, rest, strength) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const distance = Math.sqrt(dx * dx + dy * dy) || 0.0001;
		const force = (distance - rest) * strength;
		const fx = (dx / distance) * force;
		const fy = (dy / distance) * force;
		a.vx += fx; a.vy += fy;
		b.vx -= fx; b.vy -= fy;
	}

	function px(node) { return node.x * state.width; }
	function py(node) { return node.y * state.height; }

	let tick = 0;

	function draw() {
		ctx.clearRect(0, 0, state.width, state.height);
		if (!state.nodes.length) {
			return;
		}
		const border = readColour('--nx-border', '#333');
		const info = readColour('--nx-info', '#569CD6');
		const warn = readColour('--nx-warn', '#D7BA7D');
		const fg = readColour('--nx-fg', '#ddd');
		const muted = readColour('--nx-muted', '#888');
		const pulse = reduce ? 0.6 : (Math.sin(tick / 20) + 1) / 2;
		const labels = [];

		// Containment, drawn faint: this is the shape of the repository.
		ctx.strokeStyle = border;
		ctx.globalAlpha = 0.55;
		ctx.lineWidth = 1;
		ctx.beginPath();
		state.nodes.forEach(function (node) {
			const parent = node.parent ? state.byId[node.parent] : null;
			if (!parent) {
				return;
			}
			ctx.moveTo(px(node), py(node));
			ctx.lineTo(px(parent), py(parent));
		});
		ctx.stroke();
		ctx.globalAlpha = 1;

		// Imports, drawn only where they are being asked about.
		state.edges.forEach(function (edge) {
			const from = edge.from;
			const to = edge.to;
			const hot = from.lit === 2 || to.lit === 2 || from.blast || to.blast;
			const picked = state.selected && (from === state.selected || to === state.selected);
			if (!hot && !picked) {
				return;
			}
			ctx.strokeStyle = picked ? fg : ((from.blast || to.blast) ? warn : info);
			ctx.globalAlpha = picked ? 0.55 : 0.45;
			ctx.lineWidth = picked ? 1.4 : 1.1;
			ctx.beginPath();
			ctx.moveTo(px(from), py(from));
			ctx.lineTo(px(to), py(to));
			ctx.stroke();
		});
		ctx.globalAlpha = 1;

		state.nodes.forEach(function (node) {
			const x = px(node);
			const y = py(node);
			const colour = state.groupColour[node.group] || muted;

			if (node.blast) {
				ctx.strokeStyle = warn;
				ctx.globalAlpha = 0.3 + pulse * 0.4;
				ctx.lineWidth = 1.2;
				ctx.beginPath();
				ctx.arc(x, y, node.radius + 5 + pulse * 2.5, 0, Math.PI * 2);
				ctx.stroke();
				ctx.globalAlpha = 1;
			}
			if (node.lit === 2) {
				ctx.fillStyle = info;
				ctx.globalAlpha = 0.1 + pulse * 0.13;
				ctx.beginPath();
				ctx.arc(x, y, node.radius + 9 + pulse * 5, 0, Math.PI * 2);
				ctx.fill();
				ctx.globalAlpha = 1;
			}

			ctx.beginPath();
			ctx.arc(x, y, node.radius, 0, Math.PI * 2);
			if (node.lit === 2) {
				ctx.fillStyle = info;
			} else if (node.lit === 1) {
				ctx.fillStyle = colour;
			} else if (node.folder) {
				ctx.fillStyle = muted;
				ctx.globalAlpha = 0.5;
			} else {
				ctx.fillStyle = muted;
				ctx.globalAlpha = 0.32;
			}
			ctx.fill();
			ctx.globalAlpha = 1;

			if (state.selected === node) {
				ctx.strokeStyle = fg;
				ctx.lineWidth = 1.6;
				ctx.beginPath();
				ctx.arc(x, y, node.radius + 3.5, 0, Math.PI * 2);
				ctx.stroke();
			}

			// Labels are drawn after every node, so none is painted over by a later circle.
			if (node.folder || node.lit || node.blast || state.selected === node) {
				labels.push({ node: node, x: x, y: y - node.radius - 5 });
			}
		});

		drawLabels(labels, info, fg, muted);
	}

	/**
	 * Labels, thinned so they stay readable.
	 *
	 * A cluster puts dozens of names in the same few hundred pixels, and overlapping
	 * text reads as a smudge rather than as a name. Whatever matters most is drawn
	 * first and claims its cell; anything that would land on top of it is dropped.
	 */
	function drawLabels(labels, info, fg, muted) {
		const CELL_X = 58;
		const CELL_Y = 13;
		const taken = {};
		labels.sort(function (a, b) {
			return weightOf(b.node) - weightOf(a.node);
		});
		ctx.textAlign = 'center';
		labels.forEach(function (entry) {
			const cell = Math.round(entry.x / CELL_X) + ':' + Math.round(entry.y / CELL_Y);
			if (taken[cell]) {
				return;
			}
			taken[cell] = true;
			const node = entry.node;
			ctx.font = (node.folder ? '600 ' : '') + '10px ' + readColour('--nx-font-mono', 'monospace');
			ctx.fillStyle = node.lit === 2 ? info : (node.lit || state.selected === node ? fg : muted);
			ctx.fillText(node.label, entry.x, entry.y);
		});
	}

	/** Which label wins its cell: the selection, then live work, then the bigger folder. */
	function weightOf(node) {
		if (state.selected === node) {
			return 100;
		}
		if (node.lit === 2) {
			return 90;
		}
		if (node.blast) {
			return 80;
		}
		if (node.lit) {
			return 70;
		}
		return node.folder ? Math.min(60, 10 + (node.files || 0)) : 5;
	}

	function frame() {
		tick++;
		if (state.nodes.length) {
			if (state.settle < 500) {
				simulate();
				state.settle++;
			} else if (!reduce && tick % 3 === 0) {
				simulate();
			}
			draw();
		}
		requestAnimationFrame(frame);
	}

	canvas.addEventListener('click', function (event) {
		const rect = canvas.getBoundingClientRect();
		const mx = event.clientX - rect.left;
		const my = event.clientY - rect.top;
		let best = null;
		let bestDistance = 20 * 20;
		state.nodes.forEach(function (node) {
			const dx = px(node) - mx;
			const dy = py(node) - my;
			const distance = dx * dx + dy * dy;
			if (distance < bestDistance) {
				bestDistance = distance;
				best = node;
			}
		});
		state.selected = best;
		showNode(best);
	});

	canvas.addEventListener('dblclick', function () {
		if (state.selected && !state.selected.folder) {
			post('openFile', { path: state.selected.path });
		}
	});

	window.addEventListener('resize', resize);

	// ------------------------------------------------------------------ messages

	window.addEventListener('message', function (event) {
		const message = event.data || {};
		if (message.type === 'graph') {
			// keepOverlay: an empty folder already has its own message showing.
			overlay.hidden = !message.keepOverlay;
			buildGraph(message.graph || {});
			resize();
			for (let warm = 0; warm < 200; warm++) {
				simulate();
			}
			recompute();
			showEmpty();
		} else if (message.type === 'loading') {
			overlay.hidden = false;
			overlay.textContent = message.text || 'Reading the workspace' + ELLIPSIS;
		} else if (message.type === 'error') {
			overlay.hidden = false;
			overlay.textContent = message.text || 'The workspace graph could not be built.';
		} else if (message.type === 'plan') {
			state.plan = message.plan || null;
			state.steps = (state.plan && state.plan.tasks) || [];
			if (state.activeStep >= state.steps.length) {
				state.activeStep = -1;
			}
			renderRail();
			recompute();
		} else if (message.type === 'taskUpdate') {
			applyTaskUpdate(message.update || {});
		}
	});

	/** One websocket event from the executor: fold it into the plan we already hold. */
	function applyTaskUpdate(update) {
		if (!state.steps.length || !update.task_id) {
			return;
		}
		for (let i = 0; i < state.steps.length; i++) {
			const task = state.steps[i];
			if (task.task_id !== update.task_id) {
				continue;
			}
			if (update.status) {
				task.status = update.status;
			}
			if (update.result) {
				task.result = update.result;
			}
			if (typeof update.cost === 'number') {
				task.actual_cost = update.cost;
			}
			if (statusOf(task) === 'running') {
				state.activeStep = i;
			}
			break;
		}
		renderRail();
		recompute();
		if (state.activeStep >= 0 && !state.selected) {
			showStep(state.steps[state.activeStep]);
		}
	}

	document.getElementById('cn-refresh').addEventListener('click', function () {
		post('refresh');
	});

	resize();
	renderRail();
	showEmpty();
	requestAnimationFrame(frame);
	post('ready');
}());
