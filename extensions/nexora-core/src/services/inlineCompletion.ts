/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Grey text ahead of the cursor.
 *
 * The model is the least interesting part of this. What makes a completion
 * feel immediate is not asking for one: when a developer types the characters
 * that were already suggested, the right answer is the rest of the suggestion
 * we are already holding, served without touching the network. That one case
 * covers most keystrokes inside an accepted suggestion, and it is the
 * difference between grey text that keeps up and grey text that stutters.
 *
 * Everything else exists to stop work that has been overtaken:
 * - a debounce, so a burst of typing produces one request rather than ten;
 * - an abort of the request in flight the moment a newer one starts;
 * - a small token budget, because a long suggestion arrives too late to read.
 */

import * as vscode from 'vscode';

import { getBackendClient } from './backendClient';

/** What was last suggested, kept to answer the next keystroke locally. */
interface CachedSuggestion {
	uri: string;
	/** Document text before the cursor when this was produced. */
	prefix: string;
	completion: string;
}

const CONFIG_SECTION = 'nexora';
/** Sent either side of the cursor; the engine trims further. */
const PREFIX_CHARS = 2000;
const SUFFIX_CHARS = 600;

function config(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

function sleep(ms: number, token: vscode.CancellationToken): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		token.onCancellationRequested(() => {
			clearTimeout(timer);
			resolve();
		});
	});
}

/**
 * Drop any part of the suggestion the document already contains.
 *
 * Without this, completing before an existing `)` or `;` leaves the character
 * duplicated once the suggestion is accepted.
 */
function trimAgainstLine(completion: string, lineAfterCursor: string): string {
	const rest = lineAfterCursor.trim();
	if (!rest || !completion) {
		return completion;
	}
	if (completion.endsWith(rest)) {
		return completion.slice(0, -rest.length);
	}
	return completion;
}

class NexoraInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private cached: CachedSuggestion | undefined;
	private inFlight: AbortController | undefined;

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken
	): Promise<vscode.InlineCompletionItem[] | undefined> {
		if (config().get<boolean>('inlineCompletion.enabled', true) !== true) {
			return undefined;
		}
		// The suggest widget is already proposing something concrete. Two
		// overlapping proposals for one cursor is noise, so stand down.
		if (context.selectedCompletionInfo) {
			return undefined;
		}

		const offset = document.offsetAt(position);
		const text = document.getText();
		const prefix = text.slice(0, offset);
		const suffix = text.slice(offset);

		const reused = this.reuseCached(document, prefix);
		if (reused !== undefined) {
			return [new vscode.InlineCompletionItem(reused)];
		}

		// Nothing cached applies, so this will cost a request. Wait first: if
		// the developer is mid-word, the next keystroke invalidates it anyway.
		const debounce = config().get<number>('inlineCompletion.debounceMs', 200);
		if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic && debounce > 0) {
			await sleep(debounce, token);
			if (token.isCancellationRequested) {
				return undefined;
			}
		}

		this.inFlight?.abort();
		const controller = new AbortController();
		this.inFlight = controller;
		token.onCancellationRequested(() => controller.abort());

		const result = await getBackendClient().inlineComplete(
			{
				prefix: prefix.slice(-PREFIX_CHARS),
				suffix: suffix.slice(0, SUFFIX_CHARS),
				language: document.languageId,
				path: vscode.workspace.asRelativePath(document.uri, false),
				model: config().get<string>('inlineCompletion.model') || undefined,
				maxTokens: config().get<number>('inlineCompletion.maxTokens', 64)
			},
			controller.signal
		);

		if (this.inFlight === controller) {
			this.inFlight = undefined;
		}
		if (token.isCancellationRequested || !result.completion) {
			return undefined;
		}

		const completion = trimAgainstLine(
			result.completion,
			document.lineAt(position.line).text.slice(position.character)
		);
		if (!completion.trim()) {
			return undefined;
		}

		this.cached = { uri: document.uri.toString(), prefix, completion };
		return [new vscode.InlineCompletionItem(completion)];
	}

	/**
	 * Serve the remainder of the last suggestion, when the developer has been
	 * typing exactly what it proposed.
	 *
	 * Returns undefined when the cache cannot answer, which is the signal to
	 * go and ask. An empty string is never returned: that would mean the
	 * suggestion has been fully typed out, and there is nothing left to show.
	 */
	private reuseCached(document: vscode.TextDocument, prefix: string): string | undefined {
		const cached = this.cached;
		if (!cached || cached.uri !== document.uri.toString()) {
			return undefined;
		}
		if (prefix === cached.prefix) {
			return cached.completion;
		}
		if (!prefix.startsWith(cached.prefix)) {
			return undefined;
		}
		const typed = prefix.slice(cached.prefix.length);
		if (!cached.completion.startsWith(typed)) {
			// They typed something else; the suggestion is stale.
			this.cached = undefined;
			return undefined;
		}
		const remainder = cached.completion.slice(typed.length);
		return remainder.length > 0 ? remainder : undefined;
	}

	dispose(): void {
		this.inFlight?.abort();
		this.cached = undefined;
	}
}

/** Register the provider for every file the editor opens. */
export function registerInlineCompletion(context: vscode.ExtensionContext): void {
	const provider = new NexoraInlineCompletionProvider();
	context.subscriptions.push(
		provider,
		vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider)
	);
}
