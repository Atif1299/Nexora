/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Text helpers for the agent's edit tools. No VS Code imports, so they can be
 * checked with plain Node.
 */

/**
 * Match the file's line endings. Models write `\n`; a Windows file has
 * `\r\n`, so an exact find failed on every multi-line edit of such a file.
 */
export function matchLineEndings(content: string, text: string): string {
	if (!content.includes('\r\n') || text.includes('\r\n') || !text.includes('\n')) {
		return text;
	}
	return text.replace(/\r?\n/g, '\r\n');
}

/** 1-based line numbers where each occurrence of `needle` starts. */
export function occurrenceLines(content: string, needle: string): number[] {
	const lines: number[] = [];
	if (!needle) {
		return lines;
	}
	let from = 0;
	for (; ;) {
		const at = content.indexOf(needle, from);
		if (at < 0) {
			break;
		}
		lines.push(content.slice(0, at).split('\n').length);
		from = at + needle.length;
	}
	return lines;
}

function bigrams(text: string): Map<string, number> {
	const grams = new Map<string, number>();
	const s = text.replace(/\s+/g, ' ').trim().toLowerCase();
	for (let i = 0; i < s.length - 1; i++) {
		const g = s.slice(i, i + 2);
		grams.set(g, (grams.get(g) || 0) + 1);
	}
	return grams;
}

/** Dice similarity of two strings, 0..1, ignoring case and runs of whitespace. */
export function similarity(a: string, b: string): number {
	const ga = bigrams(a);
	const gb = bigrams(b);
	let total = 0;
	let shared = 0;
	for (const n of ga.values()) {
		total += n;
	}
	for (const [g, n] of gb) {
		total += n;
		shared += Math.min(n, ga.get(g) || 0);
	}
	return total === 0 ? 0 : (2 * shared) / total;
}

/**
 * For an edit whose old text was not found: the file lines that look most
 * like it, numbered, so the next attempt can copy them exactly. Compares the
 * old text's first non-empty line with every line, then shows the best window.
 */
export function closestMatch(content: string, oldText: string, context: number = 3): string | undefined {
	const fileLines = content.split(/\r?\n/);
	const wanted = oldText.split(/\r?\n/);
	const firstIndex = wanted.findIndex((l) => l.trim().length > 0);
	if (firstIndex < 0 || fileLines.length === 0) {
		return undefined;
	}
	const first = wanted[firstIndex];
	let best = -1;
	let bestScore = 0;
	for (let i = 0; i < fileLines.length; i++) {
		const score = fileLines[i].trim() === first.trim() ? 1 : similarity(fileLines[i], first);
		if (score > bestScore) {
			bestScore = score;
			best = i;
		}
	}
	if (best < 0 || bestScore < 0.5) {
		return undefined;
	}
	const start = Math.max(0, best - firstIndex - context);
	const end = Math.min(fileLines.length, best - firstIndex + wanted.length + context);
	return fileLines.slice(start, end).map((line, i) => `${start + i + 1}|${line}`).join('\n');
}
