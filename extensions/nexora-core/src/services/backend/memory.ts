/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

export interface MemorySuggestion {
	id: string;
	title: string;
	reason: string;
	confidence: number;
	target_template_id?: string | null;
	target_operation: string;
	target_platform: string;
	estimated_cost: number;
	dismiss_key: string;
}

export interface SuggestionsResponse {
	workspace_id: string;
	suggestions: MemorySuggestion[];
}

export interface DismissSuggestionResponse {
	ok: boolean;
	id: string;
	workspace_id: string;
	permanent: boolean;
	expires_at?: string | null;
}

export interface AcceptSuggestionResponse {
	plan_id: string;
	status: string;
	tasks: unknown[];
	estimated_cost: number;
	estimated_total_cost?: number;
	user_request?: string;
	message: string;
	cost_breakdown?: unknown[];
	source?: string;
	template_id?: string | null;
}

export interface TimelineEvent {
	type: string;
	at: string;
	summary: string;
	workflow_id?: string | null;
	status?: string | null;
	cost_usd?: number | null;
	platform?: string | null;
	operation?: string | null;
	session_id?: string | null;
}

export interface TimelineEntry {
	id: string;
	workspace_id: string;
	path: string;
	created_at: string;
	file_count: number;
	events: TimelineEvent[];
	summary: string;
	is_newest: boolean;
	trigger?: string | null;
	files?: string[];
}

export interface TimelineResponse {
	workspace_id: string;
	snapshots: TimelineEntry[];
	total: number;
}

export interface TimelineDiff {
	from_id: string;
	to_id: string;
	workspace_id: string;
	added: string[];
	removed: string[];
	modified: string[];
	modified_status: string;
}

export function createMemoryApi(transport: Transport) {
	return {
		indexWorkspace: async (workspacePath: string): Promise<any> => {
			try {
				return await transport.post('/api/memory/index', { workspace_path: workspacePath });
			} catch (error) {
				// preserve existing behavior: log + rethrow
				console.error('Failed to index workspace:', error);
				throw error;
			}
		},

		queryMemory: async (workspaceId: string, query: string, limit: number = 5): Promise<any> => {
			return await transport.get(
				`/api/memory/query?workspace_id=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(query)}&limit=${limit}`
			);
		},

		getWorkspaceIdForPath: async (workspacePath: string): Promise<{ workspace_path: string; workspace_id: string }> => {
			return await transport.get(
				`/api/memory/workspace-id?workspace_path=${encodeURIComponent(workspacePath)}`
			);
		},

		getTaskContext: async (workspaceId: string, task: string): Promise<any> => {
			try {
				return await transport.get(
					`/api/memory/context?workspace_id=${encodeURIComponent(workspaceId)}&task=${encodeURIComponent(task)}`
				);
			} catch {
				return { relevant_files: [], code_snippets: [], languages_involved: [], total_matches: 0 };
			}
		},

		listIndexedWorkspaces: async (): Promise<any[]> => {
			try {
				const response = await transport.get('/api/memory/workspaces');
				return response?.workspaces || [];
			} catch {
				return [];
			}
		},

		getSuggestions: async (
			workspaceId: string,
			workspacePath?: string,
			userId?: string
		): Promise<SuggestionsResponse> => {
			const qs = new URLSearchParams({ workspace_id: workspaceId });
			if (workspacePath) {
				qs.set('workspace_path', workspacePath);
			}
			if (userId) {
				qs.set('user_id', userId);
			}
			const response = await transport.getStrict(`/api/memory/suggestions?${qs.toString()}`);
			return {
				workspace_id: response?.workspace_id || workspaceId,
				suggestions: response?.suggestions || []
			};
		},

		dismissSuggestion: async (
			suggestionId: string,
			workspaceId: string,
			permanent: boolean = false
		): Promise<DismissSuggestionResponse> => {
			return await transport.post(
				`/api/memory/suggestions/${encodeURIComponent(suggestionId)}/dismiss`,
				{ workspace_id: workspaceId, permanent }
			);
		},

		acceptSuggestion: async (
			suggestionId: string,
			workspaceId: string,
			workspacePath?: string,
			userId: string = 'default',
			params: Record<string, unknown> = {}
		): Promise<AcceptSuggestionResponse> => {
			return await transport.post(
				`/api/memory/suggestions/${encodeURIComponent(suggestionId)}/accept`,
				{
					workspace_id: workspaceId,
					workspace_path: workspacePath,
					user_id: userId,
					params
				}
			);
		},

		getTimeline: async (workspaceId: string): Promise<TimelineResponse> => {
			const response = await transport.getStrict(
				`/api/memory/timeline?workspace_id=${encodeURIComponent(workspaceId)}`
			);
			return {
				workspace_id: response?.workspace_id || workspaceId,
				snapshots: response?.snapshots || [],
				total: response?.total ?? (response?.snapshots || []).length
			};
		},

		getTimelineSnapshot: async (
			snapshotId: string,
			workspaceId?: string
		): Promise<TimelineEntry> => {
			const qs = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
			return await transport.getStrict(
				`/api/memory/timeline/${encodeURIComponent(snapshotId)}${qs}`
			);
		},

		getTimelineDiff: async (
			fromId: string,
			toId: string,
			workspaceId?: string
		): Promise<TimelineDiff> => {
			const qs = new URLSearchParams({ from: fromId, to: toId });
			if (workspaceId) {
				qs.set('workspace_id', workspaceId);
			}
			return await transport.getStrict(`/api/memory/timeline/diff?${qs.toString()}`);
		}
	};
}

