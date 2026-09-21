/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getBrowserUiSettings, openNexoraBrowser, parseHttpUrl } from '../browser';
import type { ToolResult } from './executor';
import {
	clickAgentPage,
	navigateAgentPage,
	snapshotAgentPage,
	typeAgentPage,
	type BrowserSnapshot
} from './browserSession';

function denied(): ToolResult | undefined {
	if (getBrowserUiSettings().allowAgentControl) {
		return undefined;
	}
	return {
		success: false,
		error: 'Denied: Browser protection is on (nexora.browser.allowAgentControl is false).'
	};
}

function fail(err: unknown): ToolResult {
	return {
		success: false,
		error: err instanceof Error ? err.message : String(err)
	};
}

function okSnapshot(snap: BrowserSnapshot): ToolResult {
	return {
		success: true,
		data: snap,
		truncated: snap.truncated
	};
}

function parseToolUrl(url: string): URL | undefined {
	const raw = String(url || '').trim();
	return parseHttpUrl(raw) ?? parseHttpUrl('https://' + raw);
}

/**
 * Open the URL on the shared Playwright page, reveal Nexora Browser, return a snapshot.
 */
export async function openBrowserTool(url: string): Promise<ToolResult> {
	const blocked = denied();
	if (blocked) {
		return blocked;
	}

	const parsed = parseToolUrl(url);
	if (!parsed) {
		return {
			success: false,
			error: 'url must be an http or https URL'
		};
	}

	try {
		await openNexoraBrowser();
		return okSnapshot(await navigateAgentPage(parsed.toString()));
	} catch (err) {
		return fail(err);
	}
}

export async function browserSnapshotTool(): Promise<ToolResult> {
	const blocked = denied();
	if (blocked) {
		return blocked;
	}
	try {
		return okSnapshot(await snapshotAgentPage());
	} catch (err) {
		return fail(err);
	}
}

export async function browserClickTool(selector?: string, text?: string): Promise<ToolResult> {
	const blocked = denied();
	if (blocked) {
		return blocked;
	}
	if (!String(selector || '').trim() && !String(text || '').trim()) {
		return { success: false, error: 'Provide selector or text to click' };
	}
	try {
		return okSnapshot(await clickAgentPage(selector, text));
	} catch (err) {
		return fail(err);
	}
}

export async function browserTypeTool(text: string, selector?: string, submit?: boolean): Promise<ToolResult> {
	const blocked = denied();
	if (blocked) {
		return blocked;
	}
	if (!String(text ?? '')) {
		return { success: false, error: 'text is required' };
	}
	try {
		return okSnapshot(await typeAgentPage(String(text), selector, submit === true));
	} catch (err) {
		return fail(err);
	}
}
