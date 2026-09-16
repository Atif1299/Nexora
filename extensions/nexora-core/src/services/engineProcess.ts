/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, execFile, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

const DEV_BACKEND_DIR = 'D:\\Semesters\\Nexora\\Nexora-IDE-Backend-Architecture\\backend';
const DEV_PYTHON = path.join(DEV_BACKEND_DIR, '.venv', 'Scripts', 'python.exe');

const SECRET_ENCRYPTION_KEY = 'nexora.engine.TOKEN_ENCRYPTION_KEY';
const SECRET_LOCAL_TOKEN = 'nexora.engine.NEXORA_LOCAL_TOKEN';

const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 500;
const RESTART_BACKOFF_MIN_MS = 1_000;
const RESTART_BACKOFF_MAX_MS = 30_000;

export interface EngineStartResult {
	baseUrl: string;
	port: number;
	localToken: string;
	ready: boolean;
	reused: boolean;
}

export type EngineState = 'starting' | 'ready' | 'restarting' | 'failed';

const HEADER_LOCAL_TOKEN = 'X-Nexora-Local-Token';

let output: vscode.OutputChannel | undefined;
let supervisor: EngineSupervisor | undefined;
let lastResult: EngineStartResult | undefined;
let engineState: EngineState = 'starting';
const engineStateEmitter = new vscode.EventEmitter<EngineState>();

export const onDidChangeEngineState = engineStateEmitter.event;

export function getEngineState(): EngineState {
	return engineState;
}

export function showEngineOutput(): void {
	channel().show(true);
}

function setEngineState(next: EngineState): void {
	if (engineState === next) {
		return;
	}
	engineState = next;
	log(`Engine state: ${next}`);
	engineStateEmitter.fire(next);
}

function channel(): vscode.OutputChannel {
	if (!output) {
		output = vscode.window.createOutputChannel('Nexora Engine');
	}
	return output;
}

function log(line: string): void {
	channel().appendLine(line);
}

function resolveNexoraHome(): string {
	const fromEnv = (process.env.NEXORA_HOME || '').trim();
	if (fromEnv) {
		return fromEnv;
	}
	if (process.platform === 'win32') {
		const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
		return path.join(appdata, 'Nexora');
	}
	return path.join(os.homedir(), '.nexora');
}

function pythonName(): string {
	return process.platform === 'win32' ? 'python.exe' : 'python';
}

function engineExeName(): string {
	return process.platform === 'win32' ? 'nexora-engine.exe' : 'nexora-engine';
}

function bundleSearchRoots(): string[] {
	return [
		path.dirname(process.execPath),
		vscode.env.appRoot,
		path.dirname(vscode.env.appRoot)
	];
}

function findFirstExisting(relatives: string[]): string | undefined {
	for (const root of bundleSearchRoots()) {
		for (const rel of relatives) {
			const candidate = path.join(root, rel);
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

function findBundledEngine(): string | undefined {
	const name = engineExeName();
	return findFirstExisting([
		path.join('engine', name),
		path.join('resources', 'engine', name)
	]);
}

function findBundledPython(): string | undefined {
	const name = pythonName();
	return findFirstExisting([
		path.join('engine', name),
		path.join('engine', 'python', name),
		path.join('engine', 'Scripts', name),
		path.join('resources', 'engine', name)
	]);
}

function isFrozenEngine(exePath: string): boolean {
	const base = path.basename(exePath).toLowerCase();
	return base === 'nexora-engine.exe' || base === 'nexora-engine';
}

interface EngineExecutable {
	path: string;
	frozen: boolean;
}

function resolveEngineExecutable(): EngineExecutable | undefined {
	const configured = vscode.workspace.getConfiguration('nexora').get<string>('engine.pythonPath')?.trim();
	if (configured && fs.existsSync(configured)) {
		return { path: configured, frozen: isFrozenEngine(configured) };
	}
	const bundledEngine = findBundledEngine();
	if (bundledEngine) {
		return { path: bundledEngine, frozen: true };
	}
	const bundledPython = findBundledPython();
	if (bundledPython) {
		return { path: bundledPython, frozen: isFrozenEngine(bundledPython) };
	}
	if (fs.existsSync(DEV_PYTHON)) {
		return { path: DEV_PYTHON, frozen: false };
	}
	return undefined;
}

function resolveBackendDir(exePath: string, frozen: boolean): string {
	if (frozen) {
		return path.dirname(exePath);
	}
	const candidates = [
		DEV_BACKEND_DIR,
		path.resolve(path.dirname(exePath), '..', '..'),
		path.dirname(exePath),
		path.join(path.dirname(process.execPath), 'engine'),
		path.join(path.dirname(process.execPath), 'backend')
	];
	for (const dir of candidates) {
		if (fs.existsSync(path.join(dir, 'app', 'main.py'))) {
			return dir;
		}
	}
	return DEV_BACKEND_DIR;
}

function generateFernetKey(): string {
	return crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

function generateLocalToken(): string {
	return crypto.randomBytes(32).toString('hex');
}

async function loadOrCreateSecrets(context: vscode.ExtensionContext): Promise<{
	encryptionKey: string;
	localToken: string;
}> {
	let encryptionKey = await context.secrets.get(SECRET_ENCRYPTION_KEY);
	if (!encryptionKey) {
		encryptionKey = generateFernetKey();
		await context.secrets.store(SECRET_ENCRYPTION_KEY, encryptionKey);
	}
	let localToken = await context.secrets.get(SECRET_LOCAL_TOKEN);
	if (!localToken) {
		localToken = generateLocalToken();
		await context.secrets.store(SECRET_LOCAL_TOKEN, localToken);
	}
	return { encryptionKey, localToken };
}

function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.unref();
		server.once('error', () => resolve(false));
		server.listen(port, '127.0.0.1', () => {
			server.close(() => resolve(true));
		});
	});
}

function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			if (!addr || typeof addr === 'string') {
				server.close();
				reject(new Error('Could not allocate a free port'));
				return;
			}
			const port = addr.port;
			server.close(() => resolve(port));
		});
	});
}

async function probeHealth(baseUrl: string, localToken: string, timeoutMs: number = 2000): Promise<boolean> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${baseUrl}/api/health`, {
			method: 'GET',
			headers: { [HEADER_LOCAL_TOKEN]: localToken },
			signal: controller.signal
		});
		if (!response.ok) {
			return false;
		}
		const body = await response.json() as { status?: string };
		return body?.status === 'ok';
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitUntilEngineReady(timeoutMs: number): Promise<boolean> {
	if (engineState === 'ready') {
		return Promise.resolve(true);
	}
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			disposable.dispose();
			resolve(engineState === 'ready');
		}, timeoutMs);
		const disposable = engineStateEmitter.event((state) => {
			if (state === 'ready') {
				clearTimeout(timer);
				disposable.dispose();
				resolve(true);
			}
		});
	});
}

function parsePortFromUrl(url: string): number | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.port) {
			return parseInt(parsed.port, 10);
		}
		if (parsed.protocol === 'http:') {
			return 80;
		}
		if (parsed.protocol === 'https:') {
			return 443;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function stripTrailingSlash(url: string): string {
	return url.replace(/\/+$/, '');
}

async function killProcessTree(pid: number): Promise<void> {
	if (process.platform === 'win32') {
		try {
			await execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
		} catch {
			// Process already gone.
		}
		return;
	}
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			// Process already gone.
		}
	}
}

class EngineSupervisor {
	private child: ChildProcess | undefined;
	private stopping = false;
	private restartTimer: ReturnType<typeof setTimeout> | undefined;
	private backoffMs = RESTART_BACKOFF_MIN_MS;
	private pythonPath: string;
	private backendDir: string;
	private port: number;
	private baseUrl: string;
	private encryptionKey: string;
	private localToken: string;
	private nexoraHome: string;
	private frozen: boolean;
	private spawnedOnce = false;
	private healthWatchGeneration = 0;

	constructor(opts: {
		pythonPath: string;
		backendDir: string;
		port: number;
		baseUrl: string;
		encryptionKey: string;
		localToken: string;
		nexoraHome: string;
		frozen: boolean;
	}) {
		this.pythonPath = opts.pythonPath;
		this.backendDir = opts.backendDir;
		this.port = opts.port;
		this.baseUrl = opts.baseUrl;
		this.encryptionKey = opts.encryptionKey;
		this.localToken = opts.localToken;
		this.nexoraHome = opts.nexoraHome;
		this.frozen = opts.frozen;
	}

	get pid(): number | undefined {
		return this.child?.pid;
	}

	spawnOnce(): void {
		if (this.stopping || this.child) {
			return;
		}
		setEngineState(this.spawnedOnce ? 'restarting' : 'starting');
		const args = this.frozen
			? ['--host', '127.0.0.1', '--port', String(this.port)]
			: ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(this.port)];
		log(`Starting engine: ${this.pythonPath} ${args.join(' ')}`);
		log(`cwd: ${this.backendDir}`);
		log(`NEXORA_HOME: ${this.nexoraHome}`);

		const env: NodeJS.ProcessEnv = {
			...process.env,
			NEXORA_HOME: this.nexoraHome,
			TOKEN_ENCRYPTION_KEY: this.encryptionKey,
			NEXORA_LOCAL_TOKEN: this.localToken,
			PYTHONUNBUFFERED: '1',
			PYTHONIOENCODING: 'utf-8'
		};

		const child = spawn(
			this.pythonPath,
			args,
			{
				cwd: this.backendDir,
				env,
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true
			}
		);
		this.child = child;
		this.spawnedOnce = true;

		child.stdout?.on('data', (chunk: Buffer) => {
			channel().append(chunk.toString());
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			channel().append(chunk.toString());
		});
		child.on('error', (err) => {
			log(`Engine spawn error: ${err.message}`);
			if (!this.stopping) {
				setEngineState('failed');
			}
		});
		child.on('exit', (code, signal) => {
			this.child = undefined;
			this.healthWatchGeneration += 1;
			log(`Engine exited (code=${code ?? 'none'} signal=${signal ?? 'none'})`);
			if (!this.stopping) {
				this.scheduleRestart();
			}
		});
		this.beginHealthWatch();
	}

	private beginHealthWatch(): void {
		const gen = ++this.healthWatchGeneration;
		void this.runHealthWatch(gen);
	}

	private async runHealthWatch(gen: number): Promise<void> {
		const started = Date.now();
		let markedFailed = false;
		while (!this.stopping && gen === this.healthWatchGeneration) {
			if (await probeHealth(this.baseUrl, this.localToken, 2000)) {
				this.resetBackoff();
				setEngineState('ready');
				return;
			}
			if (!markedFailed && Date.now() - started >= HEALTH_TIMEOUT_MS) {
				markedFailed = true;
				if (engineState !== 'ready') {
					setEngineState('failed');
				}
			}
			await sleep(HEALTH_POLL_MS);
		}
	}

	private scheduleRestart(): void {
		if (this.stopping || this.restartTimer) {
			return;
		}
		setEngineState('restarting');
		const delay = this.backoffMs;
		this.backoffMs = Math.min(this.backoffMs * 2, RESTART_BACKOFF_MAX_MS);
		log(`Restarting engine in ${delay}ms`);
		this.restartTimer = setTimeout(() => {
			this.restartTimer = undefined;
			this.spawnOnce();
		}, delay);
	}

	resetBackoff(): void {
		this.backoffMs = RESTART_BACKOFF_MIN_MS;
	}

	async stop(): Promise<void> {
		this.stopping = true;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = undefined;
		}
		const pid = this.child?.pid;
		this.child = undefined;
		if (pid !== undefined) {
			log(`Stopping engine process tree (pid ${pid})`);
			await killProcessTree(pid);
		}
	}
}

export async function startNexoraEngine(context: vscode.ExtensionContext): Promise<EngineStartResult> {
	channel();
	context.subscriptions.push(channel());
	setEngineState('starting');

	const cfg = vscode.workspace.getConfiguration('nexora');
	const autoStart = cfg.get<boolean>('engine.autoStart', true);
	const preferredPortSetting = cfg.get<number>('engine.port', 8000);
	const backendUrlOverride = cfg.get<string>('backendUrl')?.trim() || '';

	const secrets = await loadOrCreateSecrets(context);
	const nexoraHome = resolveNexoraHome();

	let port = preferredPortSetting;
	if (backendUrlOverride) {
		const fromUrl = parsePortFromUrl(backendUrlOverride);
		if (fromUrl !== undefined) {
			port = fromUrl;
		}
	}

	const initialUrl = backendUrlOverride
		? stripTrailingSlash(backendUrlOverride)
		: `http://127.0.0.1:${port === 0 ? 8000 : port}`;

	if (await probeHealth(initialUrl, secrets.localToken)) {
		const healthyPort = parsePortFromUrl(initialUrl) ?? port;
		log(`Reusing existing engine at ${initialUrl}`);
		setEngineState('ready');
		lastResult = {
			baseUrl: initialUrl,
			port: healthyPort,
			localToken: secrets.localToken,
			ready: true,
			reused: true
		};
		return lastResult;
	}

	if (!autoStart) {
		log('nexora.engine.autoStart is false; not spawning the engine.');
		setEngineState('failed');
		lastResult = {
			baseUrl: initialUrl,
			port: parsePortFromUrl(initialUrl) ?? (port === 0 ? 8000 : port),
			localToken: secrets.localToken,
			ready: false,
			reused: false
		};
		return lastResult;
	}

	if (port === 0 || !(await isPortFree(port === 0 ? 0 : port))) {
		if (port !== 0 && backendUrlOverride) {
			log(`Preferred port ${port} is busy and not a healthy engine. Not moving off nexora.backendUrl.`);
			setEngineState('failed');
			lastResult = {
				baseUrl: initialUrl,
				port,
				localToken: secrets.localToken,
				ready: false,
				reused: false
			};
			return lastResult;
		}
		port = await findFreePort();
		log(`Selected free port ${port}`);
	}

	const engineExe = resolveEngineExecutable();
	if (!engineExe) {
		log('No engine executable found. Set nexora.engine.pythonPath, bundle nexora-engine.exe, or use the backend .venv.');
		setEngineState('failed');
		lastResult = {
			baseUrl: `http://127.0.0.1:${port}`,
			port,
			localToken: secrets.localToken,
			ready: false,
			reused: false
		};
		return lastResult;
	}

	const backendDir = resolveBackendDir(engineExe.path, engineExe.frozen);
	if (!engineExe.frozen && !fs.existsSync(path.join(backendDir, 'app', 'main.py'))) {
		log(`Engine backend directory not found (looked at ${backendDir}).`);
		setEngineState('failed');
		lastResult = {
			baseUrl: `http://127.0.0.1:${port}`,
			port,
			localToken: secrets.localToken,
			ready: false,
			reused: false
		};
		return lastResult;
	}

	const baseUrl = backendUrlOverride
		? stripTrailingSlash(backendUrlOverride)
		: `http://127.0.0.1:${port}`;

	supervisor = new EngineSupervisor({
		pythonPath: engineExe.path,
		backendDir,
		port,
		baseUrl,
		encryptionKey: secrets.encryptionKey,
		localToken: secrets.localToken,
		nexoraHome,
		frozen: engineExe.frozen
	});
	supervisor.spawnOnce();

	const ready = await waitUntilEngineReady(HEALTH_TIMEOUT_MS);
	if (ready) {
		log(`Engine ready at ${baseUrl}`);
	} else {
		log(`Timed out waiting for ${baseUrl}/api/health`);
		if (engineState !== 'ready') {
			setEngineState('failed');
		}
	}

	lastResult = {
		baseUrl,
		port,
		localToken: secrets.localToken,
		ready: engineState === 'ready',
		reused: false
	};
	return lastResult;
}

export async function stopNexoraEngine(): Promise<void> {
	if (!supervisor) {
		return;
	}
	await supervisor.stop();
	supervisor = undefined;
}

export function getEngineStartResult(): EngineStartResult | undefined {
	return lastResult;
}

export function toWebSocketUrl(httpUrl: string): string {
	if (httpUrl.startsWith('https://')) {
		return 'wss://' + httpUrl.slice('https://'.length);
	}
	if (httpUrl.startsWith('http://')) {
		return 'ws://' + httpUrl.slice('http://'.length);
	}
	return httpUrl;
}
