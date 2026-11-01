/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ChatInitialState } from './types';

import { renderWebviewPage } from '../shared/html';

export function getChatWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	initialState: ChatInitialState
): string {
	return renderWebviewPage({
		webview,
		extensionUri,
		folder: 'chat',
		title: 'Nexora Chat',
		styles: ['chat.css'],
		scripts: ['composer.js', 'chat.js'],
		// chat.js reads this as it initializes; without it the panel renders
		// as disconnected and signed out until the first push arrives.
		initialState,
		body: /* html */ `	<div class="nx-root">
		<div class="nx-conversation">
		<header class="nx-header">
			<div class="nx-status">
				<span class="nx-dot" id="statusDot" aria-hidden="true"></span>
				<span class="nx-statusText" id="statusText">Checking backend...</span>
			</div>
		</header>

		<div class="nx-suggest" id="suggestionStrip" hidden>
			<span class="nx-suggestIcon" aria-hidden="true">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
					<circle cx="12" cy="12" r="9"/>
					<path d="M12 8v4l2.5 2.5"/>
				</svg>
			</span>
			<div class="nx-suggestBody">
				<div class="nx-suggestTitle" id="suggestTitle"></div>
				<div class="nx-suggestReason" id="suggestReason"></div>
			</div>
			<div class="nx-suggestActions">
				<button type="button" class="nx-suggestRun" id="suggestRun">Run</button>
				<button type="button" class="nx-suggestLater" id="suggestLater">Not now</button>
				<button type="button" class="nx-suggestNever" id="suggestNever">Never</button>
			</div>
		</div>

		<div class="nx-firstRun" id="firstRunCard" hidden>
			<div class="nx-firstRunBody">
				<div class="nx-firstRunTitle">Start chatting</div>
				<div class="nx-firstRunSub">Sign in with GitHub to use Nexora Cloud: $1 of free credit, no API keys needed.</div>
				<button type="button" class="nx-firstRunCloud" id="firstRunCloud">Sign in with GitHub</button>
				<div class="nx-firstRunOr">Or use your own provider key:</div>
				<div class="nx-firstRunRow">
					<label class="sr-only" for="firstRunProvider">Provider</label>
					<select id="firstRunProvider" class="nx-firstRunSelect" aria-label="LLM provider">
						<option value="openrouter">OpenRouter</option>
						<option value="openai">OpenAI</option>
						<option value="anthropic">Anthropic</option>
						<option value="gemini">Gemini</option>
					</select>
					<input class="nx-firstRunInput" type="password" id="firstRunKey" autocomplete="off" spellcheck="false" placeholder="Paste API key…" aria-label="API key" />
				</div>
				<div class="nx-firstRunActions">
					<button type="button" class="nx-firstRunSave" id="firstRunSave">Save key</button>
					<button type="button" class="nx-firstRunSettings" id="firstRunSettings">Open Settings</button>
					<button type="button" class="nx-firstRunDismiss" id="firstRunDismiss" title="Dismiss">Not now</button>
				</div>
				<div class="nx-firstRunMsg" id="firstRunMsg" role="status"></div>
			</div>
		</div>

		<main class="nx-main">
			<section class="nx-messages" id="messages" aria-label="Messages">
				<div class="nx-welcome" id="welcome">
					<div class="nx-welcomeIcon">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path d="M12 2L2 7l10 5 10-5-10-5z"/>
							<path d="M2 17l10 5 10-5"/>
							<path d="M2 12l10 5 10-5"/>
						</svg>
					</div>
					<div class="nx-welcomeTitle">Nexora AI</div>
					<div class="nx-welcomeSub">Universal AI Orchestration - Chat, Plan, or Execute</div>
					
					<div class="nx-quickActions">
						<button class="nx-quickBtn" data-action="platforms">
							<span class="nx-quickIcon" aria-hidden="true">#</span>
							Browse Platforms
						</button>
						<button class="nx-quickBtn" data-action="history">
							<span class="nx-quickIcon" aria-hidden="true">H</span>
							View History
						</button>
						<button class="nx-quickBtn" data-action="memory">
							<span class="nx-quickIcon" aria-hidden="true">I</span>
							Index Workspace
						</button>
					</div>
				</div>
			</section>
		</main>

		<footer class="nx-footer">
			<div class="nx-composerCard" id="composerCard">
				<div class="nx-composerTags" id="composerTags" hidden></div>
				<div class="nx-composerInputRow">
					<textarea class="nx-input" id="input" rows="1" placeholder="Ask anything. Type @ to add a file, / for commands"></textarea>
				</div>
				<div class="nx-composerToolbar">
					<div class="nx-composerChips" id="composerChips">
						<button type="button" class="nx-chip nx-chipIcon" id="plusChip" title="Add context" aria-label="Add context" aria-haspopup="listbox">+</button>
						<button type="button" class="nx-chip" id="modeChip" title="Mode (Shift+Tab)" aria-haspopup="listbox"><span class="nx-chipText">Chat</span><svg class="nx-chipChevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2.5 3.5 5 6 7.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
						<button type="button" class="nx-chip nx-chipModel" id="modelChip" title="Model and effort" aria-haspopup="listbox"><span class="nx-chipText">Auto</span><svg class="nx-chipChevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2.5 3.5 5 6 7.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
						<button type="button" class="nx-chip" id="approvalChip" title="What the agent may do without asking" aria-haspopup="listbox" hidden><span class="nx-chipText">Accept edits</span><svg class="nx-chipChevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2.5 3.5 5 6 7.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
						<input type="hidden" id="modeSelect" value="chat" />
						<input type="hidden" id="modelSelect" value="auto" />
					</div>
					<div class="nx-sendActions">
						<button class="nx-btn nx-btnPrimary nx-sendBtn" id="sendBtn" type="button" title="Send (Enter)" aria-label="Send, press Enter">
							<span class="nx-sendGlyph nx-sendGlyphSend" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 2 11 13" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
							<span class="nx-sendGlyph nx-sendGlyphStop" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/></svg></span>
							<span class="nx-sendBtnSr" id="sendBtnText">Send</span>
						</button>
					</div>
				</div>
				<div class="nx-composerMenu" id="composerMenu" role="listbox" hidden></div>
			</div>
		</footer>
		</div>
		<aside class="nx-sessionRail" id="sessionRail" aria-label="Chat sessions">
			<div class="nx-railResize" id="railResize" role="separator" aria-orientation="vertical" aria-label="Resize session list"></div>
			<div class="nx-railTop">
				<button class="nx-railNew" id="newSessionBtn" type="button" title="New chat">
					<span class="nx-railNewMark" aria-hidden="true">+</span>
					<span>New chat</span>
				</button>
			</div>
			<div class="nx-railList" id="sessionList" role="list"></div>
		</aside>
	</div>`
	});
}
