<p align="center">
  <img src="extensions/nexora-core/media/nexora-icon.svg" alt="Nexora Logo" width="120" height="120">
</p>

<h1 align="center">Nexora</h1>

<p align="center">
  <strong>VS Code fork + <code>nexora-core</code> — the IDE half of Nexora</strong>
</p>

<p align="center">
  Chat, templates, plan approval, and workflow views.<br>
  Orchestration, connectors, and memory live in the backend.<br>
  Frozen at tag <code>v1.0-fyp2</code> (FYP-2). Branch <code>Week19-Atif</code>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-FYP--2%20freeze%20v1.0--fyp2-green" alt="Status">
  <img src="https://img.shields.io/badge/built%20with-VS%20Code%20Fork-007ACC" alt="Built With">
</p>

---

## This repo vs the backend

This repository is the **editor**: a VS Code OSS fork with the `extensions/nexora-core` extension (**22** commands, **7** keybindings, **1** sidebar + **8** panel views).

The **orchestration engine** is [Atif1299/Nexora-IDE-Backend-Architecture](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture): FastAPI, **45** catalogued platforms / **11** active connectors, custom DAG executor, HITL, lexical `.mv2` workspace memory, ChromaDB platform search.

Read that README, [`docs/USER_GUIDE.md`](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture/blob/Week19-Atif/docs/USER_GUIDE.md), and [`Report/`](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture/tree/Week19-Atif/Report) for counts, architecture, and the FYP report. Do not copy the old “500+ platforms / LangGraph / Celery” table.

The extension talks to **exactly** `http://127.0.0.1:8000`. There is **no** `nexora.backendUrl` setting.

---

## Quick start

1. Start the backend first (Python 3.11+, Docker Compose **three** services, mandatory `TOKEN_ENCRYPTION_KEY`). Follow the backend [Quick start](https://github.com/Atif1299/Nexora-IDE-Backend-Architecture#quick-start).
2. Then this IDE:

```powershell
git clone https://github.com/Atif1299/Nexora.git
cd Nexora
yarn
yarn watch
# other terminal:
.\scripts\code.bat
```

3. Open the Nexora activity-bar icon. **Default Chat does not deploy.** First workflow: Templates → Landing Page Deploy → Instantiate → Run → **Approve & Execute**.

---

## What the extension owns

| Surface | Role |
|---------|------|
| Chat | Modes including Chat / Plan / Execute / Ask (workspace). Plan card HITL. |
| Templates | Builtin `landing-page-deploy`, `saas-starter`, `research-report` |
| Workflow / Task tree | DAG views. `plan_snapshot` updates Chat; Workflow can stay stale (W18-006). |
| Analytics / Output / Timeline / Settings / Platforms | Cost, logs, history, keys, catalogue |

Workspace Ask uses **lexical** `.mv2` retrieval after **Index Workspace** on the welcome screen. It is not vector RAG.

---

## Status

**FYP-2 freeze** `v1.0-fyp2`. Single-user, local, Windows-verified backend tests. Linux Docker suite deferred. Preference learning is **not** implemented (platform ids are task-type defaults).

**Team:** Muhammad Atif (SP23-BAI-031), Talha Asif (SP23-BAI-042). **Supervisor:** Dr. Muhammad Shahid Bhatti. COMSATS University Islamabad, Lahore Campus.

The Nexora IDE is built on VS Code OSS (MIT).
