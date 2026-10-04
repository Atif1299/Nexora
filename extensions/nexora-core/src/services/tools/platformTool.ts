/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Approving a call to a connected platform before it happens.
 *
 * The agent can reach GitHub, Stripe or Linear once the user signs in, and
 * those calls leave the machine and change things the user owns. The MCP
 * specification asks a client to show a tool's inputs to the user *before* the
 * call is made, and to keep a human able to deny it. That is why the engine
 * hands these calls back unexecuted: the model proposes, the user decides, and
 * only then does the engine run it with the credential it already holds.
 *
 * A server's own `readOnlyHint` is shown but never obeyed. The specification
 * is explicit that annotations are untrusted, so a server cannot mark a
 * destructive tool read-only and let itself through. The user's setting is the
 * only thing that can lower the gate, and it says so on the tin.
 */

import * as vscode from 'vscode';

import { getBackendClient } from '../backendClient';
import { getPlatformToolApproval } from '../agentRunMode';
import type { ToolResult } from './executor';

/** Remembered "always allow" choices, keyed `platform__tool`. Session-only. */
const sessionAllowed = new Set<string>();

/** At most this much argument text in the prompt; the rest is in the detail. */
const ARG_PREVIEW_CHARS = 400;

function describeArgs(args: Record<string, unknown>): string {
	const visible = Object.entries(args).filter(([key]) => !key.startsWith('_'));
	if (visible.length === 0) {
		return 'no arguments';
	}
	let text: string;
	try {
		text = JSON.stringify(Object.fromEntries(visible), null, 2);
	} catch {
		text = visible.map(([k]) => k).join(', ');
	}
	return text.length > ARG_PREVIEW_CHARS ? `${text.slice(0, ARG_PREVIEW_CHARS)}…` : text;
}

/**
 * Ask the user whether this call may happen.
 *
 * Modal on purpose. A non-modal notification can be missed, and a request that
 * sends the user's data to a third party should not be approvable by not
 * noticing it.
 */
async function confirm(
	platform: string,
	tool: string,
	args: Record<string, unknown>,
	readOnlyHint: boolean
): Promise<'once' | 'always' | 'deny'> {
	const key = `${platform}__${tool}`;
	const hint = readOnlyHint
		? `${platform} describes this tool as read-only, which Nexora shows but does not rely on.`
		: `This may change data in your ${platform} account.`;

	const choice = await vscode.window.showWarningMessage(
		`Nexora wants to call ${tool} on ${platform}.`,
		{
			modal: true,
			detail: `${hint}\n\nArguments:\n${describeArgs(args)}`
		},
		'Allow once',
		`Always allow ${key}`
	);

	if (choice === 'Allow once') {
		return 'once';
	}
	if (choice && choice.startsWith('Always allow')) {
		return 'always';
	}
	return 'deny';
}

/**
 * Run one platform tool the model asked for, gated by the user's approval.
 *
 * Returns a tool result either way: a denial is an answer the model should see
 * and reason about, not an error that ends the turn.
 */
export async function executePlatformTool(
	platform: string,
	tool: string,
	args: Record<string, unknown>,
	readOnlyHint: boolean
): Promise<ToolResult> {
	const key = `${platform}__${tool}`;
	const mode = getPlatformToolApproval();

	let approved = mode === 'never-ask' || sessionAllowed.has(key);
	if (!approved && mode === 'trust-read-only' && readOnlyHint) {
		approved = true;
	}

	if (!approved) {
		const decision = await confirm(platform, tool, args, readOnlyHint);
		if (decision === 'deny') {
			return {
				success: false,
				error:
					`The user denied the ${tool} call on ${platform}. `
					+ 'Do not retry it; ask what they would like to do instead.'
			};
		}
		if (decision === 'always') {
			sessionAllowed.add(key);
		}
	}

	// Strip the engine's routing fields: they are Nexora's bookkeeping, not
	// arguments the vendor's tool knows anything about.
	const payload: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(args)) {
		if (!k.startsWith('_')) {
			payload[k] = v;
		}
	}

	const result = await getBackendClient().callPlatformTool(platform, tool, payload);
	if (!result.success) {
		return { success: false, error: result.error || `${platform} ${tool} failed` };
	}
	return { success: true, data: result.data };
}
