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
	private _pendingImport?: Record<string, unknown>;

	constructor(private readonly _extensionUri: vscode.Uri) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): void {
		this._view = webviewView;

		const webviewOpts: vscode.WebviewOptions & { retainContextWhenHidden?: boolean } = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
			retainContextWhenHidden: true
		};
		webviewView.webview.options = webviewOpts;
		webviewView.webview.html = getTemplatesWebviewHtml(webviewView.webview, this._extensionUri);

		const disposables: vscode.Disposable[] = [
			webviewView.webview.onDidReceiveMessage(async (msg) => {
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
			webviewView.onDidChangeVisibility(() => {
				if (webviewView.visible) {
					void this._pushState();
				}
			})
		];

		webviewView.onDidDispose(() => {
			for (const disposable of disposables) {
				disposable.dispose();
			}
			this._view = undefined;
		});
	}

	public async refresh(): Promise<void> {
		await this._pushState();
	}

	private async _pushState(): Promise<void> {
		if (!this._view) {
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
