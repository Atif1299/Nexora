/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

export interface CostSummary {
	today: number;
	this_week: number;
	this_month: number;
	trend?: string;
}

export interface DailyCostItem {
	date: string;
	cost: number;
}

export interface PlatformCostItem {
	platform: string;
	cost: number;
	percentage: number;
	calls: number;
}

export interface PlatformExecutionStats {
	platform: string;
	total: number;
	successful: number;
	failed: number;
	success_rate: number;
	avg_latency_ms: number;
	total_cost_usd: number;
}

export interface ExecutionStats {
	total_executions: number;
	successful: number;
	failed: number;
	success_rate: number;
	avg_latency_ms: number;
	total_cost_usd: number;
	tokens_input: number;
	tokens_output: number;
	platforms: PlatformExecutionStats[];
}

export interface MemoryFileHit {
	file_path: string;
	count: number;
}

export interface MemoryInsights {
	workspaces_indexed: number;
	total_files: number;
	retrievals_this_week: number;
	avg_latency_ms: number;
	top_files: MemoryFileHit[];
	/** Share of all requests that memory informed. */
	pct_requests_using_memory: number;
	/** Share of memory lookups that returned context. */
	memory_hit_rate: number;
	total_requests: number;
	requests_using_memory: number;
}

export interface RecentExecution {
	task_id: string;
	platform: string;
	operation: string;
	status: string;
	cost_usd: number;
	estimated_cost_usd: number;
	duration_ms: number;
	completed_at: string | null;
}

export interface AnalyticsDashboardData {
	summary: CostSummary;
	daily: DailyCostItem[];
	byPlatform: PlatformCostItem[];
	stats: ExecutionStats;
	memory: MemoryInsights;
	recent: RecentExecution[];
	/** False when the backend could not be reached, so zeros must not be shown as fact. */
	available: boolean;
	error?: string;
}

const emptySummary = (): CostSummary => ({
	today: 0,
	this_week: 0,
	this_month: 0,
	trend: '0%'
});

const emptyStats = (): ExecutionStats => ({
	total_executions: 0,
	successful: 0,
	failed: 0,
	success_rate: 0,
	avg_latency_ms: 0,
	total_cost_usd: 0,
	tokens_input: 0,
	tokens_output: 0,
	platforms: []
});

const emptyMemory = (): MemoryInsights => ({
	workspaces_indexed: 0,
	total_files: 0,
	retrievals_this_week: 0,
	avg_latency_ms: 0,
	top_files: [],
	pct_requests_using_memory: 0,
	memory_hit_rate: 0,
	total_requests: 0,
	requests_using_memory: 0
});

const emptyDashboard = (error: string): AnalyticsDashboardData => ({
	summary: emptySummary(),
	daily: [],
	byPlatform: [],
	stats: emptyStats(),
	memory: emptyMemory(),
	recent: [],
	available: false,
	error
});

export function createAnalyticsApi(transport: Transport) {
	const api = {
		getCostSummary: async (userId: string = 'default'): Promise<CostSummary> => {
			const response = await transport.getStrict(
				`/api/analytics/costs/summary?user_id=${encodeURIComponent(userId)}`
			);
			return response || emptySummary();
		},

		getDailyCosts: async (days: number = 7, userId: string = 'default'): Promise<DailyCostItem[]> => {
			const response = await transport.getStrict(
				`/api/analytics/costs/daily?days=${days}&user_id=${encodeURIComponent(userId)}`
			);
			return response?.data || [];
		},

		getCostsByPlatform: async (userId: string = 'default'): Promise<PlatformCostItem[]> => {
			const response = await transport.getStrict(
				`/api/analytics/costs/by-platform?user_id=${encodeURIComponent(userId)}`
			);
			return response?.data || [];
		},

		getExecutionStats: async (userId: string = 'default'): Promise<ExecutionStats> => {
			const response = await transport.getStrict(
				`/api/analytics/executions/stats?user_id=${encodeURIComponent(userId)}`
			);
			return response || emptyStats();
		},

		getMemoryInsights: async (userId: string = 'default'): Promise<MemoryInsights> => {
			const response = await transport.getStrict(
				`/api/analytics/memory/insights?user_id=${encodeURIComponent(userId)}`
			);
			return { ...emptyMemory(), ...(response || {}) };
		},

		getRecentExecutions: async (limit: number = 10, userId: string = 'default'): Promise<RecentExecution[]> => {
			const response = await transport.getStrict(
				`/api/analytics/executions/recent?limit=${limit}&user_id=${encodeURIComponent(userId)}`
			);
			return response?.data || [];
		},

		getDashboard: async (userId: string = 'default'): Promise<AnalyticsDashboardData> => {
			// One rejected request marks the whole dashboard unavailable rather than
			// leaving some panels populated and others silently zeroed, which would read
			// as "you spent nothing" instead of "we could not ask".
			try {
				const [summary, daily, byPlatform, stats, memory, recent] = await Promise.all([
					api.getCostSummary(userId),
					api.getDailyCosts(7, userId),
					api.getCostsByPlatform(userId),
					api.getExecutionStats(userId),
					api.getMemoryInsights(userId),
					api.getRecentExecutions(10, userId)
				]);
				return { summary, daily, byPlatform, stats, memory, recent, available: true };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return emptyDashboard(message);
			}
		}
	};

	return api;
}
