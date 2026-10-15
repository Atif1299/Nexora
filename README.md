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

- **Chat** in five modes — Chat, Ask, Agent, Plan, Execute — with a model picker and streamed replies.
- **An agent** that edits files (with diff previews), runs commands in a live *Nexora Agent* terminal, drives a real browser (*Nexora Browser*), suggests code at the cursor, and calls `@mentioned` connected platforms after your approval.
- **Plans** shown as an approval card and a live **workflow graph**; code steps of a plan are executed here, by Nexora's agent or by Claude Code / Cursor / Cline inside a git worktree with diff review.
- **Panels:** Platforms (catalogue and sign-in), Templates, Timeline, Settings, Cost & Analytics, Task Plan, Output.
- **The engine supervisor:** it starts the local Nexora engine on `127.0.0.1`, generates its secrets in SecretStorage, and restarts it if it stops.

The **engine** (planner, DAG executor, memory, connectors, vendor MCP sign-in) and the **documentation hub** live in [Atif1299/Nexora-IDE-Backend-Architecture](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture). Start with its [`docs/README.md`](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture/blob/System-Refinement/docs/README.md).

## Quick start (development)

```powershell
git clone https://github.com/Atif1299/Nexora.git
cd Nexora
yarn
yarn watch
# second terminal
.\scripts\code.bat
```

On first launch the extension starts the engine itself: from `nexora.engine.pythonPath`, a bundled `nexora-engine.exe`, or the engine repo's `backend/.venv`. No Docker is needed. Add a model key in **Settings → API Keys** (OpenRouter has a free router). Full setup: the engine repo's [developer guide](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture/blob/System-Refinement/docs/guides/developer-guide.md).

Extension-only rebuild:

```powershell
cd extensions\nexora-core
npm run compile
```

## Where to read more

| Topic | Page (engine repo `docs/`) |
|---|---|
| What Nexora is and how it compares | `product/overview.md`, `product/competitive-landscape.md` |
| IDE surfaces and messaging | `architecture/ide-extension.md` |
| Agent loop, tools, run modes, browser, local agents, inline suggestions | `architecture/agent-loop.md` |
| Plans, approval, execution | `architecture/orchestration-and-hitl.md` |
| Settings reference | `reference/settings-and-env.md` |
| User guide | `guides/user-guide.md` |

Notes on the fork itself (build, structure) are in [`vscode-structure-notes.md`](vscode-structure-notes.md).

## Status

A Final Year Project (COMSATS University Islamabad, Lahore Campus) growing into a product. FYP-2 freeze tag: `v1.0-fyp2`; current work: `System-Refinement`.

**Team:** Muhammad Atif (SP23-BAI-031), Talha Asif (SP23-BAI-042). **Supervisor:** Dr. Muhammad Shahid Bhatti.

Built on VS Code OSS (MIT).
