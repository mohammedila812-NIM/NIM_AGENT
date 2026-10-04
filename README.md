# NIM AGENT — Autonomous AI Browser Assistant

[![Website](https://img.shields.io/badge/Website-Live%20Demo-df6b48?style=flat-square&logo=google-chrome)](https://mohammedila812-nim.github.io/NIM_AGENT/)
[![GitHub release](https://img.shields.io/github/v/release/mohammedila812-NIM/NIM_AGENT?color=df6b48&style=flat-square)](https://github.com/mohammedila812-NIM/NIM_AGENT/releases)
[![Version](https://img.shields.io/badge/version-1.4.1-df6b48?style=flat-square)](https://github.com/mohammedila812-NIM/NIM_AGENT/releases/tag/v1.4.1)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Brave%20%7C%20Firefox-0078d4?style=flat-square&logo=google-chrome)](https://github.com/mohammedila812-NIM/NIM_AGENT)
[![TypeScript](https://img.shields.io/badge/typescript-5.5%2B-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-black?style=flat-square)](LICENSE)
[![Instagram](https://img.shields.io/badge/Instagram-@mahamadali210-E4405F?style=flat-square&logo=instagram)](https://instagram.com/mahamadali210)

> **Autonomous, multi-model AI browser agent extension powered by NVIDIA NIM, Google Gemini, OpenAI, Groq, and local Ollama.**  
> NIM Agent v1.4.1 delivers **Indestructible Browser Actuation** — a ground-up hardening of every click, type, navigate, and form-fill primitive to be bulletproof against SVG traps, sticky-header occlusion, React/Vue controlled inputs, race conditions, and prompt injection. Built on top of the Virtual Workspace, Timed Deep Research Engine, NIM Brain Knowledge Graph, and Swarm Coordinator introduced in v1.4.0.

---

## ⚡ Core Capabilities

### 🤖 Autonomous Intelligence
- **ReAct Engine:** Multi-step reasoning loop with autonomous DOM inspection, form submission, clicking, scrolling, and web research — no micromanagement needed.
- **Proactive Tool Selection:** The agent automatically decides which tool or workspace to use based on context. You never need to specify — it routes research to `/research/`, code to `/code/`, notes to `/notes/`, and data to `/data/` on its own.
- **Lifelong Session Memory:** Conversations never lose context. Older turns are compressed via LLM into a rolling memory summary while the most recent exchanges are kept verbatim — the session continues indefinitely without memory loss.

### 🗂️ NIM Virtual Workspace *(New in v1.4.0)*
- **Persistent File System:** IndexedDB-backed virtual file system (VFS) with organized folders: `/notes`, `/research`, `/code`, `/data`, `/trash`.
- **File Explorer UI:** Full split-pane workspace panel — browse folders, view/edit files, search across all content, create new files, and export the entire workspace as JSON.
- **Agent-Controlled Storage:** The agent can create, read, append, delete, and search files autonomously as it works — saving research notes, generated code, analysis reports, and more, all without being asked.

### 🔬 Timed Deep Research Engine *(New in v1.4.0)*
- **Time-Bounded Research:** Give the agent a topic and a duration (e.g. "research quantum computing for 10 minutes"). It autonomously crawls multiple sources, takes live notes, and synthesizes an Executive Report — non-stop until time runs out.
- **Live Note Streaming:** Every crawled page appends structured notes to `/research/<topic>/live_notes.md` in real time, visible in the workspace.
- **Mission Control HUD:** Dedicated Research tab with countdown timer, live notes stream, and stop button for clean abort.
- **Automatic Executive Report:** On expiry, a full synthesis is saved to `/research/<topic>/EXECUTIVE_REPORT.md` and the workspace opens automatically.

### 💻 NIM Coding Space *(New in v1.4.0)*
- **In-Browser Code Editor:** Full-featured editor with Tab key support, syntax highlighting, and language selector (JavaScript, HTML, CSS, Python, and more).
- **Sandboxed JS Execution:** Run JavaScript safely inside a sandboxed `<iframe>` with postMessage protocol — console output captured and displayed inline.
- **HTML Live Preview:** Toggle a live preview pane for HTML/CSS — see your page rendered instantly as you type.
- **AI Code Generation:** Describe what you want in natural language and the agent generates the code, saves it to the VFS, and you can run it immediately.
- **VFS Integration:** Open and save any file from `/code/` in the Virtual Workspace — your code persists across sessions.

### 🌐 Browser Automation
- **NVIDIA NIM Acceleration:** High-throughput inference on Meta Llama 3.3 70B, Llama 3.2 Vision, Nemotron, and Mistral.
- **Universal Model Support:** NVIDIA NIM, Google Gemini, OpenAI, Groq, or self-hosted Ollama (`http://localhost:11434`).
- **Precise DOM Grounding:** Numerical element indexing, semantic tree simplification, viewport coordinate calculation, and full-resolution screenshot capture.
- **Form Automation & Scrapers:** Atomic multi-input form fills, table extraction, markdown research compilation, and direct file downloads.

### 📡 Background Monitoring & Macros
- **Watch Mode:** Continuous page monitoring (price drops, stock alerts, news updates) with instant browser notifications.
- **Workflow Macro Recorder:** Capture repetitive tasks into reusable macros and replay autonomously on demand.
- **Cost Guard & Token Budgeting:** Real-time token tracking, session cost meters, and configurable daily spending caps.

### 🔒 Privacy & Security
- **Zero Telemetry:** No analytics, logs, or metrics ever leave your machine.
- **Sandboxed Storage:** API keys, session histories, and workspace files live entirely in local browser storage.
- **Human-In-The-Loop:** Financial or irreversible actions trigger an operator confirmation dialog before execution.

---

## 🏛️ Extension Architecture (v1.4.0)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          User Interaction                           │
│   Side Panel (Alt+Shift+N) | Chat | Workspace | Coding | Research   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Background Service Worker                        │
│  • Autonomous ReAct Engine (engine.ts)                              │
│  • Session Memory & Rolling Compression (session-memory.ts)         │
│  • Alarm-Driven Watch Engine (watch-engine.ts)                      │
│  • Timed Deep Research Session (deep-research.ts)                   │
└──────────┬───────────────────────────────────┬──────────────────────┘
           │                                   │
           ▼                                   ▼
┌──────────────────────────┐       ┌───────────────────────────────────┐
│     Content Scripts      │       │        Agent Tool Layer           │
│ • DOM Grounding          │       │ • Web Search & Browse             │
│ • Numeric Element Tags   │       │ • Screenshot & Extract            │
│ • Click / Type / Scroll  │       │ • Virtual Workspace (VFS) Tools   │
│ • Screenshot Capture     │       │ • Code Runner (sandboxed iframe)  │
└──────────────────────────┘       └──────────────┬────────────────────┘
                                                  │
                                                  ▼
                                   ┌───────────────────────────────────┐
                                   │      Storage Layer                │
                                   │ • IndexedDB Virtual Workspace     │
                                   │   /notes  /research  /code        │
                                   │   /data   /trash                  │
                                   │ • chrome.storage (config/history) │
                                   │ • Session Memory (rolling LLM)    │
                                   └───────────────────────────────────┘
```

---

## 🚀 Getting Started

### 1. Build from Source

**Prerequisites:** Node.js 18+ and npm.

```bash
# Clone the repository
git clone https://github.com/mohammedila812-NIM/NIM_AGENT.git
cd NIM_AGENT

# Install dependencies
npm install

# Build the Chrome/Chromium Manifest V3 extension
npm run build

# Or build + zip for distribution
npm run zip

# Or build for Firefox
npm run build:firefox
```

### 2. Load into Your Browser

#### Chromium Browsers (Google Chrome, Microsoft Edge, Brave, Opera)
1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Toggle on **Developer mode** (top-right corner).
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder inside the project.
4. Pin the **NIM Agent** extension icon or press **`Alt+Shift+N`** on any tab to open the Side Panel.

#### Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...** and select `manifest.json` inside `.output/firefox-mv2` or `.output/firefox-mv3`.

---

## ⚙️ Configuration

1. Click the **Settings (gear icon)** in the NIM Agent side panel.
2. Select your preferred LLM provider:
   - **NVIDIA NIM:** Enter your API key (`nvapi-...`). Defaults to `meta/llama-3.3-70b-instruct`.
   - **Google Gemini:** Enter your Gemini API key (`AIzaSy...`).
   - **OpenAI:** Enter your OpenAI key (`sk-...`).
   - **Groq:** Enter your Groq API key (`gsk_...`).
   - **Ollama:** Set endpoint to `http://localhost:11434` (no API key required).
3. (Optional) Provide a **Brave Search** or **Serper** API key for live web search synthesis during deep research.
4. Click **Save Configuration**.

---

## 🧪 Automated Testing & Verification

```bash
# Run all unit & integration tests (136 tests across 29 files)
npm test

# Type-check TypeScript codebase
npm run compile
```

All tests cover: VFS operations, workspace tool executors, session memory compression, deep research lifecycle, sandboxed code runner, and agent ReAct loop.

---

## 📋 Changelog

### v1.4.1 — Indestructible Browser Actuation *(Latest)*

- **🛡️ Indestructible Clicker:** SVG/icon ladder (`resolveInteractiveContainer`), disabled guard (`isElementDisabled`), occlusion detection & auto-scroll bypass (`isElementOccluded`), coordinate fallback (`clickAtCoordinates`), checkbox double-toggle fix
- **⌨️ Framework-Resilient Typer:** Full keyboard pipeline (`keydown → keypress → input → keyup → change`) for React/Vue/Angular inputs; `submitWithEnter` for search bars; `mode: append | prepend`
- **🧭 Safe Navigator:** `normalizeNavigationUrl` — auto-adds `https://`, blocks `javascript:`, `data:`, `vbscript:`, `file:` schemes
- **🎭 Dual-Frame Settle Gate:** Double `requestAnimationFrame` in `waitForPageSettled` — CSS transitions & layout reflows fully settle before agent proceeds
- **👁️ Occlusion-Aware `read_page`:** Every element tagged `[in-viewport]` / `[below-fold]` / `[above-fold]` / `[occluded]` / `[disabled]`; `EMBEDDED IFRAMES` section added
- **🗺️ Tool Routing Decision Matrix:** New decision tables in `AGENT_SYSTEM_PROMPT` guide the LLM on when to use each tool, handle annotation tags, and prioritize `knowledge_graph_query` before `web_search`
- **🧪 136 tests across 29 files — all passing**

### v1.4.0 — NIM Virtual Workspace & Autonomous Intelligence
- **NEW:** Virtual Workspace with IndexedDB-backed VFS (`/notes`, `/research`, `/code`, `/data`, `/trash`)
- **NEW:** File Explorer UI — browse, edit, search, export, create files from the side panel
- **NEW:** 6 agent workspace tools — agent autonomously saves research notes, code, reports
- **NEW:** Timed Deep Research Engine — time-bounded autonomous multi-source crawl + live notes + Executive Report synthesis
- **NEW:** NIM Coding Space — in-browser code editor with sandboxed JS execution, HTML live preview, AI code generation
- **NEW:** Lifelong Session Memory — rolling LLM compression, no context loss across long sessions
- **IMPROVED:** Fully autonomous tool/workspace selection — agent decides what to use and when, no user micromanagement
- **IMPROVED:** System prompt overhaul with proactive cognitive routing

### v1.3.0
- Multi-provider model registry with dynamic discovery
- Task scheduling and background monitors
- Security audit panel and HITL confirmation dialogs
- Macro recorder and replay engine

---

## 👤 Author & License

Created and maintained by **Mohammed Ali** ([@mahamadali210](https://instagram.com/mahamadali210)).

- **GitHub:** [https://github.com/mohammedila812-NIM/NIM_AGENT](https://github.com/mohammedila812-NIM/NIM_AGENT)
- **Instagram:** [@mahamadali210](https://instagram.com/mahamadali210)

This project is distributed under the [PolyForm Noncommercial License 1.0.0](LICENSE).
