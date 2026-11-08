/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Where a platform can be used, as the engine derives it (GET /api/platforms/usage).
 *
 * The Platforms panel used to show "Ready" for rows nothing could call. The
 * engine now says, per row, where it works (chat, agent, plans, models, code
 * steps) and whether it is usable at all; this module turns that into what the
 * panel shows. No vscode import, so it can be checked on its own.
 *
 * An engine older than this API answers 404; every row then has no usage and
 * the panel behaves as it did before (every row in the main list).
 */

export type UsageState = 'connected' | 'available' | 'unavailable' | 'discover';

export interface ToolCounts {
	total: number;
	read: number;
	write: number;
	destructive: number;
	enabled: number;
}

export interface PlatformUsage {
	usable_in: string[];
	state: UsageState;
	reason: string;
	tools: ToolCounts | null;
	undo: boolean;
	listed: boolean;
}

export type PanelSection = 'main' | 'discover' | 'hidden';

const LABELS: Record<string, string> = {
	chat: 'Chat',
	agent: 'Agent',
	plans: 'Plans',
	models: 'Models',
	code_steps: 'Code steps'
};

export function usageFor(id: string, report: Record<string, PlatformUsage> | undefined): PlatformUsage | undefined {
	if (!report) {
		return undefined;
	}
	return report[(id || '').trim().toLowerCase()];
}

/** Main list, the folded Discover section, or not shown at all. */
export function section(row: { usage?: PlatformUsage }): PanelSection {
	const usage = row.usage;
	if (!usage) {
		return 'main';
	}
	if (usage.listed === false) {
		return 'hidden';
	}
	return usage.state === 'discover' ? 'discover' : 'main';
}

export function useInLabels(usage: PlatformUsage | undefined): string[] {
	if (!usage || !Array.isArray(usage.usable_in)) {
		return [];
	}
	return usage.usable_in.map(key => LABELS[key] || key);
}

/** "12 tools, read only" or "11 of 12 tools on, 3 can change things"; empty before the tools are known. */
export function toolSummary(usage: PlatformUsage | undefined): string {
	const tools = usage?.tools;
	if (!tools || !tools.total) {
		return '';
	}
	const changing = tools.write + tools.destructive;
	const count = tools.enabled === tools.total ? `${tools.total} tools` : `${tools.enabled} of ${tools.total} tools on`;
	return changing ? `${count}, ${changing} can change things` : `${count}, read only`;
}
