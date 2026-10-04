/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The document shell every Nexora webview is served in.
 *
 * Each panel used to carry its own copy of the nonce generator, the content
 * security policy, and the `<!DOCTYPE>` boilerplate. Seven copies of a
 * security header is seven chances for one of them to quietly drift, and the
 * drift is invisible until something is already wrong. They share this one
 * now, and a panel supplies only what is genuinely its own: its assets, its
 * title and its body.
 */

import * as vscode from 'vscode';

export interface WebviewPageOptions {
	webview: vscode.Webview;
	extensionUri: vscode.Uri;
	/** Folder under `out/webview` holding this panel's built assets. */
	folder: string;
	/** Document title. Shown by screen readers, not in the panel chrome. */
	title: string;
	/** Stylesheet filenames within the panel's folder, in load order. */
	styles: string[];
	/** Script filenames within the panel's folder, in load order. */
	scripts: string[];
	/** Markup placed inside `<body>`. */
	body: string;
	/**
	 * Allow `style="..."` attributes by adding `'unsafe-inline'` to style-src.
	 *
	 * Only for panels whose script sets style properties, such as a meter
	 * width that is a computed number. It is off by default because a panel
	 * that does not need it should not have it: this is the directive that
	 * stops injected markup from restyling the page.
	 */
	allowInlineStyles?: boolean;
	/** Extra attributes for the `<body>` tag. The caller escapes these. */
	bodyAttributes?: string;
	/**
	 * Serialized to `window.__NEXORA_INITIAL_STATE__` before the panel's own
	 * scripts run, so a panel renders its first frame from real state instead
	 * of a placeholder it has to correct a moment later.
	 */
	initialState?: unknown;
}

/**
 * Loaded into every panel, in this order, before its own stylesheet.
 *
 * `tokens.css` holds the colour and spacing variables the panels reference;
 * a panel that does not get it renders with every `var(--nx-*)` undefined,
 * which looks like a broken page rather than a missing file.
 */
const SHARED_STYLESHEETS = ['tokens.css', 'base.css', 'components.css'];

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/**
 * JSON safe to embed in a `<script>` element.
 *
 * A string in the state containing `</script>` would otherwise close the
 * element early and the rest would be parsed as markup. Escaping `<` as a
 * unicode escape keeps the value identical to the parser that matters, the
 * JSON one, while making it inert to the HTML one.
 */
function embeddableJson(value: unknown): string {
	return JSON.stringify(value ?? null)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}

/** Build the full HTML document for one panel. */
export function renderWebviewPage(options: WebviewPageOptions): string {
	const { webview, extensionUri, folder } = options;
	const nonce = getNonce();

	const assetUri = (file: string): vscode.Uri =>
		webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', folder, file));

	const csp = [
		`default-src 'none'`,
		`img-src ${webview.cspSource} https: data:`,
		`style-src ${webview.cspSource}${options.allowInlineStyles ? ` 'unsafe-inline'` : ''}`,
		`script-src 'nonce-${nonce}'`
	].join('; ');

	// Shared sheets first, so a panel's own file overrides them rather than
	// fighting load order. Panels list only what is theirs; these are implied.
	const sharedUri = (file: string): vscode.Uri =>
		webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'shared', file));

	const styleTags = [
		...SHARED_STYLESHEETS.map((file) => `	<link rel="stylesheet" href="${sharedUri(file)}">`),
		...options.styles.map((file) => `	<link rel="stylesheet" href="${assetUri(file)}">`)
	].join('\n');

	// State first, so the panel's own scripts can read it as they initialize.
	const stateTag = options.initialState === undefined
		? ''
		: `	<script nonce="${nonce}">\n`
		+ `		window.__NEXORA_INITIAL_STATE__ = ${embeddableJson(options.initialState)};\n`
		+ `	</script>\n`;

	const scriptTags = options.scripts
		.map((file) => `	<script nonce="${nonce}" src="${assetUri(file)}"></script>`)
		.join('\n');

	const bodyAttributes = options.bodyAttributes ? ` ${options.bodyAttributes}` : '';

	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<title>${options.title}</title>
${styleTags}
</head>
<body${bodyAttributes}>
${options.body}
${stateTag}${scriptTags}
</body>
</html>`;
}
