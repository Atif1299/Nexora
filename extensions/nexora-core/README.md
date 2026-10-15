# nexora-core

The built-in extension that is Nexora's IDE. Everything Nexora adds to VS Code lives here; the Python engine lives in the [engine repository](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture).

Architecture reference: engine repo `docs/architecture/ide-extension.md` and `docs/architecture/agent-loop.md`.
Verified against `Nexora@981848b`, 15 Oct 2026.

## Build

```powershell
npm run compile   # tsc + copy webview assets (scripts/copyWebviewAssets.js)
npm run watch
```

## Module map (`src/`)

| Path | Responsibility |
|---|---|
| `extension.ts` | Activation: settings, key-header provider, OAuth/MCP handlers, inline completion, webview registration (gated on engine state), engine start, WebSocket routing, ~30 commands |
| `chatPanel.ts` | The chat surface: sessions, five modes, model picker, `@mentions`, plan card, the agent loop driver (`_runAgentLoopWithMode`), plan code steps (`_handleWorkspaceTask`) |
| `sessionsView.ts` | Sessions rail |
| `workflowPanel.ts`, `taskTreeProvider.ts`, `outputPanel.ts` | Plan graph, task tree, step output |
| `platformPanel.ts` | Platform Browser: catalogue, kinds, Connect / Configure / Install |
| `templatesPanel.ts`, `timelinePanel.ts`, `analyticsPanel.ts`, `settingsPanel.ts` | Templates, Timeline, Cost & Analytics, Settings (10 sections) |
| `services/engineProcess.ts` | Find, spawn, health-check and supervise the local engine; generate engine secrets |
| `services/backend/*`, `services/backendClient.ts` | Typed engine clients; `transport.ts` adds the loopback token and key headers, timeouts, abort, SSE |
| `services/websocketClient.ts` | Orchestration WebSocket with back-off and plan re-sync |
| `services/agentRunMode.ts` | Run modes, terminal allowlist, agent settings, code executor choice |
| `services/tools/*` | Agent tools: read/list/grep, write/patch/insert with diff preview, terminal, browser, platform calls with approval |
| `services/agents/*` | Local coding agents: specs (`localAgents.ts`), runner, git worktree sandbox, plan-step adapter |
| `services/inlineCompletion.ts` | Inline suggestions: local cache, debounce, abort |
| `services/browser.ts` | The Nexora Browser editor tab (Playwright screencast) |
| `services/mcpConnect.ts`, `services/oauthConnect.ts` | Vendor MCP sign-in; GitHub/Vercel OAuth |
| `services/settingsService.ts` | SecretStorage for keys (never written back to webviews) |
| `services/workspaceId.ts` | Workspace id shared with the engine (`<name>_<md5[:8]>`) |
| `webview/*` | Webview scripts and styles per surface; `shared/html.ts` is the common shell (nonce + CSP) |

## Rules

- Webviews never call the engine directly; they message their provider.
- Tokens for connected platforms never reach the extension; only "connected" state does.
- Anything that writes to the user's workspace goes through the run-mode gates and the diff preview.
- New settings go in `package.json` → `contributes.configuration`. Then regenerate the engine repo's `docs/reference/settings-and-env.md`.
