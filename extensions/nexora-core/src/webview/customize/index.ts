/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { renderWebviewPage } from '../shared/html';

export function getCustomizeWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	return renderWebviewPage({
		webview,
		extensionUri,
		folder: 'customize',
		title: 'Nexora Customize',
		styles: ['customize.css'],
		scripts: ['model.js', 'pages.js', 'orchestration.js', 'customize.js'],
		body: /* html */ `	<div class="cz-root" role="main" aria-label="Nexora Customize">
		<div class="cz-top">
			<label class="cz-searchBox"><i class="codicon codicon-search" aria-hidden="true"></i>
				<input id="cz-search" type="search" placeholder="Search plugins, skills, agents, MCP servers" aria-label="Search Customize" autocomplete="off" spellcheck="false"></label>
			<button type="button" class="nx-btn" data-reveal="plugins:marketplace"><i class="codicon codicon-extensions" aria-hidden="true"></i> Browse marketplace</button>
		</div>
		<div class="cz-chips" id="cz-chips" role="toolbar" aria-label="Show"></div>
		<section class="cz-main" id="cz-main" aria-live="polite">
			<div class="nx-hint">Loading...</div>
		</section>
	</div>
	<div class="cz-dialog" id="cz-dialog" role="dialog" aria-modal="true" hidden></div>`
	});
}
