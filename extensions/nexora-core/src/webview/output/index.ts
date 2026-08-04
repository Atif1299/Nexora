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

export function getOutputWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	const nonce = getNonce();

	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'output', 'output.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'output', 'output.js'));

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
	<title>Task Output</title>
</head>
<body>
	<div id="output-root">
		<div class="out-sidebar" id="task-list">
			<div class="out-empty">No tasks executed yet</div>
		</div>
		<div class="out-detail" id="output-detail">
			<div class="out-empty">Select a task to view output</div>
		</div>
	</div>

	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
