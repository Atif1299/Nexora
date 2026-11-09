/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Customize (Phase 3): one editor tab for skills, subagents, slash commands and rules,
// read from Nexora's folders and from Claude Code's and Cursor's. Items open in the
// editor; Nexora's own items can be deleted (to the trash); others can be copied into
// Nexora to edit. Examples install in one click, and Try puts the item in the chat.

import * as path from 'path';
import * as vscode from 'vscode';
import { acquireEditorPanel, gateEditorPanel } from './services/editorPage';
import { getBackendClient } from './services/backendClient';
import type { CustomizeItem, CustomizePlural } from './services/backend/customize';
import { getCustomizeWebviewHtml } from './webview/customize';

const PLURALS: CustomizePlural[] = ['skills', 'commands', 'agents'];
const SINGULAR: Record<CustomizePlural, string> = { skills: 'skill', commands: 'command', agents: 'subagent' };
const PREVIEW_LINES = 40;
const PREVIEW_BYTES = 64 * 1024;

type Scope = 'user' | 'project';

function isPlural(value: unknown): value is CustomizePlural {
	return typeof value === 'string' && PLURALS.indexOf(value as CustomizePlural) >= 0;
}

function isScope(value: unknown): value is Scope {
	return value === 'user' || value === 'project';
}

export class CustomizePanelProvider {
	public static readonly viewType = 'nexora.customize';

	private _panel?: vscode.WebviewPanel;
	private _attached = false;
	private _pendingSection?: string;
	private _pendingNew = false;
	private _disposables: vscode.Disposable[] = [];
	private _refreshTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly _extensionUri: vscode.Uri) { }

	/** section: skills | agents | commands | rules | platforms; startNew opens its New form. */
	public async open(section?: string, startNew = false): Promise<void> {
		this._pendingSection = section;
		this._pendingNew = startNew;
		const panel = acquireEditorPanel({
			viewType: CustomizePanelProvider.viewType,
			title: 'Nexora Customize',
			extensionUri: this._extensionUri,
			icon: 'customize.svg'
		});
		if (this._panel === panel) {
			if (this._attached) {
				this._reveal();
				this._scheduleRefresh();
			}
			return;
		}
		this._panel = panel;
		this._attached = false;
		panel.onDidDispose(() => {
			if (this._panel !== panel) {
				return;
			}
			this._dispose();
			this._panel = undefined;
			this._attached = false;
		});
		gateEditorPanel(panel, (ready) => this._attach(ready));
	}

	private _folder(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	private _post(message: Record<string, unknown>): void {
		void this._panel?.webview.postMessage(message);
	}

	private _reveal(): void {
		if (this._pendingSection || this._pendingNew) {
			this._post({ type: 'reveal', section: this._pendingSection || '', startNew: this._pendingNew });
		}
		this._pendingSection = undefined;
		this._pendingNew = false;
	}

	private _dispose(): void {
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables = [];
		if (this._refreshTimer) {
			clearTimeout(this._refreshTimer);
			this._refreshTimer = undefined;
		}
	}

	private _attach(panel: vscode.WebviewPanel): void {
		this._dispose();
		this._attached = true;
		panel.webview.html = getCustomizeWebviewHtml(panel.webview, this._extensionUri);
		// Workspace folders are watched; NEXORA_HOME and ~/.claude are re-read when the tab gets focus.
		const watchers = [
			vscode.workspace.createFileSystemWatcher('**/{.nexora,.claude,.cursor}/{skills,commands,agents,rules}/**'),
			vscode.workspace.createFileSystemWatcher('**/{AGENTS,CLAUDE}.md')
		];
		for (const w of watchers) {
			w.onDidCreate(() => this._scheduleRefresh());
			w.onDidChange(() => this._scheduleRefresh());
			w.onDidDelete(() => this._scheduleRefresh());
		}
		this._disposables = [
			...watchers,
			panel.onDidChangeViewState((e) => {
				if (e.webviewPanel.visible) {
					this._scheduleRefresh();
				}
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this._scheduleRefresh()),
			panel.webview.onDidReceiveMessage((msg) => this._onMessage(msg))
		];
	}

	private _scheduleRefresh(): void {
		if (this._refreshTimer) {
			clearTimeout(this._refreshTimer);
		}
		this._refreshTimer = setTimeout(() => {
			this._refreshTimer = undefined;
			void this._pushState();
		}, 300);
	}

	private async _pushState(): Promise<void> {
		const folder = this._folder();
		const client = getBackendClient();
		const api = client.customize();
		const [list, examples, rules] = await Promise.all([
			api.list(folder),
			api.examples(folder),
			client.getProjectRules(folder).catch(() => undefined)
		]);
		this._post({
			type: 'state',
			engine: !!list,
			hasWorkspace: !!folder,
			workspaceName: folder ? path.basename(folder) : '',
			skills: list?.skills || [],
			commands: list?.commands || [],
			agents: list?.agents || [],
			examples: examples || [],
			rules: rules || null,
			rulesEnabled: vscode.workspace.getConfiguration('nexora.agent').get<boolean>('projectRules', true)
		});
	}

	private async _onMessage(msg: any): Promise<void> {
		try {
			switch (msg?.type) {
				case 'ready':
				case 'refresh':
					await this._pushState();
					this._reveal();
					return;
				case 'openFile':
					await this._openFile(String(msg.path || ''));
					return;
				case 'openRule':
					await this._openRule(String(msg.path || ''));
					return;
				case 'detailRequest':
					await this._sendPreview(String(msg.path || ''));
					return;
				case 'newItem':
					await this._newItem(msg.kind, String(msg.name || ''), msg.scope, String(msg.description || ''));
					return;
				case 'newRule':
					await this._newRule(String(msg.name || ''));
					return;
				case 'deleteItem':
					await this._deleteItem(msg.kind, String(msg.name || ''), String(msg.path || ''));
					return;
				case 'copyItem':
					await this._copyItem(msg.kind, String(msg.name || ''));
					return;
				case 'installExample':
					await this._installExample(String(msg.id || ''), msg.scope);
					return;
				case 'tryItem':
					await vscode.commands.executeCommand('nexora.prefillChat', String(msg.text || ''), 'agent');
					return;
				case 'openPlatforms':
					await vscode.commands.executeCommand('nexora.openPlatformBrowser');
					return;
				case 'openPersonalRules':
					await this._openPersonalRules();
					return;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this._post({ type: 'error', message });
			void vscode.window.showErrorMessage(message);
		}
	}

	private async _openFile(filePath: string): Promise<void> {
		if (!filePath) {
			return;
		}
		await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
	}

	/** A project rule file, given relative to the folder as /api/memory/rules lists it. */
	private async _openRule(rel: string): Promise<void> {
		const folder = this._folder();
		if (!folder || !rel) {
			return;
		}
		const full = path.resolve(folder, rel);
		if (path.relative(folder, full).startsWith('..')) {
			return;
		}
		await this._openFile(full);
	}

	/** The first lines of an item's file, for the detail view. */
	private async _sendPreview(filePath: string): Promise<void> {
		let text = '';
		try {
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
			text = Buffer.from(bytes.slice(0, PREVIEW_BYTES)).toString('utf8').replace(/\r\n/g, '\n');
			const lines = text.split('\n');
			text = lines.slice(0, PREVIEW_LINES).join('\n') + (lines.length > PREVIEW_LINES ? '\n...' : '');
		} catch {
			text = '';
		}
		this._post({ type: 'detailBody', path: filePath, text });
	}

	/** The item as the engine lists it now; the webview's copy is never trusted for writes. */
	private async _find(kind: CustomizePlural, name: string, filePath?: string): Promise<CustomizeItem | undefined> {
		const list = await getBackendClient().customize().list(this._folder());
		return (list?.[kind] || []).find((i) => i.name === name && (!filePath || i.path === filePath));
	}

	private async _newItem(kind: unknown, name: string, scope: unknown, description: string): Promise<void> {
		if (!isPlural(kind) || !isScope(scope)) {
			return;
		}
		const item = await getBackendClient().customize().create(kind, name, scope, description, this._folder());
		await this._pushState();
		this._post({ type: 'created', kind, name: item.name });
		await this._openFile(item.path);
	}

	private async _newRule(name: string): Promise<void> {
		const folder = this._folder();
		if (!folder || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
			return;
		}
		const uri = vscode.Uri.file(path.join(folder, '.nexora', 'rules', name + '.md'));
		let exists = true;
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			exists = false;
		}
		if (exists) {
			throw new Error(`.nexora/rules/${name}.md already exists.`);
		}
		await vscode.workspace.fs.writeFile(uri, Buffer.from(`# ${name}\n\nWrite how Nexora should work in this project.\n`, 'utf8'));
		await this._pushState();
		await this._openFile(uri.fsPath);
	}

	private async _deleteItem(kind: unknown, name: string, filePath: string): Promise<void> {
		if (!isPlural(kind)) {
			return;
		}
		const item = await this._find(kind, name, filePath);
		if (!item || !item.editable) {
			throw new Error('Only Nexora\'s own items can be deleted here. Items from Claude Code or Cursor stay in their folders.');
		}
		const target = kind === 'skills' ? path.dirname(item.path) : item.path;
		const choice = await vscode.window.showWarningMessage(
			`Delete the ${SINGULAR[kind]} "${item.name}"?`,
			{ modal: true, detail: `${target}\n\nIt moves to the trash, so you can restore it.` },
			'Delete'
		);
		if (choice !== 'Delete') {
			return;
		}
		await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: true, useTrash: true });
		await this._pushState();
		this._post({ type: 'deleted', kind, name: item.name });
	}

	private async _pickScope(title: string): Promise<Scope | undefined> {
		const picks: Array<vscode.QuickPickItem & { scope: Scope }> = [
			{ label: 'You', description: 'All your projects (Nexora data folder)', scope: 'user' }
		];
		if (this._folder()) {
			picks.push({ label: 'This project', description: '.nexora/ in this folder, shared through git', scope: 'project' });
		}
		const pick = await vscode.window.showQuickPick(picks, { title, placeHolder: 'Where should the copy live?' });
		return pick?.scope;
	}

	private async _copyItem(kind: unknown, name: string): Promise<void> {
		if (!isPlural(kind)) {
			return;
		}
		const scope = await this._pickScope(`Copy "${name}" into Nexora`);
		if (!scope) {
			return;
		}
		const item = await getBackendClient().customize().copyToNexora(kind, name, scope, this._folder());
		await this._pushState();
		this._post({ type: 'created', kind, name: item.name });
		void vscode.window.showInformationMessage(`Copied "${item.name}" into Nexora. Your copy is used from now on; the original was not changed.`);
		await this._openFile(item.path);
	}

	private async _installExample(id: string, scope: unknown): Promise<void> {
		if (!isScope(scope)) {
			return;
		}
		const item = await getBackendClient().customize().installExample(id, scope, this._folder());
		await this._pushState();
		this._post({ type: 'created', kind: item.kind === 'agent' ? 'agents' : item.kind + 's', name: item.name });
	}

	/**
	 * Opens the personal rules file (NEXORA_HOME/AGENTS.md), creating it with a short
	 * starter text the first time. The path comes from the engine (/api/memory/rules),
	 * never from the webview, so it always matches where the engine reads it.
	 */
	private async _openPersonalRules(): Promise<void> {
		const filePath = (await getBackendClient().getProjectRules()).personal_path;
		if (!filePath || path.basename(filePath) !== 'AGENTS.md') {
			throw new Error('Nexora engine is not reachable, so the personal rules file could not be found.');
		}
		const uri = vscode.Uri.file(filePath);
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			const starter = [
				'# Personal rules',
				'',
				'Nexora sends these to the agent in every project, before the project\'s own',
				'AGENTS.md, CLAUDE.md and .nexora/rules/. Project rules win where they disagree.',
				'',
				'- Example: explain changes in plain, simple English.',
				''
			].join('\n');
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)));
			await vscode.workspace.fs.writeFile(uri, Buffer.from(starter, 'utf8'));
		}
		await vscode.window.showTextDocument(uri);
		await this._pushState();
	}
}
