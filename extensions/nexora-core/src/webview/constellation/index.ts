/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { renderWebviewPage } from '../shared/html';

export function getConstellationWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	repoLabel: string
): string {
	const label = repoLabel.replace(/[<>&"]/g, '');
	return renderWebviewPage({
		webview,
		extensionUri,
		folder: 'constellation',
		title: 'Nexora Constellation',
		styles: ['constellation.css'],
		scripts: ['constellation.js'],
		// The legend paints each group's colour from the theme, so the script sets style properties.
		allowInlineStyles: true,
		body: /* html */ `	<div class="cn-root" role="main" aria-label="Nexora Constellation">
		<header class="cn-top">
			<div class="cn-title">
				<i class="codicon codicon-circuit-board" aria-hidden="true"></i>
				<span class="cn-repo" title="${label}">${label}</span>
			</div>
			<span class="cn-chip" id="cn-counts">reading the workspace&hellip;</span>
			<span class="cn-chip cn-chip-live" id="cn-live" hidden><i class="cn-dot" aria-hidden="true"></i><span class="cn-liveText"></span></span>
			<span class="cn-chip cn-chip-blast" id="cn-blast" hidden></span>
			<span class="cn-spacer"></span>
			<span class="cn-chip cn-chip-spend" id="cn-spend" hidden></span>
			<button type="button" class="nx-btn" id="cn-refresh" title="Read the workspace again">
				<i class="codicon codicon-refresh" aria-hidden="true"></i> Refresh
			</button>
		</header>
		<div class="cn-stage">
			<div class="cn-canvasWrap">
				<canvas id="cn-canvas" class="cn-canvas" aria-label="The workspace as a graph. Files and folders are nodes; the files each running step changes are lit."></canvas>
				<div class="cn-overlay" id="cn-overlay">Reading the workspace&hellip;</div>
				<div class="cn-hint">click a node &middot; double-click to open</div>
				<div class="cn-legend" id="cn-legend"></div>
			</div>
			<aside class="cn-side" aria-label="Details">
				<div>
					<span class="cn-k">Selected</span>
					<div class="cn-selName" id="cn-selName">Nothing selected</div>
				</div>
				<div id="cn-selBody" class="cn-empty">Click a node to see what it is, what imports it, and which step is touching it.</div>
			</aside>
		</div>
		<div class="cn-rail" id="cn-rail" role="toolbar" aria-label="Plan steps"></div>
	</div>`
	});
}
