/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Slash commands (Phase 3): the composer's built-ins plus the user's own command files
// (.nexora/commands, NEXORA_HOME/commands, .claude/commands, .cursor/commands).
// Pure helpers, no vscode import.

/** Built-in commands; a command file with one of these names is hidden by it. */
export const BUILTIN_SLASH: string[] = ['new', 'chat', 'ask', 'agent', 'plan', 'execute', 'model', 'reindex', 'undo', 'rules', 'customize', 'help'];

const SLASH_RE = /^\/([a-z0-9][a-z0-9_:-]*)(?:\s+([\s\S]*))?$/i;

export interface CustomCommand {
	name: string;
	description?: string;
	argument_hint?: string;
}

/** "/name rest" as {name, args}; undefined when the text is not a slash command. */
export function parseSlash(text: string): { name: string; args: string } | undefined {
	const m = SLASH_RE.exec(String(text || '').trim());
	if (!m) {
		return undefined;
	}
	return { name: m[1].toLowerCase(), args: (m[2] || '').trim() };
}

/** The user's command a message calls, or undefined (built-ins and unknown names are sent as typed). */
export function customCommandFor(text: string, commands: { name: string }[]): { name: string; args: string } | undefined {
	const parsed = parseSlash(text);
	if (!parsed || BUILTIN_SLASH.indexOf(parsed.name) >= 0) {
		return undefined;
	}
	return commands.some((c) => c.name === parsed.name) ? parsed : undefined;
}

/** The /help line listing the user's commands; '' when there are none. */
export function customCommandsHelp(commands: CustomCommand[]): string {
	if (!commands.length) {
		return '';
	}
	const items = commands.map((c) => {
		const hint = c.argument_hint ? ' ' + c.argument_hint : '';
		return '`/' + c.name + hint + '`' + (c.description ? ' ' + c.description : '');
	});
	return '**Your commands:** ' + items.join(', ');
}
