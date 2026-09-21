/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright-core';

const MAX_TEXT = 8 * 1024;
const MAX_LINKS = 15;
const CAPTCHA_WAIT_MS = 90_000;
const CAPTCHA_POLL_MS = 2000;

export type BrowserLink = { text: string; href: string };

export type BrowserSnapshot = {
	url: string;
	title: string;
	text: string;
	links: BrowserLink[];
	truncated: boolean;
	blocked?: boolean;
	reason?: string;
};

export type ScreencastPayload = { jpeg: string; url: string; width: number; height: number };

const CONSENT_NAME = /^(Accept all|I agree|Accept)$/i;

let context: BrowserContext | undefined;
let page: Page | undefined;
let screencast: CDPSession | undefined;
let screencastPage: Page | undefined;
let frameSize = { width: 1280, height: 800 };
let frameListener: ((p: ScreencastPayload) => void) | undefined;
let statusListener: ((text: string) => void) | undefined;
let captchaWait: Promise<BrowserSnapshot> | undefined;

export function setScreencastListener(fn: (p: ScreencastPayload) => void): void {
	frameListener = fn;
}

export function setBrowserStatusListener(fn: (text: string) => void): void {
	statusListener = fn;
}

export function agentPageUrl(): string {
	return page && !page.isClosed() ? page.url() : '';
}

function profileDir(): string {
	if (process.platform === 'win32') {
		return path.join(os.homedir(), 'AppData', 'Roaming', 'Nexora', 'browser-profile');
	}
	if (process.platform === 'darwin') {
		return path.join(os.homedir(), 'Library', 'Application Support', 'Nexora', 'browser-profile');
	}
	return path.join(os.homedir(), '.config', 'Nexora', 'browser-profile');
}

function configuredChromePath(): string {
	return String(vscode.workspace.getConfiguration('nexora').get<string>('browser.chromePath', '') || '').trim();
}

function findChromeOnDisk(): string | undefined {
	const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
	const candidates = process.platform === 'win32'
		? [
			'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
			'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
			path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe')
		]
		: process.platform === 'darwin'
			? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
			: ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
	return candidates.find(p => p && fs.existsSync(p));
}

async function launchPersistent(): Promise<BrowserContext> {
	const userDataDir = profileDir();
	fs.mkdirSync(userDataDir, { recursive: true });
	const opts = { headless: true, viewport: { width: 1280, height: 800 } };
	const configured = configuredChromePath();
	if (configured) {
		if (!fs.existsSync(configured)) {
			throw new Error(`Chrome not found at nexora.browser.chromePath (${configured}). Install Google Chrome or set a valid path.`);
		}
		return chromium.launchPersistentContext(userDataDir, { ...opts, executablePath: configured });
	}
	const found = findChromeOnDisk();
	if (found) {
		return chromium.launchPersistentContext(userDataDir, { ...opts, executablePath: found });
	}
	try {
		return await chromium.launchPersistentContext(userDataDir, { ...opts, channel: 'chrome' });
	} catch {
		throw new Error('Chrome not found. Install Google Chrome or set nexora.browser.chromePath.');
	}
}

export async function stopScreencast(): Promise<void> {
	const session = screencast;
	screencast = undefined;
	screencastPage = undefined;
	if (session) {
		await session.send('Page.stopScreencast').catch(() => undefined);
		await session.detach().catch(() => undefined);
	}
}

export async function resumeScreencast(): Promise<void> {
	if (page && !page.isClosed()) {
		await startScreencast(page);
	}
}

async function startScreencast(target: Page): Promise<void> {
	if (screencast && screencastPage === target) {
		return;
	}
	await stopScreencast();
	screencast = await target.context().newCDPSession(target);
	screencastPage = target;
	await screencast.send('Page.startScreencast', {
		format: 'jpeg',
		quality: 55,
		maxWidth: 1280,
		maxHeight: 800
	});
	screencast.on('Page.screencastFrame', async (event: { data: string; sessionId: number; metadata?: { deviceWidth?: number; deviceHeight?: number } }) => {
		const session = screencast;
		if (!session) {
			return;
		}
		await session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
		const width = event.metadata?.deviceWidth || frameSize.width;
		const height = event.metadata?.deviceHeight || frameSize.height;
		frameSize = { width, height };
		frameListener?.({ jpeg: event.data, url: target.url(), width, height });
	});
}

async function ensurePage(): Promise<Page> {
	if (page && !page.isClosed() && context) {
		await startScreencast(page);
		return page;
	}
	await closeAgentBrowser();
	context = await launchPersistent();
	context.on('close', () => {
		context = undefined;
		page = undefined;
	});
	page = context.pages()[0] || await context.newPage();
	await page.setViewportSize({ width: 1280, height: 800 }).catch(() => undefined);
	await startScreencast(page);
	return page;
}

function requirePage(): Page {
	if (!page || page.isClosed()) {
		throw new Error('No open page. Call open_browser first.');
	}
	return page;
}

async function waitSettled(target: Page): Promise<void> {
	await target.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined);
	await target.waitForSelector('a[href], h1, h3, input, button', { timeout: 10000 }).catch(() => undefined);
}

async function dismissConsentOnce(target: Page): Promise<void> {
	const tryClick = async (): Promise<boolean> => {
		for (const root of target.frames()) {
			const loc = root.getByRole('button', { name: CONSENT_NAME }).first();
			if (await loc.isVisible().catch(() => false)) {
				await loc.click({ timeout: 4000 }).catch(() => undefined);
				return true;
			}
		}
		return false;
	};
	if (await tryClick()) {
		await waitSettled(target);
		return;
	}
	if (await target.locator('iframe').count()) {
		await new Promise(resolve => setTimeout(resolve, 500));
		if (await tryClick()) {
			await waitSettled(target);
		}
	}
}

function looksBlocked(snap: BrowserSnapshot): boolean {
	const blob = `${snap.title}\n${snap.text}`.toLowerCase();
	if (/captcha|recaptcha|unusual traffic|i.?m not a robot/.test(blob)) {
		return true;
	}
	if (/before you continue/.test(blob)) {
		return true;
	}
	return /accept all/.test(blob) && /reject all/.test(blob) && snap.links.length < 6;
}

export async function takeSnapshot(target: Page): Promise<BrowserSnapshot> {
	const url = target.url();
	const title = await target.title();
	const extracted = await target.evaluate((maxLinks: number) => {
		const doc = (globalThis as unknown as {
			document?: {
				body?: { innerText?: string };
				querySelectorAll(selector: string): ArrayLike<{
					href?: string;
					innerText?: string;
					getBoundingClientRect(): { width: number; height: number };
				}>;
			};
		}).document;
		const text = String(doc && doc.body ? doc.body.innerText : '').replace(/[ \t]+\n/g, '\n').trim();
		const links: { text: string; href: string }[] = [];
		const seen: Record<string, boolean> = {};
		const nodes = doc ? Array.from(doc.querySelectorAll('a[href]')) : [];
		for (let i = 0; i < nodes.length && links.length < maxLinks; i++) {
			const a = nodes[i];
			const href = String(a.href || '').trim();
			const label = String(a.innerText || '').replace(/\s+/g, ' ').trim();
			if (!href || href.indexOf('javascript:') === 0 || seen[href] || !label) {
				continue;
			}
			const r = a.getBoundingClientRect();
			if (r.width < 2 || r.height < 2) {
				continue;
			}
			seen[href] = true;
			links.push({ text: label.slice(0, 200), href });
		}
		return { text, links };
	}, MAX_LINKS);

	let text = extracted.text;
	const truncated = text.length > MAX_TEXT;
	if (truncated) {
		text = text.slice(0, MAX_TEXT);
	}
	const snap: BrowserSnapshot = { url, title, text, links: extracted.links, truncated };
	if (looksBlocked(snap)) {
		snap.blocked = true;
		snap.reason = 'consent or captcha';
	}
	return snap;
}

async function waitIfBlocked(snap: BrowserSnapshot): Promise<BrowserSnapshot> {
	if (!snap.blocked) {
		return snap;
	}
	if (captchaWait) {
		return captchaWait;
	}
	captchaWait = (async () => {
		const message = 'Complete the challenge in Nexora Browser';
		statusListener?.(message);
		void vscode.window.showInformationMessage(message);
		let current = snap;
		const deadline = Date.now() + CAPTCHA_WAIT_MS;
		try {
			while (Date.now() < deadline) {
				await new Promise(resolve => setTimeout(resolve, CAPTCHA_POLL_MS));
				const target = page;
				if (!target || target.isClosed()) {
					return current;
				}
				current = await takeSnapshot(target);
				if (!current.blocked) {
					statusListener?.('');
					return current;
				}
			}
			return current;
		} finally {
			captchaWait = undefined;
		}
	})();
	return captchaWait;
}

export async function gotoAgentPage(url: string): Promise<void> {
	const target = await ensurePage();
	await target.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await waitSettled(target);
}

export async function navigateAgentPage(url: string): Promise<BrowserSnapshot> {
	await gotoAgentPage(url);
	const target = requirePage();
	await dismissConsentOnce(target);
	return waitIfBlocked(await takeSnapshot(target));
}

export async function snapshotAgentPage(): Promise<BrowserSnapshot> {
	const target = requirePage();
	await waitSettled(target);
	return waitIfBlocked(await takeSnapshot(target));
}

function locate(target: Page, selector?: string, text?: string) {
	const sel = String(selector || '').trim();
	const txt = String(text || '').trim();
	if (sel) {
		return target.locator(sel).first();
	}
	if (txt) {
		return target.getByText(txt, { exact: false }).first();
	}
	return undefined;
}

export async function clickAgentPage(selector?: string, text?: string): Promise<BrowserSnapshot> {
	const target = requirePage();
	const loc = locate(target, selector, text);
	if (!loc) {
		throw new Error('Provide selector or text to click');
	}
	await loc.click({ timeout: 10000 });
	await waitSettled(target);
	return waitIfBlocked(await takeSnapshot(target));
}

export async function typeAgentPage(text: string, selector?: string, submit?: boolean): Promise<BrowserSnapshot> {
	const target = requirePage();
	const loc = locate(target, selector) || target.locator('input:visible, textarea:visible, [contenteditable="true"]').first();
	await loc.fill(text, { timeout: 10000 });
	if (submit) {
		await loc.press('Enter');
		await waitSettled(target);
	}
	return waitIfBlocked(await takeSnapshot(target));
}

export async function clickPageNorm(nx: number, ny: number): Promise<void> {
	const target = requirePage();
	const x = Math.min(Math.max(nx, 0), 1) * frameSize.width;
	const y = Math.min(Math.max(ny, 0), 1) * frameSize.height;
	await target.mouse.click(x, y);
}

export async function wheelPage(dx: number, dy: number): Promise<void> {
	const target = requirePage();
	await target.mouse.wheel(dx, dy);
}

export async function closeAgentBrowser(): Promise<void> {
	const current = context;
	context = undefined;
	page = undefined;
	await stopScreencast();
	if (current) {
		await current.close().catch(() => undefined);
	}
}
