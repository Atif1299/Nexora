/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Where the chat list is kept: one list per folder, like Cursor.
 *
 * - A folder or .code-workspace window uses VS Code workspaceState, so each
 *   folder has its own chats and two windows never overwrite each other.
 * - A window with no folder uses one globalState list ("no folder").
 *
 * Before 8 Nov 2026 every window shared one globalState list. The first time a
 * folder opens, the chats recorded for that folder move into it; chats with no
 * folder recorded move to the no-folder list; empty chats are dropped. Chats
 * of folders not opened yet stay in the old list until their folder opens.
 *
 * The engine memory the model reads (NEXORA_HOME/projects/<wid>/) was already
 * per folder; this module only fixes the list the user sees.
 */

const SESSIONS_KEY = 'nexora.chatSessions';
const ACTIVE_KEY = 'nexora.activeSessionId';
const NO_FOLDER_SESSIONS_KEY = 'nexora.chatSessions.noFolder';
const NO_FOLDER_ACTIVE_KEY = 'nexora.activeSessionId.noFolder';

export type StoredSession = {
	id?: unknown;
	messages?: unknown;
	memoryWorkspacePath?: unknown;
	[key: string]: unknown;
};

export function samePath(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) {
		return false;
	}
	const norm = (p: string) => {
		const trimmed = p.replace(/[\\/]+$/, '').replace(/\\/g, '/');
		return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
	};
	return norm(a) === norm(b);
}

function hasMessages(s: StoredSession): boolean {
	return Array.isArray(s.messages) && s.messages.length > 0;
}

/**
 * Splits the old shared list for one folder.
 * mine: chats recorded for this folder. noFolder: chats with no folder recorded.
 * rest: chats of other folders (stay in the old list). Empty chats are dropped.
 */
export function splitLegacySessions(legacy: StoredSession[], folderPath: string | undefined): {
	mine: StoredSession[];
	noFolder: StoredSession[];
	rest: StoredSession[];
} {
	const mine: StoredSession[] = [];
	const noFolder: StoredSession[] = [];
	const rest: StoredSession[] = [];
	for (const s of legacy) {
		if (!s || typeof s !== 'object' || !hasMessages(s)) {
			continue;
		}
		const recorded = typeof s.memoryWorkspacePath === 'string' ? s.memoryWorkspacePath : undefined;
		if (!recorded) {
			noFolder.push(s);
		} else if (folderPath && samePath(recorded, folderPath)) {
			mine.push(s);
		} else {
			rest.push(s);
		}
	}
	return { mine, noFolder, rest };
}

export class ChatSessionStore {
	constructor(private readonly _context: vscode.ExtensionContext) { }

	/** The folder this window's chats belong to; undefined in a no-folder window. */
	get folderPath(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	private get _hasFolder(): boolean {
		return !!vscode.workspace.workspaceFolders?.length;
	}

	load(): { sessions: StoredSession[]; activeId: string } {
		this._migrateLegacy();
		const memento = this._hasFolder ? this._context.workspaceState : this._context.globalState;
		const sessions = memento.get<StoredSession[]>(this._hasFolder ? SESSIONS_KEY : NO_FOLDER_SESSIONS_KEY, []);
		const activeId = memento.get<string>(this._hasFolder ? ACTIVE_KEY : NO_FOLDER_ACTIVE_KEY, '');
		return {
			sessions: Array.isArray(sessions) ? sessions : [],
			activeId: typeof activeId === 'string' ? activeId : ''
		};
	}

	async save(sessions: unknown[], activeId: string): Promise<void> {
		if (this._hasFolder) {
			await this._context.workspaceState.update(SESSIONS_KEY, sessions);
			await this._context.workspaceState.update(ACTIVE_KEY, activeId);
		} else {
			await this._context.globalState.update(NO_FOLDER_SESSIONS_KEY, sessions);
			await this._context.globalState.update(NO_FOLDER_ACTIVE_KEY, activeId);
		}
	}

	/**
	 * Moves this folder's chats (and folder-less chats) out of the old shared
	 * list. Runs before the first load; the writes are not awaited, but the
	 * in-memory values update at once, so load() reads the result.
	 */
	private _migrateLegacy(): void {
		const legacy = this._context.globalState.get<StoredSession[]>(SESSIONS_KEY);
		if (!Array.isArray(legacy) || legacy.length === 0) {
			return;
		}
		const folder = this._hasFolder ? this.folderPath : undefined;
		const { mine, noFolder, rest } = splitLegacySessions(legacy, folder);

		if (this._hasFolder && mine.length > 0) {
			const current = this._context.workspaceState.get<StoredSession[]>(SESSIONS_KEY, []);
			const known = new Set((Array.isArray(current) ? current : []).map(s => s?.id));
			const merged = [...(Array.isArray(current) ? current : []), ...mine.filter(s => !known.has(s.id))];
			void this._context.workspaceState.update(SESSIONS_KEY, merged);
		}
		if (noFolder.length > 0) {
			const current = this._context.globalState.get<StoredSession[]>(NO_FOLDER_SESSIONS_KEY, []);
			const known = new Set((Array.isArray(current) ? current : []).map(s => s?.id));
			const merged = [...(Array.isArray(current) ? current : []), ...noFolder.filter(s => !known.has(s.id))];
			void this._context.globalState.update(NO_FOLDER_SESSIONS_KEY, merged);
		}
		void this._context.globalState.update(SESSIONS_KEY, rest.length > 0 ? rest : undefined);
		void this._context.globalState.update(ACTIVE_KEY, undefined);
	}
}
