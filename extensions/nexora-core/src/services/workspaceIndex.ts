/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getBackendClient } from './backendClient';
import { getSettingsService } from './settingsService';
import { deriveWorkspaceId } from './workspaceId';

/**
 * Keeps the open folder's code index current without the user asking.
 *
 * The first time a folder is opened it is indexed in the background. After
 * that, file changes mark the index stale and it is rebuilt once the folder
 * has been quiet for a while, at most every few minutes, since every run is a
 * full rebuild that also becomes a Timeline snapshot. The status bar shows the
 * state; clicking it re-indexes now. Turned off by Settings > General >
 * Auto-index workspace, in which case indexing only happens on request.
 */

/** Wait this long after the last file change before rebuilding. */
const QUIET_MS = 60_000;
/** Never rebuild more often than this, however busy the folder is. */
const MIN_INTERVAL_MS = 10 * 60_000;
/** A full index of a large folder can take minutes. */
const INDEX_TIMEOUT_MS = 10 * 60_000;
/** Changes here never affect the index. */
const IGNORED = /[\\/](node_modules|\.git|dist|build|out|\.next|__pycache__|\.venv|venv)[\\/]/;

type IndexState =
	| { kind: 'idle' }
	| { kind: 'indexing' }
	| { kind: 'ready'; files: number; at: Date; stale: boolean }
	| { kind: 'failed'; error: string };

export class WorkspaceIndexService implements vscode.Disposable {
	private state: IndexState = { kind: 'idle' };
	private readonly statusItem = vscode.window.createStatusBarItem('nexora.index', vscode.StatusBarAlignment.Left, 49);
	private readonly disposables: vscode.Disposable[] = [this.statusItem];
	private readonly changed = new vscode.EventEmitter<void>();
	/** Fires after every finished run, so the Timeline and chat can refresh. */
	readonly onDidIndex = this.changed.event;
	private quietTimer: ReturnType<typeof setTimeout> | undefined;
	private lastRun = 0;
	/** The check in progress, so overlapping calls (engine ready, reconnect, folder change) share it. */
	private starting: Promise<void> | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.statusItem.name = 'Nexora Index';
		this.statusItem.command = 'nexora.reindexWorkspace';
		const watcher = vscode.workspace.createFileSystemWatcher('**/*');
		const onChange = (uri: vscode.Uri) => this.markStale(uri);
		this.disposables.push(
			watcher,
			watcher.onDidChange(onChange),
			watcher.onDidCreate(onChange),
			watcher.onDidDelete(onChange),
			this.changed,
			vscode.workspace.onDidChangeWorkspaceFolders(() => void this.start())
		);
	}

	dispose(): void {
		clearTimeout(this.quietTimer);
		vscode.Disposable.from(...this.disposables).dispose();
	}

	/** True while the user leaves automatic indexing on (the default). */
	get automatic(): boolean {
		return getSettingsService(this.context).getPreferences().autoIndexWorkspace !== false;
	}

	/** Call when the engine is ready: learn the folder's index state and index it if it never was. */
	start(): Promise<void> {
		this.starting ??= this.checkFolder().finally(() => {
			this.starting = undefined;
		});
		return this.starting;
	}

	private async checkFolder(): Promise<void> {
		if (this.state.kind === 'indexing') {
			return;
		}
		const folder = this.folder();
		if (!folder) {
			this.state = { kind: 'idle' };
			this.render();
			return;
		}
		try {
			const timeline = await getBackendClient().getTimeline(deriveWorkspaceId(folder));
			const newest = timeline.snapshots.find((s) => s.is_newest) ?? timeline.snapshots[0];
			// An empty index finds nothing; rebuild it rather than report "0 files".
			if (newest && newest.file_count > 0) {
				this.state = { kind: 'ready', files: newest.file_count, at: new Date(newest.created_at), stale: false };
				this.lastRun = this.state.at.getTime();
				this.render();
				return;
			}
		} catch {
			// The engine could not say; treat the folder as not indexed yet.
		}
		this.state = { kind: 'idle' };
		this.render();
		if (this.automatic) {
			await this.indexNow();
		}
	}

	/** Index the open folder now (the status bar, the command and the chat call this). */
	async indexNow(): Promise<void> {
		const folder = this.folder();
		if (!folder || this.state.kind === 'indexing') {
			return;
		}
		clearTimeout(this.quietTimer);
		this.state = { kind: 'indexing' };
		this.render();
		try {
			const result = await getBackendClient().indexWorkspace(folder, INDEX_TIMEOUT_MS);
			this.state = { kind: 'ready', files: result?.files_indexed ?? 0, at: new Date(), stale: false };
		} catch (error) {
			this.state = { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
		}
		this.lastRun = Date.now();
		this.render();
		this.changed.fire();
	}

	private markStale(uri: vscode.Uri): void {
		if (this.state.kind !== 'ready' || IGNORED.test(uri.fsPath) || !this.inFolder(uri)) {
			return;
		}
		this.state.stale = true;
		this.render();
		if (!this.automatic) {
			return;
		}
		clearTimeout(this.quietTimer);
		const wait = Math.max(QUIET_MS, this.lastRun + MIN_INTERVAL_MS - Date.now());
		this.quietTimer = setTimeout(() => void this.indexNow(), wait);
	}

	private render(): void {
		const state = this.state;
		if (!this.folder()) {
			this.statusItem.hide();
			return;
		}
		switch (state.kind) {
			case 'idle':
				this.statusItem.text = '$(database) Not indexed';
				this.statusItem.tooltip = 'Nexora has not indexed this folder yet. Click to index it now.';
				break;
			case 'indexing':
				this.statusItem.text = '$(sync~spin) Indexing';
				this.statusItem.tooltip = 'Nexora is indexing this folder for code search.';
				break;
			case 'ready':
				this.statusItem.text = `$(database) ${state.files} files${state.stale ? ' *' : ''}`;
				this.statusItem.tooltip = `Indexed ${state.files} files at ${state.at.toLocaleString()}.`
					+ (state.stale ? ` Files changed since; ${this.automatic ? 'it will re-index shortly' : 'click to re-index'}.` : ' Click to re-index now.');
				break;
			case 'failed':
				this.statusItem.text = '$(warning) Index failed';
				this.statusItem.tooltip = `Indexing failed: ${state.error}\nClick to try again.`;
				break;
		}
		this.statusItem.show();
	}

	private folder(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	private inFolder(uri: vscode.Uri): boolean {
		return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath === this.folder();
	}
}
