/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export function getWorkflowWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	const nonce = getNonce();

	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'workflow', 'workflow.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'workflow', 'workflow.js'));

	const csp = [
		`default-src 'none'`,
		`img-src ${webview.cspSource} https: data:`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
	].join('; ');

	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<link rel="stylesheet" href="${cssUri}">
	<title>Workflow Viewer</title>
</head>
<body>
	<div id="workflow-root">
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
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
