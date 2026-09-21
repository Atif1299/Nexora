/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';

/** Plan generation runs two LLM calls plus best-effort memory; default 30s is too short. */
const PLAN_TIMEOUT_MS = 120_000;

export interface ExecutionTask {
	task_id: string;
	name: string;
	description: string;
	platform: string;
	operation: string;
	dependencies: string[];
	status: string;
	estimated_cost: number;
	actual_cost: number;
	result?: any;
	error?: string;
}

export interface PlanResponse {
	plan_id: string;
	status: string;
	tasks: ExecutionTask[];
	estimated_cost: number;
	estimated_total_cost?: number;
	user_request?: string;
	message: string;
	cost_breakdown?: Array<{
		task: string;
		platform: string;
		operation: string;
		estimated_cost: number;
	}>;
}

export interface PlanModification {
	remove_tasks?: string[];
	reorder?: string[];
	update_platform?: Record<string, string>;
}

export function createOrchestrateApi(transport: Transport) {
	return {
		deployGeneratedCode: async (
			prompt: string,
			repoName: string,
			projectName: string,
			userId: string = 'default'
		): Promise<{
			success: boolean;
			steps: Array<{ step: string; success: boolean; error?: string; data?: any }>;
			deployment_url?: string;
		}> => {
			try {
				return await transport.post('/api/orchestrate/deploy', {
					prompt,
					repo_name: repoName,
					project_name: projectName,
					user_id: userId
				});
			} catch (error) {
				return {
					success: false,
					steps: [{
						step: 'error',
						success: false,
						error: error instanceof Error ? error.message : 'Deployment failed'
					}]
				};
			}
		},

		generatePlan: async (
			request: string,
			userId: string = 'default',
			workspacePath?: string,
			model?: string,
			options?: { session_id?: string; workspace_id?: string }
		): Promise<PlanResponse> => {
			const body: {
				request: string;
				user_id: string;
				workspace_path?: string;
				model?: string;
				session_id?: string;
				workspace_id?: string;
			} = {
				request,
				user_id: userId,
				workspace_path: workspacePath,
				model
			};
			if (options?.session_id) {
				body.session_id = options.session_id;
			}
			if (options?.workspace_id) {
				body.workspace_id = options.workspace_id;
			}
			return await transport.post('/api/orchestrate/plan', body, PLAN_TIMEOUT_MS);
		},

		submitTaskResult: async (payload: {
			plan_id: string;
			task_id: string;
			success: boolean;
			summary: string;
			files: string[];
		}): Promise<{ ok?: boolean }> => {
			return await transport.post('/api/orchestrate/task-result', payload);
		},

		getPlan: async (planId: string): Promise<any> => {
			return await transport.get(`/api/orchestrate/plan/${planId}`);
		},

		approvePlan: async (planId: string): Promise<{
			plan_id: string;
			status: string;
			tasks: ExecutionTask[];
			actual_cost: number;
			/** What the approval card quoted, so the result can be compared against it. */
			estimated_cost?: number;
			/** actual - estimated. Negative means it came in under the quote. */
			cost_delta?: number;
			message: string;
		}> => {
			return await transport.post(`/api/orchestrate/approve/${planId}`, {});
		},

		cancelPlan: async (planId: string): Promise<{
			plan_id: string;
			status: string;
			message: string;
		}> => {
			return await transport.post(`/api/orchestrate/cancel/${planId}`, {});
		},

		modifyPlan: async (
			planId: string,
			modification: PlanModification
		): Promise<PlanResponse> => {
			return await transport.post(`/api/orchestrate/modify/${planId}`, modification);
		},

		estimatePlan: async (
			request: string,
			userId: string = 'default',
			workspacePath?: string,
			model?: string
		): Promise<PlanResponse> => {
			return await transport.post('/api/orchestrate/estimate', {
				request,
				user_id: userId,
				workspace_path: workspacePath,
				model
			}, PLAN_TIMEOUT_MS);
		},

		listPlans: async (userId?: string): Promise<{
			count: number;
			plans: Array<{
				plan_id: string;
				status: string;
				user_request: string;
				task_count: number;
				estimated_cost: number;
				created_at: string;
			}>;
		}> => {
			const url = userId
				? `/api/orchestrate/plans?user_id=${encodeURIComponent(userId)}`
				: '/api/orchestrate/plans';
			return await transport.get(url);
		}
	};
}

