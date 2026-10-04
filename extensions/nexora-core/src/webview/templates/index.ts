/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { renderWebviewPage } from '../shared/html';

export function getTemplatesWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	return renderWebviewPage({
		webview,
		extensionUri,
		folder: 'templates',
		title: 'Nexora Templates',
		styles: ['templates.css'],
		scripts: ['templates.js'],
		body: /* html */ `	<div id="templates-root" role="main" aria-label="Nexora Templates">
		<div class="nx-section-head">
			<h1>Workflow Templates</h1>
			<div class="nx-head-actions">
				<button type="button" class="nx-btn nx-btn-secondary" id="importBtn" aria-label="Import template">Import</button>
				<button type="button" class="nx-btn nx-btn-secondary" id="refreshBtn" aria-label="Refresh templates">Refresh</button>
			</div>
		</div>
		<p class="nx-hint">Built-in templates plus any you save or import. Instantiating opens the existing plan approval card in Chat.</p>

		<div id="offline-banner" class="nx-banner" role="alert" hidden></div>
		<div id="import-preview" class="nx-preview" hidden></div>

		<section class="nx-section" aria-labelledby="builtin-heading">
			<h2 id="builtin-heading">Built-in</h2>
			<div id="builtin-list" class="nx-list"></div>
		</section>

		<section class="nx-section" aria-labelledby="user-heading">
			<h2 id="user-heading">Your templates</h2>
			<div id="user-list" class="nx-list"></div>
		</section>

		<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>
	</div>`
	});
}
