# nexora-core

The built-in extension that is Nexora's IDE. Everything Nexora adds to VS Code lives here; the Python engine lives in the [engine repository](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture).

Architecture reference: engine repo `docs/architecture/ide-extension.md` and `docs/architecture/agent-loop.md`. User guide: `docs/guides/user-guide.md`.
Verified against `Nexora@eede9bce039` (`ide-benchmarking`), 10 Nov 2026.

This extension and the engine ship together: the extension reuses a server on the engine port only when `/api/health` answers `"service": "nexora-engine"`, so a release must bundle an engine built from the same tag.

## Build

```powershell
npm run compile   # tsc + copy webview assets and codicons (scripts/copyWebviewAssets.js)
npm run watch
```

Source must stay ASCII-only (the fork's commit hygiene checks it).

## Module map (`src/`)

| Path | Responsibility |
|---|---|
| `extension.ts` | Activation: settings, key-header provider, OAuth/MCP handlers, inline completion, webview registration (gated on engine state), the Nexora status-bar and Command Center menu, engine start, WebSocket routing, ~30 commands |
| `chatPanel.ts` | The chat surface: the chat list rail (New chat, Search chats, Recipes, Platforms, Customize, chats by date with rename and delete), five modes, model picker, `@mentions`, `/commands`, plan card (who runs each step, skills, past runs), the agent loop driver (`_runAgentLoopWithMode`), subagents (`_runSubagent`), hooks around prompts and tools, plan code and agent steps (`_handleWorkspaceTask`) |
| `customizePanel.ts` | Customize: plugins, platforms, skills, agents (subagents, coding agents, remote A2A agents, routing that learns), recipes, commands, hooks, rules |
| `platformPanel.ts` | Platforms panel: rows with where each works, Discover, platform detail with tool switches and Try, your MCP servers (add, import, approve) |
| `workflowPanel.ts`, `taskTreeProvider.ts`, `outputPanel.ts` | Plan graph, task tree, step output |
| `timelinePanel.ts`, `settingsPanel.ts` | Memory timeline; Settings (Account, Plan & Usage, keys, execution, Cost & Analytics, ...) |
| `services/engineProcess.ts` | Find, spawn, health-check (engine identity) and supervise the local engine; generate engine secrets |
| `services/backend/*`, `services/backendClient.ts` | Typed engine clients (incl. `customize.ts`, `capabilities.ts`, `a2a.ts`); `transport.ts` adds the loopback token and key headers, timeouts, abort, SSE |
| `services/websocketClient.ts` | Orchestration WebSocket with back-off and plan re-sync |
| `services/agentRunMode.ts` | Run modes, terminal allowlist, agent settings, code executor choice |
| `services/subagents.ts`, `services/slashCommands.ts`, `services/hooks.ts` | Subagent runs, your `/commands`, hook calls to the engine |
| `services/sessionStore.ts`, `services/checkpoints.ts`, `services/workspaceIndex.ts` | Chats per folder, Restore files, automatic indexing |
| `services/cloudAccount.ts` | Nexora Cloud sign-in, status-bar credit, account menu |
| `services/mcpServers.ts`, `services/platformUsage.ts` | Your MCP servers; where each platform works |
| `services/tools/*` | Agent tools: read/list/ripgrep, write/patch with live editing and Keep / Undo, command runner and runtime probe, diagnostics, browser, platform calls with approval |
| `services/agents/*` | Local coding agents: specs (`localAgents.ts`), runner, git worktree sandbox, plan-step adapter |
| `services/inlineCompletion.ts` | Inline suggestions: local cache, debounce, abort |
| `services/browser.ts` | The Nexora Browser editor tab (Playwright screencast) |
| `services/mcpConnect.ts`, `services/oauthConnect.ts` | Vendor MCP sign-in; GitHub/Vercel OAuth |
| `services/settingsService.ts` | SecretStorage for keys (never written back to webviews) |
| `services/workspaceId.ts` | Workspace id shared with the engine (`<name>_<md5[:8]>`) |
| `webview/*` | Webview scripts and styles per surface; `shared/html.ts` is the common shell (nonce + CSP, codicons); `customize/model.js` holds Customize's labels and filters without DOM access |

## Rules

- Webviews never call the engine directly; they message their provider.
- Tokens for connected platforms never reach the extension; only "connected" state does.
- Anything that writes to the user's workspace goes through the run-mode gates and the diff review.
- Code from a project (MCP servers, hooks) runs only after the user approves it.
- New settings go in `package.json` → `contributes.configuration`. Then regenerate the engine repo's `docs/reference/settings-and-env.md`.
- User-facing labels are what the user guide quotes: change both together.
