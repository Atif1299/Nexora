/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ChatInitialState } from './types';

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export function getChatWebviewHtml(
	webview: vscode.Webview,
	extensionUri: vscode.Uri,
	initialState: ChatInitialState
): string {
	const nonce = getNonce();

	const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'chat', 'chat.css'));
	const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'chat', 'chat.js'));

	let sessionRailWidthPx = 196;
	const rawRailWidth = initialState.sessionRailWidth;
	if (typeof rawRailWidth === 'number' && Number.isFinite(rawRailWidth)) {
		sessionRailWidthPx = Math.max(140, Math.min(360, Math.round(rawRailWidth)));
	}

	const csp = [
		`default-src 'none'`,
		`img-src ${webview.cspSource} https: data:`,
		`style-src ${webview.cspSource}`,
		`script-src 'nonce-${nonce}'`,
	].join('; ');

	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<link rel="stylesheet" href="${cssUri}">
	<title>Nexora Chat</title>
</head>
<body>
	<div class="nx-root">
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
				<div class="nx-firstRunTitle">Add an API key to start</div>
				<div class="nx-firstRunSub">Chat needs a provider key. Paste one here or open Settings. You can dismiss this and keep using the editor.</div>
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
				<div class="nx-composerInputRow">
					<input class="nx-input" type="text" id="input" placeholder="Ask a question, describe what to build, or give a command..." />
				</div>
				<div class="nx-composerToolbar">
					<div class="nx-modeSelector">
						<div class="nx-dd" id="modeDd" data-dd-kind="mode">
							<button type="button" class="nx-ddTrigger" id="modeDdTrigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="modeDdMenu" title="Select interaction mode">
								<span class="nx-ddTriggerText" id="modeDdText">Chat</span>
								<span class="nx-ddChevron" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 3.5 5 6 7.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
							</button>
							<div class="nx-ddMenu" id="modeDdMenu" role="listbox" aria-labelledby="modeDdTrigger" hidden>
								<button type="button" class="nx-ddItem" role="option" data-value="chat" data-label="Chat"><span class="nx-ddItemCheck" aria-hidden="true"></span><span class="nx-ddItemLabel">Chat</span></button>
								<button type="button" class="nx-ddItem" role="option" data-value="ask" data-label="Ask"><span class="nx-ddItemCheck" aria-hidden="true"></span><span class="nx-ddItemLabel">Ask</span></button>
								<button type="button" class="nx-ddItem" role="option" data-value="plan" data-label="Plan"><span class="nx-ddItemCheck" aria-hidden="true"></span><span class="nx-ddItemLabel">Plan</span></button>
								<button type="button" class="nx-ddItem" role="option" data-value="execute" data-label="Execute"><span class="nx-ddItemCheck" aria-hidden="true"></span><span class="nx-ddItemLabel">Execute</span></button>
								<button type="button" class="nx-ddItem" role="option" data-value="agent" data-label="Agent"><span class="nx-ddItemCheck" aria-hidden="true"></span><span class="nx-ddItemLabel">Agent</span></button>
							</div>
							<input type="hidden" id="modeSelect" value="chat" />
						</div>
						<div class="nx-dd nx-ddModel" id="modelDd" data-dd-kind="model">
							<button type="button" class="nx-ddTrigger" id="modelDdTrigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="modelDdMenu" title="Select AI model">
								<span class="nx-ddTriggerText" id="modelDdText">Auto</span>
								<span class="nx-ddChevron" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 3.5 5 6 7.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
							</button>
							<div class="nx-ddMenu nx-ddMenuModel" id="modelDdMenu" role="listbox" aria-labelledby="modelDdTrigger" hidden>
								<div class="nx-ddSearchWrap" id="modelDdSearchWrap" hidden>
									<input type="search" class="nx-ddSearch" id="modelDdSearch" placeholder="Search models" aria-label="Search models" autocomplete="off" />
								</div>
								<div class="nx-ddMenuBody" id="modelDdList">
									<button type="button" class="nx-ddItem" role="option" data-value="auto" data-label="Auto"><span class="nx-ddItemCheck" aria-hidden="true"></span><span class="nx-ddItemLabel">Auto</span></button>
								</div>
							</div>
							<input type="hidden" id="modelSelect" value="auto" />
						</div>
					</div>
					<div class="nx-sendActions">
						<button class="nx-btn nx-btnPrimary nx-sendBtn" id="sendBtn" type="button" title="Send (Enter)" aria-label="Send, press Enter">
							<span class="nx-sendGlyph nx-sendGlyphSend" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 2 11 13" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
							<span class="nx-sendGlyph nx-sendGlyphStop" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10"/></svg></span>
							<span class="nx-sendBtnSr" id="sendBtnText">Send</span>
						</button>
					</div>
				</div>
			</div>
			<div class="nx-modeHint" id="modeHint">
				<span class="nx-hintText">Chat mode: Have a conversation, ask questions, get explanations</span>
			</div>
		</footer>
		</div>
		<aside class="nx-sessionRail" id="sessionRail" style="--nx-rail-width: ${sessionRailWidthPx}px;" aria-label="Chat sessions">
			<div class="nx-railResize" id="railResize" role="separator" aria-orientation="vertical" aria-label="Resize session list"></div>
			<div class="nx-railTop">
				<button class="nx-railNew" id="newSessionBtn" type="button" title="New chat">
					<span class="nx-railNewMark" aria-hidden="true">+</span>
					<span>New chat</span>
				</button>
			</div>
			<div class="nx-railList" id="sessionList" role="list"></div>
		</aside>
	</div>

	<script nonce="${nonce}">
		window.__NEXORA_INITIAL_STATE__ = ${JSON.stringify(initialState)};
	</script>
	<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

