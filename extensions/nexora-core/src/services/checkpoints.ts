/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { promises as fs } from 'fs';

/**
 * Checkpoints of the files the agent edits, one per Agent-mode message.
 *
 * Before a file tool writes, the file's bytes as they were are kept in the
 * current checkpoint (only the first write per file per checkpoint). Restoring
 * a checkpoint puts back every file the agent touched from that message on, as
 * it was just before that message, and deletes files the agent created. Later
 * checkpoints are dropped, since their changes are undone.
 *
 * Only agent file tools are tracked. Terminal commands, edits the user makes
 * by hand and other extensions are not, so a restore can overwrite them; the
 * confirmation says so. Checkpoints live in memory and end with the window.
 */

/** Files larger than this are not snapshotted; a restore reports them as skipped. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Oldest checkpoints are dropped past this, so memory stays bounded. */
const MAX_CHECKPOINTS = 50;

interface FileSnapshot {
	existed: boolean;
	content?: Buffer;
	/** Too large or unreadable when the agent first wrote it; can't be restored. */
	unavailable?: boolean;
}

interface Checkpoint {
	id: string;
	label: string;
	createdAt: number;
	/** Absolute path -> the file as it was before this checkpoint's first write to it. */
	files: Map<string, FileSnapshot>;
}

export interface RestorePreview {
	/** Absolute paths the restore will write or delete. */
	files: string[];
	/** Absolute paths that changed but can't be restored. */
	unavailable: string[];
}

export interface RestoreResult {
	restored: string[];
	deleted: string[];
	failed: string[];
	unavailable: string[];
}

export class CheckpointStore {
	private checkpoints: Checkpoint[] = [];
	private active: Checkpoint | undefined;
	private sequence = 0;

	/** Start the checkpoint for one user message. Later writes are recorded into it. */
	begin(label: string): string {
		this.sequence += 1;
		const checkpoint: Checkpoint = {
			id: `cp-${Date.now().toString(36)}-${this.sequence}`,
			label: label.slice(0, 120),
			createdAt: Date.now(),
			files: new Map()
		};
		this.checkpoints.push(checkpoint);
		if (this.checkpoints.length > MAX_CHECKPOINTS) {
			this.checkpoints.splice(0, this.checkpoints.length - MAX_CHECKPOINTS);
		}
		this.active = checkpoint;
		return checkpoint.id;
	}

	/**
	 * Keep the file as it is now, before an agent tool overwrites it. Call after
	 * the user accepted the edit and right before the write. A write with no
	 * message in progress (a plan step started outside chat) opens its own checkpoint.
	 */
	async recordBeforeWrite(fullPath: string): Promise<void> {
		if (!this.active) {
			this.begin('Agent edits');
		}
		const checkpoint = this.active!;
		const key = path.resolve(fullPath);
		if (checkpoint.files.has(key)) {
			return;
		}
		try {
			const stat = await fs.stat(key);
			if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
				checkpoint.files.set(key, { existed: true, unavailable: true });
				return;
			}
			checkpoint.files.set(key, { existed: true, content: await fs.readFile(key) });
		} catch (err: any) {
			checkpoint.files.set(key, err?.code === 'ENOENT'
				? { existed: false }
				: { existed: true, unavailable: true });
		}
	}

	/** Checkpoints with something to undo: their own edits, or a later checkpoint's. */
	restorableIds(): string[] {
		const ids: string[] = [];
		let anyLater = false;
		for (let i = this.checkpoints.length - 1; i >= 0; i--) {
			if (this.checkpoints[i].files.size > 0) {
				anyLater = true;
			}
			if (anyLater) {
				ids.unshift(this.checkpoints[i].id);
			}
		}
		return ids;
	}

	/** What a restore to this checkpoint would touch, for the confirmation. */
	preview(id: string): RestorePreview | undefined {
		const snapshots = this.snapshotsFrom(id);
		if (!snapshots) {
			return undefined;
		}
		const files: string[] = [];
		const unavailable: string[] = [];
		for (const [file, snapshot] of snapshots) {
			(snapshot.unavailable ? unavailable : files).push(file);
		}
		return { files, unavailable };
	}

	/** Put every file back as it was before this checkpoint's message. */
	async restore(id: string): Promise<RestoreResult | undefined> {
		const index = this.checkpoints.findIndex(c => c.id === id);
		const snapshots = this.snapshotsFrom(id);
		if (index < 0 || !snapshots) {
			return undefined;
		}
		const result: RestoreResult = { restored: [], deleted: [], failed: [], unavailable: [] };
		for (const [file, snapshot] of snapshots) {
			try {
				if (snapshot.unavailable) {
					result.unavailable.push(file);
				} else if (snapshot.existed && snapshot.content) {
					await fs.mkdir(path.dirname(file), { recursive: true });
					await fs.writeFile(file, snapshot.content);
					result.restored.push(file);
				} else {
					await fs.rm(file, { force: true });
					result.deleted.push(file);
				}
			} catch {
				result.failed.push(file);
			}
		}
		this.checkpoints = this.checkpoints.slice(0, index);
		this.active = undefined;
		return result;
	}

	/** For each file touched at or after the checkpoint, its earliest snapshot. */
	private snapshotsFrom(id: string): Map<string, FileSnapshot> | undefined {
		const index = this.checkpoints.findIndex(c => c.id === id);
		if (index < 0) {
			return undefined;
		}
		const earliest = new Map<string, FileSnapshot>();
		for (const checkpoint of this.checkpoints.slice(index)) {
			for (const [file, snapshot] of checkpoint.files) {
				if (!earliest.has(file)) {
					earliest.set(file, snapshot);
				}
			}
		}
		return earliest;
	}
}

/** One store for the window: chat turns begin checkpoints, file tools record into them. */
export const agentCheckpoints = new CheckpointStore();
