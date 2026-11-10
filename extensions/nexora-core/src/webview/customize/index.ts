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
		scripts: ['model.js', 'pages.js', 'customize.js'],
		body: /* html */ `	<div class="cz-root" role="main" aria-label="Nexora Customize">
		<nav class="cz-nav" id="cz-nav" aria-label="Customize sections"></nav>
		<section class="cz-main" id="cz-main" aria-live="polite">
			<div class="nx-hint">Loading...</div>
		</section>
	</div>
	<div class="cz-dialog" id="cz-dialog" role="dialog" aria-modal="true" hidden></div>`
	});
}
