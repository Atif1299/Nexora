/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Composer effort: how hard the model thinks (engine services/llm.py:effort_kwargs). */
export type Effort = 'fast' | 'balanced' | 'thorough';
/** Same values as the nexora.agent.runMode setting. */
export type RunMode = 'ask' | 'auto-edit' | 'allowlist' | 'run-everything';
/** Context the user attached in the composer; sent with the message and cleared after. */
export interface ContextTag {
	kind: 'file' | 'folder' | 'selection';
	label: string;
	path?: string;
	text?: string;
}
/** Pages the chat rail and welcome cards can open. */
export type ChatPage = 'recipes' | 'platforms' | 'customize';
/** One row of the chat list; the webview groups rows by updatedAt. */
export type ChatSessionSummary = { id: string; name: string; createdAt: number; updatedAt: number };
/** What every composer send carries besides the text. */
type ComposerExtras = { model?: string; effort?: Effort; context?: ContextTag[] };

export type WebviewInboundMessage =
	| { type: 'chatWebviewReady' }
	| ({ type: 'sendMessage'; message: string } & ComposerExtras)
	| ({ type: 'askWorkspace'; message: string } & ComposerExtras)
	| { type: 'checkBackend' }
	| { type: 'generateCode'; prompt: string; connector: string }
	| { type: 'connectGitHub' }
	| { type: 'connectVercel' }
	| { type: 'toggleSaas'; provider: 'supabase' | 'stripe' | 'v0' | 'elevenlabs' | 'tavily' }
	| { type: 'openSettings'; section?: string }  // Week 13: SaaS connector settings
	| { type: 'openUrl'; url: string }
	| { type: 'saveFirstRunKey'; provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter'; key: string }
	| { type: 'dismissFirstRunCard' }
	| { type: 'cloudSignIn' }
	| { type: 'deployProject'; prompt: string; repoName: string; projectName: string }
	| { type: 'checkAuthStatus' }
	| ({ type: 'generatePlan'; request: string } & ComposerExtras)
	| { type: 'newSession' }
	| { type: 'switchSession'; sessionId: string }
	| { type: 'deleteSession'; sessionId: string }
	| { type: 'renameSession'; sessionId: string; name: string }
	| { type: 'persistSessionRailWidth'; width: number }
	/** Rail nav and welcome cards; the host maps each page to one fixed command. */
	| { type: 'openPage'; page: ChatPage }
	| { type: 'approvePlan'; planId: string }
	| { type: 'cancelPlan'; planId: string }
	| { type: 'modifyPlan'; planId: string; modification: any }
	/** A plan step's readiness fix, e.g. "connect:github" or "open-folder". */
	| { type: 'runFix'; fix: string }
	/** New inputs for a step that needs input; the engine validates them again. */
	| { type: 'updateStepInputs'; planId: string; taskId: string; inputs: Record<string, unknown> }
	| { type: 'getRollbackable' }
	| { type: 'rollback'; historyId: number }
	| { type: 'indexWorkspace' }
	| { type: 'showEngineOutput' }
	| ({ type: 'executeRequest'; request: string } & ComposerExtras)
	| ({ type: 'runAgent'; request: string } & ComposerExtras)
	| { type: 'restoreCheckpoint'; id: string }
	/** Edit or retry: drop the ordinal-th user message and everything after it, then send `text`. */
	| { type: 'rewindTo'; ordinal: number; text: string }
	| { type: 'retryPlanTask'; planId: string; taskId: string }
	| { type: 'stopGeneration' }
	| { type: 'confirmSaveTemplate'; planId: string; name: string; description: string; category: string; parameters: Array<{ name: string; source_value: string; type?: string; required?: boolean; description?: string }> }
	| { type: 'cancelSaveTemplate' }
	| { type: 'acceptSuggestion'; id: string }
	| { type: 'dismissSuggestion'; id: string; permanent: boolean }
	| { type: 'requestSuggestions' }
	| { type: 'requestAtComplete'; prefix: string }
	| { type: 'requestModelPicker' }
	| { type: 'selectModel'; modelId: string }
	| { type: 'setRunMode'; runMode: RunMode }
	| { type: 'setEffort'; effort: Effort }
	| { type: 'runSlash'; command: string; rest: string }
	| { type: 'requestCustomCommands' }
	| { type: 'requestSelection' }
	| { type: 'requestOpenEditors' }
	| { type: 'requestFolder' };

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
	| { type: 'updateSessions'; sessions: ChatSessionSummary[]; activeSessionId: string }
	| { type: 'sessionRail'; hidden: boolean }
	| { type: 'taskUpdate'; planId: string; taskId: string; taskName?: string; status: string; result?: any; error?: string; cost?: number }
	| { type: 'taskRetry'; planId: string; taskId: string; taskName?: string; attempt: number; maxAttempts: number; platform: string }
	| { type: 'planCompleted'; planId: string; status: string; actualCost: number }
	| { type: 'planExecutionStarted'; planId: string }
	| { type: 'planApproveFailed'; planId: string; message: string }
	| { type: 'planExecutionComplete'; planId: string; status: string; tasks: any[]; actualCost: number }
	| { type: 'showSaveTemplate'; planId: string; parameters: any[] }
	| { type: 'showSuggestion'; suggestion: any | null }
	| { type: 'firstRunKeyCard'; show: boolean }
	| { type: 'composerState'; runMode: RunMode; effort: Effort; hasSelection: boolean }
	| { type: 'contextTags'; tags: ContextTag[] }
	| { type: 'openModelMenu' }
	| { type: 'firstRunKeyResult'; success: boolean; error?: string }
	| {
		type: 'atCompleteResults';
		items: Array<{ icon: string; label: string; path: string; kind: 'file' | 'folder' }>;
	}
	| { type: 'costUpdate'; cost_usd: number; tokens_in: number; tokens_out: number; tokens_cached?: number }
	/** The latest user message's checkpoint: agent edits after it can be restored. */
	| { type: 'checkpointStarted'; id: string }
	/** Checkpoints with something to undo; the chat shows Restore on those messages. */
	| { type: 'checkpoints'; restorable: string[] }
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
	sessions?: ChatSessionSummary[];
	activeSessionId?: string;
	sessionRailWidth?: number;
	sessionRailHidden?: boolean;
	submitWithCtrlEnter?: boolean;
	selectedModelId?: string;
};

