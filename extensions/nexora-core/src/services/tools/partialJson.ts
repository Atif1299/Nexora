/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A string field read from unfinished JSON: its text so far, and whether its closing quote arrived. */
export interface PartialField {
	value: string;
	complete: boolean;
}

const SIMPLE_ESCAPES: Record<string, string> = {
	'"': '"',
	'\\': '\\',
	'/': '/',
	b: '\b',
	f: '\f',
	n: '\n',
	r: '\r',
	t: '\t'
};

function isSpace(ch: string): boolean {
	return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

/**
 * Read a JSON string starting at the opening quote. Stops early, without
 * error, when the text ends (also inside an escape), and reports how far it got.
 */
function readString(text: string, start: number): { value: string; complete: boolean; end: number } {
	let value = '';
	let i = start + 1;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '"') {
			return { value, complete: true, end: i + 1 };
		}
		if (ch !== '\\') {
			value += ch;
			i += 1;
			continue;
		}
		if (i + 1 >= text.length) {
			break;
		}
		const next = text[i + 1];
		if (next === 'u') {
			const hex = text.slice(i + 2, i + 6);
			if (hex.length < 4) {
				break;
			}
			value += String.fromCharCode(parseInt(hex, 16));
			i += 6;
			continue;
		}
		value += SIMPLE_ESCAPES[next] ?? next;
		i += 2;
	}
	return { value, complete: false, end: text.length };
}

/**
 * The string fields of a flat JSON object that is still being streamed,
 * e.g. the arguments of a write_file call. Other value types are skipped.
 */
export function readPartialJsonStrings(text: string): Record<string, PartialField> {
	const fields: Record<string, PartialField> = {};
	let i = 0;
	const skipSpace = () => {
		while (i < text.length && isSpace(text[i])) {
			i += 1;
		}
	};
	skipSpace();
	if (text[i] !== '{') {
		return fields;
	}
	i += 1;
	while (i < text.length) {
		skipSpace();
		if (text[i] === ',') {
			i += 1;
			continue;
		}
		if (text[i] !== '"') {
			break;
		}
		const key = readString(text, i);
		if (!key.complete) {
			break;
		}
		i = key.end;
		skipSpace();
		if (text[i] !== ':') {
			break;
		}
		i += 1;
		skipSpace();
		if (i >= text.length) {
			break;
		}
		if (text[i] === '"') {
			const value = readString(text, i);
			fields[key.value] = { value: value.value, complete: value.complete };
			if (!value.complete) {
				break;
			}
			i = value.end;
			continue;
		}
		if (text[i] === '{' || text[i] === '[') {
			break;
		}
		while (i < text.length && text[i] !== ',' && text[i] !== '}') {
			i += 1;
		}
	}
	return fields;
}
