/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Your own MCP servers (engine `/api/mcp/my-servers`): the words the panel shows
 * and the Add form's checks. No vscode import, so it can be checked on its own;
 * the webview mirrors the labels.
 */

export type ServerState = 'connected' | 'available' | 'needs_approval' | 'disabled' | 'error';
export type ServerScope = 'user' | 'project' | 'plugin' | 'bundled';
export type Trust = '' | 'ask' | 'trust-read-only' | 'never-ask';

export interface MyServer {
	id: string;
	name: string;
	scope: ServerScope;
	transport: 'http' | 'stdio';
	url: string | null;
	command: string | null;
	args: string[];
	env_keys: string[];
	header_keys: string[];
	enabled: boolean;
	approved: boolean;
	trust: Trust;
	state: ServerState;
	error: string;
	/** Not an error, e.g. renamed because another server has the name. */
	notice?: string;
	/** The ${...} references in its config (what it reads from the engine or the secret store). */
	references?: string[];
	/** What an approval covers; sent back so a file changed since is refused. */
	fingerprint?: string;
	tools: { total: number; enabled: number } | null;
}

export interface MyServers {
	servers: MyServer[];
	config_errors: Record<string, string>;
	workspace: string | null;
}

/** What the engine accepts for add and edit. */
export interface ServerBody {
	name: string;
	scope: 'user' | 'project';
	url?: string;
	command?: string;
	args: string[];
	env: Record<string, string>;
	headers: Record<string, string>;
	trust: Trust;
}

export interface ServerForm {
	name: string;
	kind: 'url' | 'command';
	url: string;
	command: string;
	/** One argument per line. */
	args: string;
	/** KEY=VALUE lines; values that look like credentials are stored encrypted by the engine. */
	env: string;
	headers: string;
	scope: 'user' | 'project';
	trust: Trust;
}

export interface ImportSource {
	id: string;
	label: string;
	path: string;
	error?: string;
	servers: { name: string; transport: string; summary: string; secret_keys: string[]; exists: boolean }[];
}

const STATE_LABELS: Record<ServerState, string> = {
	connected: 'Connected',
	available: 'Not connected',
	needs_approval: 'Needs approval',
	disabled: 'Off',
	error: 'Error'
};

const TRUST_VALUES: Trust[] = ['', 'ask', 'trust-read-only', 'never-ask'];
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;

const TRUST_LABELS: Record<Trust, string> = {
	'': 'your global setting',
	'ask': 'ask every time',
	'trust-read-only': 'run read-only tools without asking',
	'never-ask': 'never ask'
};

/** Everything a project server approval covers, one line each, for the confirmation dialog. */
export function approvalDetail(server: MyServer): string {
	const lines: string[] = [];
	if (server.url) {
		lines.push(`Connects to: ${server.url}`);
	} else {
		lines.push(`Runs: ${[server.command || ''].concat(server.args || []).join(' ')}`);
	}
	if (server.env_keys && server.env_keys.length) {
		lines.push(`Environment: ${server.env_keys.join(', ')}`);
	}
	if (server.header_keys && server.header_keys.length) {
		lines.push(`Headers: ${server.header_keys.join(', ')}`);
	}
	if (server.references && server.references.length) {
		lines.push(`Reads: ${server.references.join(', ')}`);
	}
	lines.push(`Tool calls: ${TRUST_LABELS[server.trust] || TRUST_LABELS['']}`);
	if (server.error) {
		lines.push(`Problem: ${server.error}`);
	}
	return lines.join('\n');
}

export function stateLabel(state: ServerState): string {
	return STATE_LABELS[state] || state;
}

export function scopeLabel(scope: ServerScope): string {
	return scope === 'user' ? 'You' : scope === 'project' ? 'Project' : scope === 'plugin' ? 'Plugin' : 'Built in';
}

/** KEY=VALUE lines (blank lines and # comments skipped); a line without = is reported as bad. */
export function parseKeyValues(text: string): { values: Record<string, string>; bad: string[] } {
	const values: Record<string, string> = {};
	const bad: string[] = [];
	for (const raw of (text || '').split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}
		const at = line.indexOf('=');
		const key = at > 0 ? line.slice(0, at).trim() : '';
		if (!key) {
			bad.push(line);
			continue;
		}
		values[key] = line.slice(at + 1).trim();
	}
	return { values, bad };
}

export function validateForm(form: ServerForm): { errors: string[]; body?: ServerBody } {
	const errors: string[] = [];
	const name = (form.name || '').trim();
	if (!NAME_RE.test(name)) {
		errors.push('Give the server a name: letters, numbers, spaces, dot, dash or underscore.');
	}
	const env = parseKeyValues(form.env);
	const headers = parseKeyValues(form.headers);
	if (env.bad.length || headers.bad.length) {
		errors.push(`Use KEY=VALUE on each line: ${env.bad.concat(headers.bad).join(', ')}`);
	}
	if (TRUST_VALUES.indexOf(form.trust) < 0) {
		errors.push('Choose how calls are approved.');
	}
	const body: ServerBody = {
		name,
		scope: form.scope === 'project' ? 'project' : 'user',
		args: [],
		env: {},
		headers: {},
		trust: form.trust
	};
	if (form.kind === 'url') {
		const url = (form.url || '').trim();
		if (!/^https?:\/\/\S+$/.test(url)) {
			errors.push('The address must start with http:// or https://.');
		}
		body.url = url;
		body.headers = headers.values;
	} else {
		const command = (form.command || '').trim();
		if (!command || /\s/.test(command)) {
			errors.push('Put only the program in Command (for example npx or uvx); arguments go below, one per line.');
		}
		body.command = command;
		body.args = (form.args || '').split(/\r?\n/).map(a => a.trim()).filter(a => a.length > 0);
		body.env = env.values;
	}
	return errors.length ? { errors } : { errors, body };
}

/** Import sources worth showing: ones with servers, or ones that could not be read. */
export function importGroups<T extends { servers: unknown[]; error?: string }>(sources: T[]): T[] {
	return sources.filter(source => source.servers.length > 0 || !!source.error);
}
