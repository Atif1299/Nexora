/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { renderWebviewPage } from '../shared/html';

export function getWorkflowWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	return renderWebviewPage({
		webview,
		extensionUri,
		folder: 'workflow',
		title: 'Workflow Viewer',
		styles: ['workflow.css'],
		scripts: ['workflow.js'],
		body: /* html */ `	<div id="workflow-root">
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
	</div>`
	});
}
