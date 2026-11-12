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
						<svg width="56" height="56" viewBox="13 11 78 78" aria-hidden="true">
							<defs>
								<linearGradient id="nxw-green" x1="0" y1="0" x2="1" y2="1">
									<stop offset="0" stop-color="#43E6A1"/>
									<stop offset="1" stop-color="#0B8550"/>
								</linearGradient>
								<filter id="nxw-glow" x="-100%" y="-100%" width="300%" height="300%">
									<feGaussianBlur stdDeviation="2.5"/>
								</filter>
								<filter id="nxw-shadow" x="-20%" y="-20%" width="140%" height="140%">
									<feGaussianBlur stdDeviation="1.3"/>
								</filter>
							</defs>
							<rect x="18" y="25" width="48" height="38" rx="8" fill="#3A4641"/>
							<rect x="27.5" y="37.8" width="48" height="38" rx="8" fill="#000000" fill-opacity="0.22" filter="url(#nxw-shadow)"/>
							<rect x="27" y="36" width="48" height="38" rx="8" fill="url(#nxw-green)"/>
							<circle cx="33.5" cy="42.5" r="1.5" fill="#FFFFFF" fill-opacity="0.85"/>
							<circle cx="38" cy="42.5" r="1.5" fill="#FFFFFF" fill-opacity="0.6"/>
							<circle cx="42.5" cy="42.5" r="1.5" fill="#FFFFFF" fill-opacity="0.4"/>
							<path d="M36 52 L43 57.5 L36 63" fill="none" stroke="#FFFFFF" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>
							<path d="M48 63 H60" fill="none" stroke="#FFFFFF" stroke-width="4.4" stroke-linecap="round"/>
							<circle cx="75" cy="36" r="7" fill="#7CF7C0" fill-opacity="0.8" filter="url(#nxw-glow)"/>
							<circle cx="75" cy="36" r="5" fill="#5EF2B5" stroke="#0B6B43" stroke-width="1.2"/>
							<circle cx="75" cy="36" r="2.3" fill="#FFFFFF"/>
						</svg>
					</div>
					<div class="nx-welcomeTitle">Nexora AI</div>
					<div class="nx-welcomeSub">Chat, plan across your platforms, or let the agent build.</div>

					<div class="nx-welcomeCards">
						<button type="button" class="nx-welcomeCard" data-page="platforms">
							<i class="codicon codicon-plug" aria-hidden="true"></i>
							<span class="nx-welcomeCardTitle">Connect a platform</span>
							<span class="nx-welcomeCardDesc">GitHub, Vercel, Supabase and your MCP servers</span>
						</button>
						<button type="button" class="nx-welcomeCard" data-page="recipes">
							<i class="codicon codicon-play-circle" aria-hidden="true"></i>
							<span class="nx-welcomeCardTitle">Run a recipe</span>
							<span class="nx-welcomeCardDesc">Start from a saved multi-step plan</span>
						</button>
						<button type="button" class="nx-welcomeCard" data-page="customize">
							<i class="codicon codicon-extensions" aria-hidden="true"></i>
							<span class="nx-welcomeCardTitle">Add a skill or agent</span>
							<span class="nx-welcomeCardDesc">Plugins, skills, agents, hooks and rules</span>
						</button>
						<button type="button" class="nx-welcomeCard" data-action="indexWorkspace">
							<i class="codicon codicon-database" aria-hidden="true"></i>
							<span class="nx-welcomeCardTitle">Index this workspace</span>
							<span class="nx-welcomeCardDesc">Let chat and the agent search your code</span>
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
							<span class="nx-sendGlyph nx-sendGlyphSend" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
							<span class="nx-sendGlyph nx-sendGlyphStop" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/></svg></span>
							<span class="nx-sendBtnSr" id="sendBtnText">Send</span>
						</button>
					</div>
				</div>
				<div class="nx-composerMenu" id="composerMenu" role="listbox" hidden></div>
			</div>
		</footer>
		</div>
		<aside class="nx-sessionRail${initialState.sessionRailHidden ? ' is-hidden' : ''}" id="sessionRail" aria-label="Chats">
			<div class="nx-railResize" id="railResize" role="separator" aria-orientation="vertical" aria-label="Resize chat list"></div>
			<nav class="nx-railNav" aria-label="Chat navigation">
				<button type="button" class="nx-railNavItem" id="newSessionBtn"><i class="codicon codicon-add" aria-hidden="true"></i><span>New chat</span></button>
				<button type="button" class="nx-railNavItem" id="railSearchBtn" aria-controls="railSearch"><i class="codicon codicon-search" aria-hidden="true"></i><span>Search chats</span></button>
				<button type="button" class="nx-railNavItem" data-page="recipes"><i class="codicon codicon-play-circle" aria-hidden="true"></i><span>Recipes</span></button>
				<button type="button" class="nx-railNavItem" data-page="platforms"><i class="codicon codicon-plug" aria-hidden="true"></i><span>Platforms</span><span class="nx-railNavCount" id="railPlatformCount" hidden></span></button>
				<button type="button" class="nx-railNavItem" data-page="customize"><i class="codicon codicon-extensions" aria-hidden="true"></i><span>Customize</span></button>
			</nav>
			<div class="nx-railSearch" id="railSearchRow" hidden>
				<i class="codicon codicon-search" aria-hidden="true"></i>
				<input type="text" id="railSearch" placeholder="Search chats" aria-label="Search chats" autocomplete="off" spellcheck="false" />
			</div>
			<div class="nx-railList" id="sessionList"></div>
		</aside>
	</div>`
	});
}
