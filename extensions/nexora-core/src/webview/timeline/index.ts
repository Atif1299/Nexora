/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { renderWebviewPage } from '../shared/html';

export function getTimelineWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	return renderWebviewPage({
		webview,
		extensionUri,
		folder: 'timeline',
		// This panel writes style attributes from script (bar widths).
		allowInlineStyles: true,
		title: 'Nexora Timeline',
		styles: ['timeline.css'],
		scripts: ['timeline.js'],
		body: /* html */ `	<div id="timeline-root" role="main" aria-label="Nexora Timeline">
		<div class="nx-section-head">
			<h1>Memory Timeline</h1>
			<button type="button" class="nx-btn nx-btn-secondary" id="refreshBtn" aria-label="Refresh timeline">Refresh</button>
		</div>
		<p class="nx-hint">Read-only snapshots. Click a node for detail and a diff against the current snapshot.</p>

		<div id="offline-banner" class="nx-banner" role="alert" hidden></div>

		<div class="nx-layout">
			<section class="nx-section" aria-labelledby="rail-heading">
				<h2 id="rail-heading">Snapshots</h2>
				<div id="timeline-rail" class="nx-rail"></div>
			</section>
			<section class="nx-section" aria-labelledby="detail-heading">
				<h2 id="detail-heading">Detail</h2>
				<div id="timeline-detail" class="nx-detail"></div>
			</section>
		</div>

		<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>
	</div>`
	});
}
