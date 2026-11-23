/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * One changed block: `added` lines starting at line `start` of the new text
 * (0-based) replaced the `removed` lines of the old text. Either can be empty.
 */
export interface LineChange {
	start: number;
	added: number;
	removed: string[];
}

/** Past this many cells the middle part is treated as one changed block. */
const MAX_TABLE = 4_000_000;

function splitLines(text: string): string[] {
	return text.length === 0 ? [] : text.replace(/\r\n/g, '\n').split('\n');
}

/** The changed blocks between two versions of a file, by line. */
export function diffLines(oldText: string, newText: string): LineChange[] {
	const a = splitLines(oldText);
	const b = splitLines(newText);
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
		prefix++;
	}
	let suffix = 0;
	while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
		suffix++;
	}
	const oldMid = a.slice(prefix, a.length - suffix);
	const newMid = b.slice(prefix, b.length - suffix);
	if (oldMid.length === 0 && newMid.length === 0) {
		return [];
	}
	if (oldMid.length === 0 || newMid.length === 0 || (oldMid.length + 1) * (newMid.length + 1) > MAX_TABLE) {
		return [{ start: prefix, added: newMid.length, removed: oldMid }];
	}

	// Longest common subsequence table, filled from the end so the walk below goes forward.
	const n = oldMid.length;
	const m = newMid.length;
	const width = m + 1;
	const table = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i * width + j] = oldMid[i] === newMid[j]
				? table[(i + 1) * width + j + 1] + 1
				: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
		}
	}

	const changes: LineChange[] = [];
	let current: LineChange | undefined;
	const flush = () => {
		if (current) {
			changes.push(current);
			current = undefined;
		}
	};
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && oldMid[i] === newMid[j]) {
			flush();
			i++;
			j++;
			continue;
		}
		if (!current) {
			current = { start: prefix + j, added: 0, removed: [] };
		}
		if (j < m && (i >= n || table[i * width + j + 1] >= table[(i + 1) * width + j])) {
			current.added++;
			j++;
		} else {
			current.removed.push(oldMid[i]);
			i++;
		}
	}
	flush();
	return changes;
}
