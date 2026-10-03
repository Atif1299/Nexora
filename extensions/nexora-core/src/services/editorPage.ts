/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	getEngineState,
	onDidChangeEngineState,
	showEngineOutput,
	type EngineState
} from './engineProcess';

export interface AcquireEditorPanelOptions {
	viewType: string;
	title: string;
	extensionUri: vscode.Uri;
	/** Filename under media/tab/{light,dark}/, e.g. settings.svg */
	icon?: string;
}

const editorPanels = new Map<string, vscode.WebviewPanel>();

interface EditorGate {
	attached: boolean;
	listening: boolean;
	attach: (panel: vscode.WebviewPanel) => void;
	disposables: vscode.Disposable[];
}

const editorGates = new WeakMap<vscode.WebviewPanel, EditorGate>();

export function engineStateLabel(state: EngineState): string {
	switch (state) {
		case 'starting':
			return 'Nexora engine is starting…';
		case 'restarting':
			return 'Nexora engine is restarting…';
		case 'failed':
			return 'Nexora engine failed to start.';
		case 'ready':
			return 'Nexora engine is ready.';
	}
}

export function enginePlaceholderHtml(state: EngineState): string {
	const nonce = Math.random().toString(36).slice(2);
	const failed = state === 'failed';
	const action = failed
		? `<p><button id="engine-output">Open Nexora Engine output</button></p>`
		: '';
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<style>
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: transparent;
			padding: 16px;
			margin: 0;
		}
		p { margin: 0 0 12px 0; }
		button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 6px 12px;
			cursor: pointer;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
	</style>
</head>
<body>
	<p>${engineStateLabel(state)}</p>
	${action}
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const button = document.getElementById('engine-output');
		if (button) {
			button.addEventListener('click', () => vscode.postMessage({ type: 'showEngineOutput' }));
		}
	</script>
</body>
</html>`;
}

/**
 * Singleton editor tab. A second open reveals the existing panel instead of creating another.
 */
export function acquireEditorPanel(options: AcquireEditorPanelOptions): vscode.WebviewPanel {
	const existing = editorPanels.get(options.viewType);
	if (existing) {
		applyEditorIcon(existing, options);
		existing.reveal(vscode.ViewColumn.Active);
		return existing;
	}

	const panel = vscode.window.createWebviewPanel(
		options.viewType,
		options.title,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [options.extensionUri]
		}
	);
	applyEditorIcon(panel, options);

	editorPanels.set(options.viewType, panel);
	panel.onDidDispose(() => {
		if (editorPanels.get(options.viewType) === panel) {
			editorPanels.delete(options.viewType);
		}
	});

	return panel;
}

function applyEditorIcon(panel: vscode.WebviewPanel, options: AcquireEditorPanelOptions): void {
	if (!options.icon) {
		return;
	}
	panel.iconPath = {
		light: vscode.Uri.joinPath(options.extensionUri, 'media', 'tab', 'light', options.icon),
		dark: vscode.Uri.joinPath(options.extensionUri, 'media', 'tab', 'dark', options.icon)
	};
}

/**
 * If the engine is not ready, show the same placeholder as EngineGatedWebviewProvider.
 * When the engine becomes ready, `attach` runs once so the page can set real HTML.
 */
export function gateEditorPanel(
	panel: vscode.WebviewPanel,
	attach: (panel: vscode.WebviewPanel) => void
): void {
	let gate = editorGates.get(panel);
	if (!gate) {
		gate = {
			attached: false,
			listening: false,
			attach,
			disposables: []
		};
		editorGates.set(panel, gate);
		gate.disposables.push(
			panel.webview.onDidReceiveMessage((data: { type?: string }) => {
				if (data?.type === 'showEngineOutput') {
					showEngineOutput();
				}
			}),
			panel.onDidDispose(() => {
				for (const disposable of gate!.disposables) {
					disposable.dispose();
				}
				gate!.disposables = [];
			})
		);
	} else {
		gate.attach = attach;
	}

	if (tryAttach(panel, gate)) {
		return;
	}

	renderPlaceholder(panel, getEngineState());

	if (!gate.listening) {
		gate.listening = true;
		gate.disposables.push(
			onDidChangeEngineState((state) => {
				if (tryAttach(panel, gate!)) {
					return;
				}
				if (!gate!.attached) {
					renderPlaceholder(panel, state);
				}
			})
		);
	}
}

function tryAttach(panel: vscode.WebviewPanel, gate: EditorGate): boolean {
	if (gate.attached) {
		return true;
	}
	if (getEngineState() !== 'ready') {
		return false;
	}
	gate.attached = true;
	gate.attach(panel);
	return true;
}

function renderPlaceholder(panel: vscode.WebviewPanel, state: EngineState): void {
	panel.webview.html = enginePlaceholderHtml(state);
}
