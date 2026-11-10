<p align="center">
  <img src="extensions/nexora-core/media/nexora-icon.svg" alt="Nexora Logo" width="120" height="120">
</p>

<h1 align="center">Nexora</h1>

<p align="center">
  <strong>An agentic IDE that plans, approves and ships the whole software lifecycle</strong><br>
  VS Code fork + the <code>nexora-core</code> extension — the IDE half of Nexora
</p>

---

## What this repository is

The **editor**: a VS Code OSS fork whose product behaviour lives in one built-in extension, [`extensions/nexora-core`](extensions/nexora-core/README.md). It provides:

- **Chat** in five modes (Chat, Ask, Agent, Plan, Execute) with a model picker, a chat list rail (New chat, Search chats, Recipes, Platforms, Customize, chats by date) and a **Nexora** menu in the status bar and Command Center.
- **An agent** that edits files live (Keep / Undo), runs commands in a *Nexora Agent* tab, drives a real browser (*Nexora Browser*), suggests code at the cursor, loads skills, hands work to subagents, runs your hooks, and calls your connected platforms after your approval.
- **Customize:** plugins and marketplaces, platforms and your own MCP servers, skills, agents (subagents, coding agents, remote A2A agents), recipes, `/commands`, hooks and rules, reading Claude Code's and Cursor's files as they are.
- **Plans** shown as an approval card and a live **workflow graph**; steps run on platforms, on Nexora's agent, on Claude Code / Cursor / Cline inside a git worktree with diff review, on your subagents or on remote A2A agents. Finished plans become recipes; routing learns from past runs.
- **Panels:** Platforms, Customize, Timeline, Settings (incl. Plan & Usage and Cost & Analytics), Workflow, Task Plan, Output.
- **Nexora Cloud** sign-in for using models without your own key.
- **The engine supervisor:** it starts the local Nexora engine on `127.0.0.1`, generates its secrets in SecretStorage, and restarts it if it stops. It reuses a running engine only when `/api/health` names itself `nexora-engine`, so this repository and the engine are released together.

The **engine** (planner, DAG executor, capability registry, memory, connectors, Customize, MCP sign-in) and the **documentation hub** live in [Atif1299/Nexora-IDE-Backend-Architecture](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture). Start with its [`docs/README.md`](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture/blob/ide-benchmarking/docs/README.md).

## Quick start (development)

```powershell
git clone https://github.com/Atif1299/Nexora.git
cd Nexora
yarn
yarn watch
# second terminal
.\scripts\code.bat
```

On first launch the extension starts the engine itself: from `nexora.engine.pythonPath`, a bundled `nexora-engine.exe`, or the engine repo's `backend/.venv`. No Docker is needed. Sign in to Nexora Cloud from the first-run card, or add a model key in **Settings > LLM Keys**. Full setup: the engine repo's [developer guide](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture/blob/ide-benchmarking/docs/guides/developer-guide.md).

Extension-only rebuild:

```powershell
cd extensions\nexora-core
npm run compile
```

## Where to read more

| Topic | Page (engine repo `docs/`) |
|---|---|
| How to use every feature | `guides/user-guide.md` |
| What Nexora is and how it compares | `product/overview.md`, `product/competitive-landscape.md` |
| IDE surfaces and messaging | `architecture/ide-extension.md` |
| Agent loop, tools, run modes, browser, local agents, skills, subagents, hooks, plugins | `architecture/agent-loop.md` |
| Plans, approval, execution, agents as steps, recipes, routing that learns | `architecture/orchestration-and-hitl.md` |
| Platforms and MCP servers | `architecture/integrations-and-mcp.md` |
| Settings reference | `reference/settings-and-env.md` |
| Building a release | `guides/packaging-and-release.md` |

Notes on the fork itself (build, structure) are in [`vscode-structure-notes.md`](vscode-structure-notes.md).

## Status

A Final Year Project (COMSATS University Islamabad, Lahore Campus) growing into a product. FYP-2 freeze tag: `v1.0-fyp2`; current work: `ide-benchmarking`, released as `v0.1.x` with the engine (latest v0.1.6; v0.1.7 next). Installer: [nexora.visionscraft.tech/download](https://nexora.visionscraft.tech/download).

**Team:** Muhammad Atif (SP23-BAI-031), Talha Asif (SP23-BAI-042). **Supervisor:** Dr. Muhammad Shahid Bhatti.

Built on VS Code OSS (MIT).
