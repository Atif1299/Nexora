/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { acquireEditorPanel } from './editorPage';
import {
	agentPageUrl,
	clickPageNorm,
	gotoAgentPage,
	resumeScreencast,
	setBrowserStatusListener,
	setScreencastListener,
	stopScreencast,
	wheelPage
} from './tools/browserSession';

export type BrowserUiSettings = {
	openLocalLinks: boolean;
	allowAgentControl: boolean;
};

export function getBrowserUiSettings(): BrowserUiSettings {
	const cfg = vscode.workspace.getConfiguration('nexora');
	return {
		openLocalLinks: cfg.get<boolean>('browser.openLocalLinks', true) !== false,
		allowAgentControl: cfg.get<boolean>('browser.allowAgentControl', true) !== false
	};
}

export function parseHttpUrl(raw: string): URL | undefined {
	const text = String(raw || '').trim();
	if (!text) {
		return undefined;
	}
	try {
		const parsed = new URL(text);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

export function isLocalhostHttpUrl(parsed: URL): boolean {
	const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	return host === 'localhost'
		|| host === '127.0.0.1'
		|| host === '0.0.0.0'
		|| host === '::1'
		|| host === '::'
		|| host.endsWith('.localhost');
}

const VIEW_TYPE = 'nexora.browser';

let boundPanel: vscode.WebviewPanel | undefined;

function extensionRoot(): vscode.Uri {
	return vscode.Uri.file(path.join(__dirname, '..', '..'));
}

function panelHtml(): string {
	const nonce = Math.random().toString(36).slice(2);
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<style>
		html, body { margin: 0; height: 100%; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
		#bar { display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
		#url { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 4px 8px; }
		#status { font-size: 12px; opacity: 0.8; white-space: nowrap; }
		#frame { display: block; width: 100%; height: auto; }
	</style>
</head>
<body>
	<div id="bar">
		<input id="url" type="text" placeholder="https://" />
		<span id="status"></span>
	</div>
	<img id="frame" alt="Nexora Browser" />
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const urlEl = document.getElementById('url');
		const statusEl = document.getElementById('status');
		const img = document.getElementById('frame');
		window.addEventListener('message', (e) => {
			const m = e.data || {};
			if (m.type === 'frame') {
				img.src = 'data:image/jpeg;base64,' + m.jpeg;
				if (m.url && document.activeElement !== urlEl) { urlEl.value = m.url; }
			} else if (m.type === 'url') {
				if (document.activeElement !== urlEl) { urlEl.value = m.url || ''; }
			} else if (m.type === 'status') {
				statusEl.textContent = m.text || '';
			}
		});
		urlEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { vscode.postMessage({ type: 'navigate', url: urlEl.value }); }
		});
		img.addEventListener('click', (e) => {
			const r = img.getBoundingClientRect();
			if (!r.width || !r.height) { return; }
			vscode.postMessage({ type: 'click', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
		});
		img.addEventListener('wheel', (e) => {
			e.preventDefault();
			vscode.postMessage({ type: 'wheel', dx: e.deltaX, dy: e.deltaY });
		}, { passive: false });
	</script>
</body>
</html>`;
}

function bindPanel(panel: vscode.WebviewPanel): void {
	if (boundPanel === panel) {
		return;
	}
	boundPanel = panel;
	panel.webview.html = panelHtml();
	panel.webview.onDidReceiveMessage(async (message: { type?: string; url?: string; x?: number; y?: number; dx?: number; dy?: number }) => {
		try {
			if (message.type === 'click') {
				await clickPageNorm(Number(message.x), Number(message.y));
			} else if (message.type === 'wheel') {
				await wheelPage(Number(message.dx) || 0, Number(message.dy) || 0);
			} else if (message.type === 'navigate') {
				const parsed = parseHttpUrl(String(message.url || '')) ?? parseHttpUrl('https://' + String(message.url || '').trim());
				if (!parsed) {
					panel.webview.postMessage({ type: 'status', text: 'Enter an http or https URL' });
					return;
				}
				await gotoAgentPage(parsed.toString());
				panel.webview.postMessage({ type: 'url', url: parsed.toString() });
			}
		} catch (err) {
			const text = err instanceof Error ? err.message : String(err);
			panel.webview.postMessage({ type: 'status', text });
		}
	});
	panel.onDidDispose(() => {
		if (boundPanel === panel) {
			boundPanel = undefined;
		}
		void stopScreencast();
	});
	panel.onDidChangeViewState(() => {
		if (panel.visible) {
			void resumeScreencast();
		}
	});
}

setScreencastListener(payload => {
	boundPanel?.webview.postMessage({ type: 'frame', jpeg: payload.jpeg, url: payload.url });
});
setBrowserStatusListener(text => {
	boundPanel?.webview.postMessage({ type: 'status', text });
});

/**
 * Open the Nexora Browser editor tab (Playwright screencast). Navigate if a URL is given.
 */
export async function openNexoraBrowser(urlOrUri?: string | vscode.Uri): Promise<void> {
	const panel = acquireEditorPanel({
		viewType: VIEW_TYPE,
		title: 'Nexora Browser',
		extensionUri: extensionRoot()
	});
	bindPanel(panel);
	const current = agentPageUrl();
	if (current) {
		void panel.webview.postMessage({ type: 'url', url: current });
		void resumeScreencast();
	}

	if (urlOrUri === undefined || urlOrUri === '') {
		return;
	}

	const raw = typeof urlOrUri === 'string' ? urlOrUri : urlOrUri.toString(true);
	const parsed = parseHttpUrl(raw) ?? parseHttpUrl('https://' + raw.trim());
	if (!parsed) {
		void vscode.window.showErrorMessage('Nexora Browser only opens http or https URLs.');
		return;
	}

	try {
		await gotoAgentPage(parsed.toString());
		void panel.webview.postMessage({ type: 'url', url: parsed.toString() });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		void panel.webview.postMessage({ type: 'status', text: msg });
		void vscode.window.showErrorMessage(msg);
	}
}

/** Chat link clicks: localhost stays in Nexora Browser when the setting is on. */
export async function openUrlFromChat(url: string): Promise<void> {
	const parsed = parseHttpUrl(url);
	if (!parsed) {
		return;
	}
	if (getBrowserUiSettings().openLocalLinks && isLocalhostHttpUrl(parsed)) {
		await openNexoraBrowser(parsed.toString());
		return;
	}
	await vscode.env.openExternal(vscode.Uri.parse(parsed.toString()));
}
