/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type WebviewInboundMessage =
	| { type: 'chatWebviewReady' }
	| { type: 'sendMessage'; message: string; model?: string }
	| { type: 'askWorkspace'; message: string; model?: string }
	| { type: 'checkBackend' }
	| { type: 'generateCode'; prompt: string; connector: string }
	| { type: 'connectGitHub' }
	| { type: 'connectVercel' }
	| { type: 'toggleSaas'; provider: 'supabase' | 'stripe' | 'v0' | 'elevenlabs' | 'tavily' }
	| { type: 'openSettings'; section?: string }  // Week 13: SaaS connector settings
	| { type: 'openUrl'; url: string }
	| { type: 'saveFirstRunKey'; provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter'; key: string }
	| { type: 'dismissFirstRunCard' }
	| { type: 'deployProject'; prompt: string; repoName: string; projectName: string }
	| { type: 'checkAuthStatus' }
	| { type: 'generatePlan'; request: string; model?: string }
	| { type: 'newSession' }
	| { type: 'switchSession'; sessionId: string }
	| { type: 'deleteSession'; sessionId: string }
	| { type: 'persistSessionRailWidth'; width: number }
	| { type: 'approvePlan'; planId: string }
	| { type: 'cancelPlan'; planId: string }
	| { type: 'modifyPlan'; planId: string; modification: any }
	| { type: 'getHistory' }
	| { type: 'getRollbackable' }
	| { type: 'rollback'; historyId: number }
	| { type: 'browsePlatforms' }
	| { type: 'indexWorkspace' }
	| { type: 'showEngineOutput' }
	| { type: 'executeRequest'; request: string; model?: string }
	| { type: 'runAgent'; request: string; model?: string }
	| { type: 'stopGeneration' }
	| { type: 'confirmSaveTemplate'; planId: string; name: string; description: string; category: string; parameters: Array<{ name: string; source_value: string; type?: string; required?: boolean; description?: string }> }
	| { type: 'cancelSaveTemplate' }
	| { type: 'acceptSuggestion'; id: string }
	| { type: 'dismissSuggestion'; id: string; permanent: boolean }
	| { type: 'requestSuggestions' }
	| { type: 'requestAtComplete'; prefix: string }
	| { type: 'requestModelPicker' }
	| { type: 'selectModel'; modelId: string };

export type ChatActivityStatus =
	| 'confirming'
	| 'running'
	| 'succeeded'
	| 'failed'
	| 'cancelled'
	| 'timeout';

export type ChatActivityItem = {
	id: string;
	label: string;
	done?: boolean;
	turn?: number;
	totalTurns?: number;
	kind?: 'step' | 'terminal';
	command?: string;
	elapsedMs?: number;
	preview?: string;
	status?: ChatActivityStatus;
	exitCode?: number;
};

export type ChatViewMessage = {
	role: 'user' | 'assistant';
	content: string;
	activity?: ChatActivityItem[];
};

export type WebviewOutboundMessage =
	| { type: 'addMessage'; role: 'user' | 'assistant'; content: string; isLoading: boolean; stopped?: boolean }
	| { type: 'appendToken'; content: string }
	| { type: 'finishMessage' }
	| { type: 'generationRunning'; running: boolean }
	| { type: 'chatActivity'; items: ChatActivityItem[]; caption?: string }
	| { type: 'chatActivityClear' }
	| { type: 'chatActivityFold'; items: ChatActivityItem[] }
	| { type: 'backendStatus'; connected: boolean }
	| { type: 'authStatus'; github: boolean; vercel: boolean; supabase?: boolean; stripe?: boolean; v0?: boolean; elevenlabs?: boolean; tavily?: boolean }
	| { type: 'showPlanApproval'; plan: any }
	| { type: 'loadSession'; sessionId: string; messages: ChatViewMessage[] }
	| { type: 'updateSessions'; sessions: Array<{ id: string; name: string }>; activeSessionId: string }
	| { type: 'taskUpdate'; planId: string; taskId: string; taskName?: string; status: string; result?: any; error?: string; cost?: number }
	| { type: 'taskRetry'; planId: string; taskId: string; taskName?: string; attempt: number; maxAttempts: number; platform: string }
	| { type: 'planCompleted'; planId: string; status: string; actualCost: number }
	| { type: 'planExecutionStarted'; planId: string }
	| { type: 'planExecutionComplete'; planId: string; status: string; tasks: any[]; actualCost: number }
	| { type: 'showSaveTemplate'; planId: string; parameters: any[] }
	| { type: 'showSuggestion'; suggestion: any | null }
	| { type: 'firstRunKeyCard'; show: boolean }
	| { type: 'firstRunKeyResult'; success: boolean; error?: string }
	| {
		type: 'atCompleteResults';
		items: Array<{ icon: string; label: string; path: string; kind: 'file' | 'folder' }>;
	}
	| { type: 'costUpdate'; cost_usd: number; tokens_in: number; tokens_out: number }
	| { type: 'composerSettings'; submitWithCtrlEnter: boolean }
	| {
		type: 'modelPickerState';
		catalog: {
			auto: { id: 'auto'; label: string; resolves_to: string };
			providers: Array<{
				id: string;
				label: string;
				configured: boolean;
				models: Array<{
					id: string;
					label: string;
					context?: number;
					tier: 'free' | 'paid';
					recommended?: boolean;
				}>;
			}>;
		} | null;
		enabledModelIds: string[];
		selectedModelId: string;
		error?: string;
	}
	| { type: 'modelSelected'; modelId: string };

export type ChatInitialState = {
	connected: boolean;
	auth: {
		github: boolean;
		vercel: boolean;
		supabase?: boolean;
		stripe?: boolean;
		v0?: boolean;
		elevenlabs?: boolean;
		tavily?: boolean;
	};
	messages?: ChatViewMessage[];
	sessions?: Array<{ id: string; name: string }>;
	activeSessionId?: string;
	sessionRailWidth?: number;
	submitWithCtrlEnter?: boolean;
	selectedModelId?: string;
};

