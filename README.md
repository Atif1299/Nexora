<p align="center">
  <img src="extensions/nexora-core/media/nexora-icon.svg" alt="Nexora Logo" width="120" height="120">
</p>

<h1 align="center">Nexora</h1>

<p align="center">
  <strong>The Agentic IDE for Full-Lifecycle Software Orchestration</strong>
</p>

<p align="center">
  From idea to deployment in one environment. Nexora orchestrates AI platforms<br>
  so you can focus on building, not context-switching.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#comparison">Comparison</a> •
  <a href="#roadmap">Roadmap</a> •
  <a href="#team">Team</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0--beta-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/built%20with-VS%20Code%20Fork-007ACC" alt="Built With">
</p>

---

## The Problem

Today's AI development tools are **fragmented**:

- **Cursor** generates code, but doesn't deploy it
- **v0.dev** creates UI, but you manually copy it
- **Vercel** deploys, but doesn't know your codebase
- **Devin** works autonomously, but gives you no control

Developers become the **glue** between tools, constantly context-switching and manually orchestrating workflows.

## The Solution: Nexora

Nexora is a **VS Code fork** with an embedded **AI orchestration layer** that:

1. **Understands** your request through natural language
2. **Discovers** the right AI platforms for each task
3. **Plans** a workflow with dependencies (DAG)
4. **Shows** you the plan for approval (Human-in-the-Loop)
5. **Executes** across platforms in parallel
6. **Remembers** your preferences for next time

**One IDE. Multiple platforms. Full lifecycle.**

---

## Features

### Human-in-the-Loop (HITL) Approval
Never lose control. See exactly what Nexora will do before it does it. Approve, modify, or cancel any workflow.

```
User: "Add Stripe payments and deploy"

Nexora: "Here's my plan:
  1. Generate Stripe integration code (Claude)
  2. Push to GitHub (feature/stripe branch)
  3. Deploy to Vercel staging
  
  Estimated cost: $0.02
  
  [✓ Approve] [✏️ Modify] [✗ Cancel]"
```

### Persistent Memory (Memvid)
Nexora remembers your codebase, past decisions, and preferences. It learns that you prefer Supabase over Firebase, Stripe over PayPal.

### Multi-Platform Orchestration
45+ AI platforms catalogued. 4 active connectors (OpenAI, Anthropic, GitHub, Vercel) with extensible architecture for more.

### DAG-Based Parallel Execution
Independent tasks run in parallel. Dependent tasks wait. Automatic retry with exponential backoff. Fallback to alternative platforms on failure.

### Cost Tracking & Rollback
See estimated costs before execution. Track actual spend. Undo actions when things go wrong.

### Agent Loop with Tools
Cursor-like codebase understanding through tool-calling: `search_codebase`, `read_file`, `grep`, `list_files`.

---

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+
- Docker (for PostgreSQL + Redis)

### 1. Clone the Repositories

```bash
# Clone the IDE (this repo)
git clone https://github.com/your-org/Nexora.git

# Clone the backend
git clone https://github.com/your-org/Nexora-IDE-Backend-Architecture.git
```

### 2. Start the Backend

```bash
cd Nexora-IDE-Backend-Architecture/backend

# Start PostgreSQL + Redis
docker compose up -d

# Install dependencies
python -m venv venv
.\venv\Scripts\Activate.ps1  # Windows
pip install -r requirements.txt

# Run the API
uvicorn app.main:app --reload --port 8000
```

### 3. Build and Run Nexora IDE

```bash
cd Nexora

# Install dependencies
yarn

# Watch for changes
yarn watch

# In another terminal, run the IDE
.\scripts\code.bat  # Windows
./scripts/code.sh   # macOS/Linux
```

### 4. Open the Nexora Panel
Click the Nexora icon in the sidebar to access:
- **Chat Panel** - Natural language interface
- **Platform Browser** - Explore 45+ AI platforms
- **Task Tree** - Visualize workflow DAGs

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      NEXORA IDE (VS Code Fork)                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ Chat Panel   │ │ Platform     │ │ Task Tree                │ │
│  │ (HITL)       │ │ Browser      │ │ (DAG Visualizer)         │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket + REST
┌───────────────────────────▼─────────────────────────────────────┐
│                      BACKEND (FastAPI)                           │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Cognitive Layer: Intent Classification + Task Decomposition │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ Memory Layer: Memvid (.mv2) + ChromaDB (Semantic Search)   │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ Orchestration: DAG Planner + Executor + Retry/Fallback     │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │ Connectors: OpenAI | Anthropic | GitHub | Vercel | MCP     │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Comparison

| Feature | Cursor | Windsurf | Bolt.new | Devin | **Nexora** |
|---------|--------|----------|----------|-------|------------|
| Code Generation | ✅ | ✅ | ✅ | ✅ | ✅ |
| Codebase Context | ✅ | ✅ | ❌ | ✅ | ✅ |
| Multi-Platform Orchestration | ❌ | ❌ | ❌ | ✅ | ✅ |
| Human-in-the-Loop | ❌ | ❌ | ❌ | Limited | ✅ |
| Persistent Memory | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cost Tracking | ❌ | ❌ | ❌ | ❌ | ✅ |
| Rollback Capability | ❌ | ❌ | ❌ | ❌ | ✅ |
| Protocol-Based (MCP) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Auto-Deploy Pipeline | ❌ | ❌ | ✅ | ✅ | ✅ |

---

## Roadmap

### Phase 1: Foundation (Complete)
- [x] VS Code fork with Nexora branding
- [x] Chat Panel, Platform Browser, Task Tree
- [x] Intent Classification + Task Decomposition
- [x] DAG-based orchestration with HITL
- [x] 4 active connectors (OpenAI, Anthropic, GitHub, Vercel)
- [x] Memvid memory layer
- [x] Cost tracking and rollback

### Phase 2: Expansion (In Progress)
- [ ] Additional connectors (Supabase, Stripe, v0.dev)
- [ ] MCP server integrations
- [ ] Enhanced memory with cross-project learning
- [ ] Team collaboration features

### Phase 3: Enterprise
- [ ] Self-hosted deployment option
- [ ] SSO/SAML authentication
- [ ] Audit logs and compliance
- [ ] Custom connector SDK

---

## Tech Stack

**IDE (This Repo)**
- TypeScript
- VS Code Extension API
- WebSocket for real-time updates

**Backend ([Nexora-IDE-Backend-Architecture](https://github.com/your-org/Nexora-IDE-Backend-Architecture))**
- Python 3.10+ / FastAPI
- PostgreSQL + Redis
- ChromaDB (vector search)
- Memvid SDK v2 (workspace memory)
- LiteLLM (unified LLM access)

---

## Team

**Nexora** is developed as a Final Year Project at **COMSATS University Islamabad, Lahore Campus** (BS Artificial Intelligence).

| Name | Role | Contact |
|------|------|---------|
| Muhammad Atif | Co-Founder, Lead Developer | SP23-BAI-031 |
| Muhammad Talha Asif | Co-Founder, Backend Lead | SP23-BAI-042 |

**Supervisor:** Dr. Muhammad Shahid Bhatti (Assistant Professor)

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE.txt) file for details.

The Nexora IDE is built on the VS Code OSS foundation, which is also MIT licensed.

---

## Links

- **Website:** [nexora.dev](https://nexora.dev) *(coming soon)*
- **Backend Repo:** [Nexora-IDE-Backend-Architecture](https://github.com/your-org/Nexora-IDE-Backend-Architecture)
- **Documentation:** [docs.nexora.dev](https://docs.nexora.dev) *(coming soon)*

---

<p align="center">
  <strong>Nexora — Orchestrate the future of development.</strong>
</p>
