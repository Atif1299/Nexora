/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(src, dest) {
	ensureDir(path.dirname(dest));
	fs.copyFileSync(src, dest);
}

function copyWebviewFolder(root, folderName, assets) {
	const srcDir = path.join(root, 'src', 'webview', folderName);
	const outDir = path.join(root, 'out', 'webview', folderName);

	for (const file of assets) {
		const src = path.join(srcDir, file);
		const dest = path.join(outDir, file);
		if (!fs.existsSync(src)) {
			console.warn(`[copyWebviewAssets] Warning: Missing asset ${src}`);
			continue;
		}
		copyFile(src, dest);
	}

	console.log(`[copyWebviewAssets] copied ${folderName} assets`);
}

function main() {
	const root = path.resolve(__dirname, '..');

	// Chat panel assets
	copyWebviewFolder(root, 'chat', ['chat.css', 'chat.js']);

	// Week 11: Workflow panel assets
	copyWebviewFolder(root, 'workflow', ['workflow.css', 'workflow.js']);

	// Week 11: Output panel assets
	copyWebviewFolder(root, 'output', ['output.css', 'output.js']);

	// Week 12: Settings panel assets
	copyWebviewFolder(root, 'settings', ['settings.css', 'settings.js']);

	// Week 15: Analytics panel assets
	copyWebviewFolder(root, 'analytics', ['analytics.css', 'analytics.js']);

	// Week 16: Templates + Timeline panel assets
	copyWebviewFolder(root, 'templates', ['templates.css', 'templates.js']);
	copyWebviewFolder(root, 'timeline', ['timeline.css', 'timeline.js']);
}

main();

