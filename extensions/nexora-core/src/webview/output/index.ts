/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { renderWebviewPage } from '../shared/html';

export function getOutputWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	return renderWebviewPage({
		webview,
		extensionUri,
		folder: 'output',
		title: 'Task Output',
		styles: ['output.css'],
		scripts: ['output.js'],
		body: /* html */ `	<div id="output-root">
		<div class="out-sidebar" id="task-list">
			<div class="out-empty">No tasks executed yet</div>
		</div>
		<div class="out-detail" id="output-detail">
			<div class="out-empty">Select a task to view output</div>
		</div>
	</div>`
	});
}
