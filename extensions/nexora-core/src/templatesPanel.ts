/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getTemplatesWebviewHtml } from './webview/templates';
import { getBackendClient } from './services/backendClient';
import { getNotificationService } from './services/notificationService';
import type { ImportPreview, WorkflowTemplate } from './services/backend/workflows';

export class TemplatesPanelProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'nexora.templates';

	private _view?: vscode.WebviewView;
	private _attached = false;
	private _pendingImport?: Record<string, unknown>;
	private _disposables: vscode.Disposable[] = [];

	constructor(private readonly _extensionUri: vscode.Uri) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;
		this._attach(webviewView);
	}

	public async open(): Promise<void> {
		await vscode.commands.executeCommand(`${TemplatesPanelProvider.viewType}.focus`);
		if (this._attached) {
			void this._pushState();
		}
	}

	public async refresh(): Promise<void> {
		await this._pushState();
	}

	public async useTemplate(): Promise<void> {
		const notifications = getNotificationService();
		try {
			const listed = await getBackendClient().listTemplates();
			if (!listed.templates.length) {
				void notifications.showWarning('No templates available.');
				return;
			}
			const picked = await vscode.window.showQuickPick(
				listed.templates.map(template => ({
					label: template.name,
					description: template.description,
					template
				})),
				{ placeHolder: 'Select a workflow template', matchOnDescription: true }
			);
			if (!picked) {
				return;
			}
			const params = await this._promptParameters(picked.template);
			if (params === undefined) {
				return;
			}
			await this._instantiate(picked.template.id, params);
		} catch (error) {
			void notifications.showError(
				`Failed to load templates: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	private async _promptParameters(
		template: WorkflowTemplate
	): Promise<Record<string, unknown> | undefined> {
		const params: Record<string, unknown> = {};
		for (const param of template.parameters || []) {
			if (param.choices && param.choices.length) {
				const choice = await vscode.window.showQuickPick(
					param.choices.map(c => ({ label: String(c) })),
					{
						title: param.name,
						placeHolder: param.description || param.name
					}
				);
				if (!choice) {
					return undefined;
				}
				params[param.name] = choice.label;
				continue;
			}
			const value = await vscode.window.showInputBox({
				title: param.name,
				prompt: param.description || param.name,
				value: param.default === null || param.default === undefined ? '' : String(param.default),
				validateInput: (v) =>
					param.required && !v.trim() ? `${param.name} is required` : undefined
			});
			if (value === undefined) {
				return undefined;
			}
			if (value !== '') {
				params[param.name] = value;
			} else if (param.default !== undefined && param.default !== null) {
				params[param.name] = param.default;
			}
		}
		return params;
	}

	private _attach(view: vscode.WebviewView): void {
		if (this._attached && this._view === view) {
			void this._pushState();
			return;
		}
		this._disposeBindings();
		this._attached = true;
		this._view = view;
		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};
		view.webview.html = getTemplatesWebviewHtml(view.webview, this._extensionUri);

		this._disposables = [
			view.webview.onDidReceiveMessage(async (msg) => {
				switch (msg.type) {
					case 'ready':
					case 'refresh':
						await this._pushState();
						break;
					case 'instantiate':
						await this._instantiate(String(msg.id || ''), msg.params || {});
						break;
					case 'export':
						await this._export(String(msg.id || ''));
						break;
					case 'import':
						await this._importPick();
						break;
					case 'confirmImport':
						await this._confirmImport();
						break;
					case 'cancelImport':
						this._pendingImport = undefined;
						break;
				}
			}),
			view.onDidChangeVisibility(() => {
				if (view.visible && this._attached) {
					void this._pushState();
				}
			}),
			view.onDidDispose(() => {
				this._disposeBindings();
				this._view = undefined;
				this._attached = false;
				this._pendingImport = undefined;
			})
		];
	}

	private _disposeBindings(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
		this._disposables = [];
	}

	private async _pushState(): Promise<void> {
		if (!this._view || !this._attached) {
			return;
		}
		try {
			const listed = await getBackendClient().listTemplates();
			this._view.webview.postMessage({
				type: 'updateData',
				data: {
					available: true,
					templates: listed.templates
				}
			});
		} catch (error) {
			this._view.webview.postMessage({
				type: 'updateData',
				data: {
					available: false,
					error: error instanceof Error ? error.message : String(error),
					templates: []
				}
			});
		}
	}

	private async _instantiate(templateId: string, params: Record<string, unknown>): Promise<void> {
		if (!templateId) {
			return;
		}
		const notifications = getNotificationService();
		try {
			const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const plan = await getBackendClient().instantiateTemplate(
				templateId,
				params,
				'default',
				workspacePath
			);
			await vscode.commands.executeCommand('nexora.showPlanApproval', plan);
			void notifications.showInfo(`Template instantiated. Review the plan in Chat.`);
		} catch (error) {
			void notifications.showError(
				`Failed to instantiate template: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	private async _export(templateId: string): Promise<void> {
		if (!templateId) {
			return;
		}
		const notifications = getNotificationService();
		try {
			const bundle = await getBackendClient().exportTemplate(templateId);
			const uri = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(`${templateId}.nexflow.json`),
				filters: { 'Nexora Flow': ['nexflow.json', 'json'] },
				saveLabel: 'Export template'
			});
			if (!uri) {
				return;
			}
			const bytes = Buffer.from(JSON.stringify(bundle, null, 2), 'utf8');
			await vscode.workspace.fs.writeFile(uri, bytes);
			void notifications.showSuccess(`Exported ${templateId}`);
		} catch (error) {
			void notifications.showError(
				`Export failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	private async _importPick(): Promise<void> {
		const notifications = getNotificationService();
		const uris = await vscode.window.showOpenDialog({
			canSelectMany: false,
			filters: { 'Nexora Flow': ['nexflow.json', 'json'] },
			openLabel: 'Preview import'
		});
		if (!uris || !uris[0]) {
			return;
		}
		try {
			const raw = await vscode.workspace.fs.readFile(uris[0]);
			const bundle = JSON.parse(Buffer.from(raw).toString('utf8')) as Record<string, unknown>;
			const preview: ImportPreview = await getBackendClient().previewImportTemplate(bundle);
			this._pendingImport = bundle;
			this._view?.webview.postMessage({
				type: 'importPreview',
				preview
			});
		} catch (error) {
			this._pendingImport = undefined;
			void notifications.showError(
				`Import preview failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	private async _confirmImport(): Promise<void> {
		const notifications = getNotificationService();
		if (!this._pendingImport) {
			void notifications.showWarning('Nothing to import. Pick a .nexflow.json file first.');
			return;
		}
		try {
			const saved: WorkflowTemplate = await getBackendClient().importTemplate(this._pendingImport);
			this._pendingImport = undefined;
			void notifications.showSuccess(`Imported ${saved.name}`);
			await this._pushState();
		} catch (error) {
			void notifications.showError(
				`Import failed: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
}
