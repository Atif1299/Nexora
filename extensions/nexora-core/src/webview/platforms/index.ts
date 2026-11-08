/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { renderWebviewPage } from '../shared/html';

export function getPlatformsWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri
): string {
	return renderWebviewPage({
		webview,
		extensionUri,
		folder: 'platforms',
		title: 'Nexora Platforms',
		styles: ['platforms.css'],
		scripts: ['platforms.js'],
		body: /* html */ `	<div id="platforms-root" role="main" aria-label="Nexora Platforms">
		<div class="nx-section-head">
			<h1>Platforms</h1>
			<button type="button" class="nx-icon-btn" id="refreshBtn" title="Refresh" aria-label="Refresh platforms">
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v2.5h-2.5"/></svg>
			</button>
		</div>
		<p class="nx-hint">Connect the services your agents build and deploy with. Catalogue entries are for discovery only.</p>
		<div class="nx-tools">
			<div class="nx-search">
				<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>
				<input id="platform-search" type="search" placeholder="Filter platforms" aria-label="Filter platforms" spellcheck="false" autocomplete="off">
			</div>
			<div class="nx-seg" role="group" aria-label="Show">
				<button type="button" data-filter="all" aria-pressed="true">All <span class="nx-seg-count"></span></button>
				<button type="button" data-filter="connected" aria-pressed="false">Connected <span class="nx-seg-count"></span></button>
				<button type="button" data-filter="live" aria-pressed="false">Available <span class="nx-seg-count"></span></button>
			</div>
		</div>

		<div id="offline-banner" class="nx-banner" role="alert" hidden></div>
		<div id="embedding-banner" class="nx-banner nx-banner-info" role="status" hidden></div>
		<div id="loading" class="nx-empty" hidden>Loading platforms...</div>
		<div id="platform-list" class="nx-groups"></div>
		<div id="platform-detail" class="nx-detail" hidden></div>

		<div id="sr-live" class="sr-only" role="status" aria-live="polite"></div>
	</div>`
	});
}
