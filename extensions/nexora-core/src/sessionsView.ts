/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

type SessionRow = { id: string; name: string; createdAt: number };

type SessionSource = {
	getSessionList(): SessionRow[];
	getActiveSessionId(): string;
	switchToSession(sessionId: string): Promise<void>;
};

function groupLabel(createdAt: number, now: number): string {
	const startOfToday = new Date(now);
	startOfToday.setHours(0, 0, 0, 0);
	const startMs = startOfToday.getTime();
	const day = 24 * 60 * 60 * 1000;
	if (createdAt >= startMs) {
		return 'Today';
	}
	if (createdAt >= startMs - day) {
		return 'Yesterday';
	}
	if (createdAt >= startMs - 7 * day) {
		return 'Last 7 Days';
	}
	if (createdAt >= startMs - 30 * day) {
		return 'Last 30 Days';
	}
	return 'Older';
}

/**
 * Compact session list for the secondary side bar (auxiliary bar).
 * Reads the same globalState-backed sessions ChatPanel already owns.
 */
export class SessionsViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexora.sessionsPanel';

	private _view?: vscode.WebviewView;

	constructor(private readonly _source: SessionSource) { }

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = this._html();
		webviewView.webview.onDidReceiveMessage((msg: { type?: string; sessionId?: string }) => {
			if (msg?.type === 'ready') {
				this.refresh();
				return;
			}
			if (msg?.type === 'select' && typeof msg.sessionId === 'string') {
				void this._source.switchToSession(msg.sessionId);
				void vscode.commands.executeCommand('nexora.openChatInEditor');
			}
		});
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this.refresh();
			}
		});
		this.refresh();
	}

	public refresh(): void {
		if (!this._view) {
			return;
		}
		const sessions = this._source.getSessionList();
		const activeSessionId = this._source.getActiveSessionId();
		const now = Date.now();
		const groups: Array<{ label: string; items: SessionRow[] }> = [];
		const order = ['Today', 'Yesterday', 'Last 7 Days', 'Last 30 Days', 'Older'];
		const bucket = new Map<string, SessionRow[]>();
		for (const s of sessions) {
			const label = groupLabel(s.createdAt, now);
			const list = bucket.get(label) || [];
			list.push(s);
			bucket.set(label, list);
		}
		for (const label of order) {
			const items = bucket.get(label);
			if (items && items.length) {
				groups.push({ label, items });
			}
		}
		void this._view.webview.postMessage({ type: 'sessions', groups, activeSessionId });
	}

	public isVisible(): boolean {
		return !!this._view?.visible;
	}

	private _html(): string {
		const nonce = Math.random().toString(36).slice(2);
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			background: transparent;
			margin: 0;
			padding: 8px;
		}
		input {
			width: 100%;
			box-sizing: border-box;
			margin-bottom: 8px;
			padding: 4px 8px;
			border: 1px solid var(--vscode-input-border, transparent);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
		}
		.group { margin-bottom: 10px; }
		.group-title {
			font-size: 11px;
			opacity: 0.7;
			text-transform: uppercase;
			letter-spacing: 0.04em;
			margin: 6px 4px;
		}
		.item {
			display: block;
			width: 100%;
			text-align: left;
			border: none;
			background: transparent;
			color: inherit;
			padding: 6px 8px;
			border-radius: 4px;
			cursor: pointer;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.item:hover { background: var(--vscode-list-hoverBackground); }
		.item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
	</style>
</head>
<body>
	<input id="search" type="search" placeholder="Search sessions..." />
	<div id="list"></div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const listEl = document.getElementById('list');
		const searchEl = document.getElementById('search');
		let groups = [];
		let activeSessionId = '';
		function render() {
			const q = (searchEl.value || '').trim().toLowerCase();
			listEl.innerHTML = '';
			for (const g of groups) {
				const items = g.items.filter(s => !q || String(s.name || '').toLowerCase().includes(q));
				if (!items.length) continue;
				const wrap = document.createElement('div');
				wrap.className = 'group';
				const title = document.createElement('div');
				title.className = 'group-title';
				title.textContent = g.label;
				wrap.appendChild(title);
				for (const s of items) {
					const btn = document.createElement('button');
					btn.type = 'button';
					btn.className = 'item' + (s.id === activeSessionId ? ' active' : '');
					btn.textContent = s.name || 'Chat';
					btn.addEventListener('click', () => vscode.postMessage({ type: 'select', sessionId: s.id }));
					wrap.appendChild(btn);
				}
				listEl.appendChild(wrap);
			}
		}
		searchEl.addEventListener('input', render);
		window.addEventListener('message', (event) => {
			const msg = event.data || {};
			if (msg.type === 'sessions') {
				groups = msg.groups || [];
				activeSessionId = msg.activeSessionId || '';
				render();
			}
		});
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}
}
