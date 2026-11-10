/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Customize (Phases 3-4): one editor tab for plugins, skills, subagents, slash commands, hooks and rules,
// read from Nexora's folders and from Claude Code's and Cursor's. Items open in the
// editor; Nexora's own items can be deleted (to the trash); others can be copied into
// Nexora to edit. Examples install in one click, and Try puts the item in the chat.

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { acquireEditorPanel, gateEditorPanel } from './services/editorPage';
import { getBackendClient } from './services/backendClient';
import type { CustomizeItem, CustomizePlural, HookItem } from './services/backend/customize';
import { useInLabels } from './services/platformUsage';
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

	/** section: a kind chip (plugins | platforms | skills | agents | recipes | commands | hooks | rules); startNew opens its New form. */
	public async open(section?: string, startNew = false): Promise<void> {
		// No section means the All overview, not whichever chip was open last.
		this._pendingSection = section || 'all';
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

	/** Reloads the page's data if it is open (after a recipe is saved from a plan). */
	public refresh(): void {
		if (this._attached) {
			this._scheduleRefresh();
		}
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
		const [list, examples, rules, hookList, installedPlugins, marketplaces, agentsInfo, learned, recipes, platformRows] = await Promise.all([
			api.list(folder),
			api.examples(folder),
			client.getProjectRules(folder).catch(() => undefined),
			api.listHooks(folder),
			api.listPlugins(),
			api.listMarketplaces(),
			api.listAgents(folder),
			api.learnedFacts(),
			client.listTemplates().then((r) => r.templates, () => null),
			this._platformRows(folder)
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
			// null from an engine without hooks or plugins: those pages then say it is too old.
			hooks: hookList ? hookList.hooks : null,
			hookShell: hookList ? hookList.shell : '',
			plugins: installedPlugins || null,
			marketplaces: marketplaces || [],
			// Phase 5: agents plans can use, what routing learned, and recipes (null: engine too old)
			agentsInfo: agentsInfo || null,
			learned: learned || null,
			recipes: recipes || null,
			// The Platforms chip: your MCP servers and the platforms the engine reports connected
			mcpServers: platformRows.servers,
			connectedPlatforms: platformRows.platforms,
			rulesEnabled: vscode.workspace.getConfiguration('nexora.agent').get<boolean>('projectRules', true)
		});
	}

	/** Rows for the Platforms chip, as the Platforms panel reads them; whatever fails is left out. */
	private async _platformRows(folder: string | undefined): Promise<{ servers: object[]; platforms: object[] }> {
		const client = getBackendClient();
		const [mine, usage] = await Promise.all([
			client.setMcpWorkspace(folder).then(() => client.getMyServers(), () => undefined),
			client.getPlatformUsage().catch(() => undefined)
		]);
		const servers = (mine?.servers || []).filter((s) => s.scope !== 'bundled').map((s) => ({
			id: s.id, name: s.name, scope: s.scope, state: s.state, url: s.url, command: s.command, tools: s.tools
		}));
		const report = usage || {};
		const connected = Object.keys(report).filter((id) => report[id].state === 'connected');
		const catalogue: Array<{ id?: string; name?: string }> = connected.length ? await client.getPlatforms().catch(() => []) : [];
		const platforms = connected.map((id) => ({
			id,
			name: catalogue.find((p) => String(p.id || '').toLowerCase() === id)?.name || id,
			usableIn: useInLabels(report[id])
		}));
		return { servers, platforms };
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
				// --- hooks ---
				case 'newHook':
					await this._api().addHook({
						scope: msg.scope === 'project' ? 'project' : 'user', event: String(msg.event || ''),
						matcher: String(msg.matcher || ''), command: String(msg.command || ''), timeout: Number(msg.timeout) || undefined
					}, this._folder());
					await this._pushState();
					return;
				case 'deleteHook':
					await this._deleteHook(String(msg.id || ''));
					return;
				case 'approveHook':
					await this._approveHook(String(msg.id || ''));
					return;
				case 'testHook':
					await this._testHook(String(msg.id || ''));
					return;
				case 'importHooks': {
					const count = await this._api().importHooks(this._folder());
					await this._pushState();
					this._post({ type: 'done' });
					void vscode.window.showInformationMessage(count
						? `Imported ${count} hook${count === 1 ? '' : 's'} from Claude Code.`
						: 'No new hooks in ~/.claude/settings.json or .claude/settings.json.');
					return;
				}
				// --- plugins and marketplaces ---
				case 'previewPlugin': {
					const preview = await this._api().previewPlugin(msg.source
						? { source: String(msg.source) } : { marketplace: String(msg.marketplace || ''), plugin: String(msg.plugin || '') });
					this._post({ type: 'pluginPreview', preview });
					return;
				}
				case 'updatePlugin':
					this._post({ type: 'pluginPreview', preview: await this._api().updatePlugin(String(msg.name || '')) });
					return;
				case 'installPlugin': {
					const plugin = await this._api().installPlugin(String(msg.token || ''));
					await this._pushState();
					this._post({ type: 'pluginInstalled', name: plugin.name });
					const commands = plugin.contents?.commands || [];
					void vscode.window.showInformationMessage(`Installed ${plugin.name}.` + (commands.length
						? ` Try /${commands[0]} in the chat.` : ''));
					return;
				}
				case 'enablePlugin':
					await this._api().enablePlugin(String(msg.name || ''), msg.enabled === true);
					await this._pushState();
					return;
				case 'removePlugin':
					await this._removePlugin(String(msg.name || ''));
					return;
				case 'addMarketplace': {
					const market = await this._api().addMarketplace(String(msg.source || ''));
					await this._pushState();
					this._post({ type: 'marketplaceAdded', name: market.name });
					return;
				}
				case 'refreshMarketplace':
					await this._api().refreshMarketplace(String(msg.name || ''));
					await this._pushState();
					this._post({ type: 'done' });
					return;
				case 'removeMarketplace':
					await this._removeMarketplace(String(msg.name || ''));
					return;
				// --- agents and recipes (Phase 5) ---
				case 'previewRemoteAgent':
					this._post({ type: 'remoteAgentCard', card: await this._api().previewRemoteAgent(String(msg.url || '')) });
					return;
				case 'addRemoteAgent': {
					const agent = await this._api().addRemoteAgent(String(msg.url || ''), String(msg.token || ''));
					await this._pushState();
					this._post({ type: 'remoteAgentAdded', name: agent.name });
					void vscode.window.showInformationMessage(`Added ${agent.title || agent.name}. Plans can now give it a step (agent.a2a.${agent.name}).`);
					return;
				}
				case 'removeRemoteAgent':
					await this._removeRemoteAgent(String(msg.name || ''));
					return;
				case 'testRemoteAgent': {
					const name = String(msg.name || '');
					const answer = await this._api().testRemoteAgent(name);
					this._post({ type: 'remoteAgentAnswer', answer: { ...answer, title: name } });
					return;
				}
				case 'forgetLearned':
					await this._forgetLearned();
					return;
				case 'copyText':
					await vscode.env.clipboard.writeText(String(msg.text || ''));
					void vscode.window.showInformationMessage('Copied. Run it in a terminal, then reopen Customize.');
					return;
				case 'openExternal':
					if (/^https?:\/\//.test(String(msg.url || ''))) {
						await vscode.env.openExternal(vscode.Uri.parse(String(msg.url)));
					}
					return;
				case 'useRecipe':
					await this._useRecipe(String(msg.id || ''), (msg.params && typeof msg.params === 'object') ? msg.params : {});
					return;
				case 'exportRecipe':
					await this._exportRecipe(String(msg.id || ''));
					return;
				case 'deleteRecipe':
					await this._deleteRecipe(String(msg.id || ''));
					return;
				case 'importRecipe':
					await this._importRecipe();
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

	private _api() {
		return getBackendClient().customize();
	}

	private async _hook(id: string): Promise<HookItem> {
		const hook = (await this._api().listHooks(this._folder()))?.hooks.find((h) => h.id === id);
		if (!hook) {
			throw new Error('That hook no longer exists.');
		}
		return hook;
	}

	private async _deleteHook(id: string): Promise<void> {
		const hook = await this._hook(id);
		const choice = await vscode.window.showWarningMessage(`Delete this ${hook.event} hook?`,
			{ modal: true, detail: `${hook.command}\n\nIt is removed from ${hook.file}.` }, 'Delete');
		if (choice === 'Delete') {
			await this._api().deleteHook(id, this._folder());
			await this._pushState();
		}
	}

	/** A project's hook runs only after the user has seen its exact command and approved it. */
	private async _approveHook(id: string): Promise<void> {
		const hook = await this._hook(id);
		const choice = await vscode.window.showWarningMessage(`Allow this project's ${hook.event} hook to run?`, {
			modal: true,
			detail: `It runs on this PC with your permissions:\n\n${hook.command}\n\nFrom ${hook.file}. If the command changes, you are asked again.`
		}, 'Approve');
		if (choice === 'Approve') {
			await this._api().approveHook(id, this._folder());
			await this._pushState();
		}
	}

	private async _testHook(id: string): Promise<void> {
		const hook = await this._hook(id);
		if (!hook.approved) {
			const choice = await vscode.window.showWarningMessage('Run this project hook once to test it?',
				{ modal: true, detail: hook.command }, 'Run');
			if (choice !== 'Run') {
				this._post({ type: 'done' });
				return;
			}
		}
		const result = await this._api().testHook(id, this._folder());
		this._post({ type: 'hookTestResult', command: hook.command, result });
		await this._pushState();
	}

	private async _removePlugin(name: string): Promise<void> {
		const choice = await vscode.window.showWarningMessage(`Remove the plugin ${name}?`,
			{ modal: true, detail: 'Its commands, skills, subagents, hooks and MCP servers are removed with it.' }, 'Remove');
		if (choice === 'Remove') {
			await this._api().removePlugin(name);
			await this._pushState();
		}
	}

	private async _removeMarketplace(name: string): Promise<void> {
		const choice = await vscode.window.showWarningMessage(`Remove the marketplace ${name}?`,
			{ modal: true, detail: 'Plugins you installed from it stay installed.' }, 'Remove');
		if (choice === 'Remove') {
			await this._api().removeMarketplace(name);
			await this._pushState();
		}
	}

	/** A project rule file, given relative to the folder as /api/memory/rules lists it. */
	private async _removeRemoteAgent(name: string): Promise<void> {
		const ok = await vscode.window.showWarningMessage(
			`Remove the remote agent ${name}? Plans that use it will skip its steps, and its saved token is deleted.`,
			{ modal: true }, 'Remove');
		if (ok !== 'Remove') {
			return;
		}
		await this._api().removeRemoteAgent(name);
		await this._pushState();
	}

	private async _forgetLearned(): Promise<void> {
		const ok = await vscode.window.showWarningMessage(
			'Forget what Nexora learned from past plan steps? Routes and agents go back to their default order.',
			{ modal: true }, 'Forget');
		if (ok !== 'Forget') {
			this._post({ type: 'done' });
			return;
		}
		await this._api().forgetLearned();
		await this._pushState();
		this._post({ type: 'done' });
	}

	/** Build a recipe's plan with these values and show it in the chat for approval. */
	private async _useRecipe(id: string, params: Record<string, unknown>): Promise<void> {
		const plan = await getBackendClient().instantiateTemplate(id, params, 'default', this._folder());
		this._post({ type: 'recipePlanned' });
		await vscode.commands.executeCommand('nexora.showPlanApproval', plan);
	}

	private async _exportRecipe(id: string): Promise<void> {
		const bundle = await getBackendClient().exportTemplate(id);
		const folder = this._folder();
		const target = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file(path.join(folder || os.homedir(), id + '.nexora-recipe.json')),
			filters: { 'Nexora recipe': ['json'] }
		});
		if (!target) {
			return;
		}
		await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(bundle, null, 2), 'utf8'));
		void vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}. Anyone can import it in Customize > Recipes.`);
	}

	private async _deleteRecipe(id: string): Promise<void> {
		const ok = await vscode.window.showWarningMessage(`Delete the recipe ${id}? This cannot be undone.`, { modal: true }, 'Delete');
		if (ok !== 'Delete') {
			return;
		}
		await getBackendClient().deleteTemplate(id);
		await this._pushState();
	}

	private async _importRecipe(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Nexora recipe': ['json'] } });
		if (!picked || !picked.length) {
			return;
		}
		let bundle: Record<string, unknown>;
		try {
			bundle = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(picked[0])).toString('utf8'));
		} catch {
			throw new Error('That file is not a recipe (it is not valid JSON).');
		}
		const client = getBackendClient();
		const preview = await client.previewImportTemplate(bundle);
		if (!preview.valid) {
			throw new Error('That recipe cannot be imported: ' + (preview.errors || []).join('; '));
		}
		const missing = preview.platforms_missing.length ? ` It uses ${preview.platforms_missing.join(', ')}, which this Nexora does not have.` : '';
		const ok = await vscode.window.showInformationMessage(
			`Import "${preview.name}" (${preview.task_count} steps)?${missing}`, { modal: true }, 'Import');
		if (ok !== 'Import') {
			return;
		}
		await client.importTemplate(bundle);
		await this._pushState();
	}

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
