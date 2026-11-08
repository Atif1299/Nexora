/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import type { ToolResult } from './executor';

// Files above this are refused (logs, dumps); below it a long file is read in parts.
const MAX_FILE_SIZE = 5 * 1024 * 1024;
// Lines returned when no range is given, and the most one call returns.
const DEFAULT_LINES = 2000;
// A single very long line (minified code) is cut so it can't fill the context.
const MAX_LINE_CHARS = 2000;
const SKIP_PATTERNS = ['.env', '.pem', 'credentials', 'secret', '.key'];

function isPathSafe(workspaceRoot: string, filePath: string): boolean {
	const resolved = path.resolve(workspaceRoot, filePath);
	const normalizedRoot = path.resolve(workspaceRoot);

	if (process.platform === 'win32') {
		return resolved.toLowerCase().startsWith(normalizedRoot.toLowerCase() + path.sep) ||
			resolved.toLowerCase() === normalizedRoot.toLowerCase();
	}
	return resolved.startsWith(normalizedRoot + path.sep) || resolved === normalizedRoot;
}

function isSensitiveFile(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	return SKIP_PATTERNS.some(p => lower.includes(p));
}

export async function readFileTool(
	workspaceRoot: string,
	filePath: string,
	startLine?: number,
	endLine?: number
): Promise<ToolResult> {
	// Validate path is inside workspace
	if (!isPathSafe(workspaceRoot, filePath)) {
		return {
			success: false,
			error: `Path '${filePath}' is outside workspace root`
		};
	}

	// Check for sensitive files
	if (isSensitiveFile(filePath)) {
		return {
			success: false,
			error: `Cannot read sensitive file: ${filePath}`
		};
	}

	const fullPath = path.resolve(workspaceRoot, filePath);

	try {
		const stat = await fs.stat(fullPath);

		if (!stat.isFile()) {
			return {
				success: false,
				error: `'${filePath}' is not a file`
			};
		}

		if (stat.size > MAX_FILE_SIZE) {
			return {
				success: false,
				error: `File too large (${Math.round(stat.size / 1024 / 1024)} MB). Search it with grep instead.`
			};
		}

		const raw = await fs.readFile(fullPath);
		if (raw.subarray(0, 8000).includes(0)) {
			return { success: false, error: `'${filePath}' is a binary file.` };
		}
		const lines = raw.toString('utf8').split(/\r?\n/);

		// 1-based, inclusive; at most DEFAULT_LINES per call.
		const first = Math.min(Math.max(1, Math.floor(Number(startLine) || 1)), Math.max(1, lines.length));
		const askedEnd = endLine !== undefined && Number(endLine) >= first ? Math.floor(Number(endLine)) : first + DEFAULT_LINES - 1;
		const last = Math.min(lines.length, askedEnd, first + DEFAULT_LINES - 1);
		const shown = lines.slice(first - 1, last);

		// Format with line numbers (line|text), the form apply_patch errors use too
		const numbered = shown.map((line, i) => {
			const text = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)} [... line cut, ${line.length} characters]` : line;
			return `${first + i}|${text}`;
		}).join('\n');

		const more = last < lines.length;
		return {
			success: true,
			data: {
				path: filePath,
				content: numbered,
				total_lines: lines.length,
				lines_shown: shown.length,
				range: `${first}-${last}`,
				note: more ? `Showing lines ${first}-${last} of ${lines.length}. Call read_file with start_line ${last + 1} to read on.` : undefined
			},
			truncated: more || first > 1
		};
	} catch (err: any) {
		if (err.code === 'ENOENT') {
			return {
				success: false,
				error: `File not found: ${filePath}`
			};
		}
		return {
			success: false,
			error: err.message || String(err)
		};
	}
}
