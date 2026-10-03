/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Transport } from './transport';
import type { PlanResponse } from './orchestrate';

export interface TemplateParameter {
	name: string;
	type: string;
	required: boolean;
	default?: unknown;
	description: string;
	choices?: string[];
}

export interface TemplateTask {
	key: string;
	name: string;
	description: string;
	platform: string;
	operation: string;
	params: Record<string, unknown>;
	depends_on: string[];
	when?: string;
}

export interface WorkflowTemplate {
	id: string;
	name: string;
	description: string;
	category: string;
	version: number;
	parameters: TemplateParameter[];
	tasks: TemplateTask[];
	source: 'builtin' | 'user' | 'imported';
	metadata: Record<string, unknown>;
}

export interface InferredParameter {
	name: string;
	source_value: string;
	confidence: number;
	heuristic: string;
	required: boolean;
	description: string;
	suggest_only: boolean;
}

export interface ConfirmedParameter {
	name: string;
	source_value: string;
	type?: string;
	required?: boolean;
	description?: string;
	choices?: string[];
}

export interface SuggestFromPlanResponse {
	plan_id: string;
	parameters: InferredParameter[];
}

export interface SaveFromPlanRequest {
	name: string;
	description?: string;
	category?: string;
	parameters: ConfirmedParameter[];
}

export interface ImportPreview {
	valid: boolean;
	name: string;
	description: string;
	task_count: number;
	platforms: string[];
	platforms_registered: string[];
	platforms_missing: string[];
	env_keys: string[];
	checksum_valid: boolean;
	errors: string[];
}

export interface TemplateListResponse {
	templates: WorkflowTemplate[];
	total: number;
}

export function createWorkflowsApi(transport: Transport) {
	return {
		listTemplates: async (category?: string): Promise<TemplateListResponse> => {
			const qs = category ? `?category=${encodeURIComponent(category)}` : '';
			const response = await transport.getStrict(`/api/workflows/templates${qs}`);
			return {
				templates: response?.templates || [],
				total: response?.total ?? (response?.templates || []).length
			};
		},

		getTemplate: async (templateId: string): Promise<WorkflowTemplate> => {
			return await transport.getStrict(
				`/api/workflows/templates/${encodeURIComponent(templateId)}`
			);
		},

		instantiateTemplate: async (
			templateId: string,
			params: Record<string, unknown> = {},
			userId: string = 'default',
			workspacePath?: string
		): Promise<PlanResponse> => {
			return await transport.post(
				`/api/workflows/templates/${encodeURIComponent(templateId)}/instantiate`,
				{
					...params,
					user_id: userId,
					workspace_path: workspacePath
				}
			);
		},

		deleteTemplate: async (templateId: string): Promise<{ deleted: string }> => {
			return await transport.delete(
				`/api/workflows/templates/${encodeURIComponent(templateId)}`
			);
		},

		suggestFromPlan: async (planId: string): Promise<SuggestFromPlanResponse> => {
			return await transport.post(
				`/api/workflows/templates/from-plan/${encodeURIComponent(planId)}/suggest`,
				{}
			);
		},

		saveFromPlan: async (
			planId: string,
			body: SaveFromPlanRequest
		): Promise<WorkflowTemplate> => {
			return await transport.post(
				`/api/workflows/templates/from-plan/${encodeURIComponent(planId)}`,
				{
					name: body.name,
					description: body.description || '',
					category: body.category || 'custom',
					parameters: body.parameters || []
				}
			);
		},

		exportTemplate: async (templateId: string): Promise<Record<string, unknown>> => {
			return await transport.getStrict(
				`/api/workflows/templates/${encodeURIComponent(templateId)}/export`
			);
		},

		previewImport: async (bundle: Record<string, unknown>): Promise<ImportPreview> => {
			return await transport.post('/api/workflows/templates/import/preview', bundle);
		},

		importTemplate: async (bundle: Record<string, unknown>): Promise<WorkflowTemplate> => {
			return await transport.post('/api/workflows/templates/import', bundle);
		}
	};
}
