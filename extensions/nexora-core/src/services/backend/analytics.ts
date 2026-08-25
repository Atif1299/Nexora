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
	pct_requests_using_memory: number;
}

export interface AnalyticsDashboardData {
	summary: CostSummary;
	daily: DailyCostItem[];
	byPlatform: PlatformCostItem[];
	stats: ExecutionStats;
	memory: MemoryInsights;
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
	pct_requests_using_memory: 0
});

export function createAnalyticsApi(transport: Transport) {
	return {
		getCostSummary: async (userId: string = 'default'): Promise<CostSummary> => {
			try {
				const response = await transport.get(
					`/api/analytics/costs/summary?user_id=${encodeURIComponent(userId)}`
				);
				return response || emptySummary();
			} catch {
				return emptySummary();
			}
		},

		getDailyCosts: async (days: number = 7, userId: string = 'default'): Promise<DailyCostItem[]> => {
			try {
				const response = await transport.get(
					`/api/analytics/costs/daily?days=${days}&user_id=${encodeURIComponent(userId)}`
				);
				return response?.data || [];
			} catch {
				return [];
			}
		},

		getCostsByPlatform: async (userId: string = 'default'): Promise<PlatformCostItem[]> => {
			try {
				const response = await transport.get(
					`/api/analytics/costs/by-platform?user_id=${encodeURIComponent(userId)}`
				);
				return response?.data || [];
			} catch {
				return [];
			}
		},

		getExecutionStats: async (userId: string = 'default'): Promise<ExecutionStats> => {
			try {
				const response = await transport.get(
					`/api/analytics/executions/stats?user_id=${encodeURIComponent(userId)}`
				);
				return response || emptyStats();
			} catch {
				return emptyStats();
			}
		},

		getMemoryInsights: async (userId: string = 'default'): Promise<MemoryInsights> => {
			try {
				const response = await transport.get(
					`/api/analytics/memory/insights?user_id=${encodeURIComponent(userId)}`
				);
				return response || emptyMemory();
			} catch {
				return emptyMemory();
			}
		},

		getDashboard: async (userId: string = 'default'): Promise<AnalyticsDashboardData> => {
			const api = createAnalyticsApi(transport);
			const [summary, daily, byPlatform, stats, memory] = await Promise.all([
				api.getCostSummary(userId),
				api.getDailyCosts(7, userId),
				api.getCostsByPlatform(userId),
				api.getExecutionStats(userId),
				api.getMemoryInsights(userId)
			]);
			return { summary, daily, byPlatform, stats, memory };
		}
	};
}
