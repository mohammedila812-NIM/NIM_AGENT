# Changelog

All notable changes to NIM Agent are documented here.

## v1.4.1 — 2026-10-04

### 🛡️ Basic Features Reinforcement — Indestructible Browser Actuation

This release hardens every core browser-actuation primitive to match or exceed the reliability of
leading browser-automation frameworks (Stagehand, Skyvern, browser-use, Anthropic Computer Use).
No user-visible API changes — every improvement is backwards-compatible.

---

#### ⚡ Phase 1 — Indestructible Clicker (`clicker.ts`)

- **SVG / Icon Ladder** — `resolveInteractiveContainer()` climbs the DOM hierarchy from `path`, `svg`,
  `span`, or icon elements up to the nearest actionable ancestor (`button`, `a`, `[role="button"]`),
  eliminating silent click misses on icon-only buttons.
- **Disabled Guard** — `isElementDisabled()` checks both the native `disabled` attribute and
  `aria-disabled="true"` before every click; returns a descriptive error instead of silently failing.
- **Occlusion Detection & Bypass** — `isElementOccluded()` uses `document.elementFromPoint()` to
  detect sticky headers and modal overlays covering the target; automatically scrolls 90 px up and
  retries before reporting occlusion.
- **Coordinate Fallback** — New `clickAtCoordinates(x, y)` function enables canvas, map, and
  custom-widget clicks by screen position (pair with `screenshot` Set-of-Marks badges).
- **Checkbox Double-Toggle Fix** — Removed manual `checked` assignment; native `click()` now handles
  the toggle, with a single `input` event fired for framework listeners (React, Vue, Angular).
- **Return Type** — `clickElement()` now returns `{ success: boolean; error?: string }` instead of
  `void` for structured error propagation.

#### ⌨️ Phase 1 — Framework-Resilient Typer (`typer.ts`)

- **Full Keyboard Event Pipeline** — Every keystroke now dispatches `keydown → keypress → native
  value setter → InputEvent('input', { inputType: 'insertText' }) → keyup → change`, making React /
  Vue / Angular controlled-input state machines react correctly.
- **`TypeOptions` Interface** — New `mode: 'replace' | 'append' | 'prepend'` option to preserve or
  extend existing field values without clearing.
- **`submitWithEnter`** — Dispatches Enter key events and calls `form.requestSubmit()` (with
  `dispatchEvent` fallback) — ideal for Google / Bing / site-specific search bars that submit on Enter.

#### 🧭 Phase 2 — Safe Navigator (`navigator.ts`)

- **URL Normalization** — `normalizeNavigationUrl()` auto-prepends `https://` to bare domains, blocks
  `javascript:`, `data:`, `vbscript:`, and `file:` schemes, and validates with `new URL()`.
- **Replaced Fixed Timeout Settle** — Removed the 800 ms `setTimeout` fallback; navigation now waits
  for `waitForPageSettled()` (network idle gate).

#### 🎭 Phase 2 — Dual-Frame Settle Gate (`settle-gate.ts`)

- **Double `requestAnimationFrame` Finish** — The `finish()` callback in `waitForPageSettled` now
  waits through two animation frames, ensuring CSS transitions, layout reflows, and async state
  hydration have fully completed before the agent proceeds.

#### 👁️ Phase 3 — Occlusion-Aware Perception (`engine.ts` — `read_page`)

- **Viewport Annotations** — Every interactive element is now tagged with one of `[in-viewport]`,
  `[below-fold]`, or `[above-fold]` based on live `getBoundingClientRect()` measurements.
- **Occlusion Tags** — Elements covered by sticky headers or modals receive `[occluded]` via
  `elementFromPoint()` cross-check.
- **Disabled Tags** — Elements with `disabled` or `aria-disabled="true"` receive `[disabled]`.
- **Embedded Iframe Detection** — A new `EMBEDDED IFRAMES` section in `read_page` output lists all
  accessible iframe URLs so the agent can decide when to switch to `act_on_element` or
  `eval_page_script`.

#### 📋 Phase 3 — Form Filler Upgrade (`form-filler.ts`)

- **`setNativeValue()` Keyboard Pipeline** — Form filler now fires the same full keyboard event
  sequence as the typer, ensuring React-managed form fields register value changes correctly.

#### 🔧 Phase 3 — `act.ts` Primitive Upgrades

- **`ActOptions`** extended with `submitWithEnter` and `coordinates`.
- `click` branch: SVG container resolution, disabled check, and coordinate support added.
- `type` branch: native setter + full keyboard pipeline + `requestSubmit()` wired in.

#### 🗂️ Schema & Tool Declaration Alignment

- `ClickSchema`: new optional `coordinates: { x: number; y: number }` field.
- `TypeSchema`: new optional `submitWithEnter: boolean` and `mode: 'replace' | 'append' | 'prepend'`.
- `ActOnElementSchema`: new optional `submitWithEnter` and `coordinates`.
- `AGENT_TOOLS` (`index.ts`): `click_element`, `type_text`, and `act_on_element` declarations updated.

#### 🗺️ Phase 4 — Tool Routing Decision Matrix (`prompts.ts`)

- Added **`### 🗺️ TOOL ROUTING PRIORITY MATRIX`** section to `AGENT_SYSTEM_PROMPT`:
  - Per-situation routing table for clicking, typing, page reading, navigation, and research.
  - Explains how to react to every `read_page` annotation tag (`[occluded]`, `[disabled]`,
    `[below-fold]`, `[in-viewport]`, `EMBEDDED IFRAMES`).
  - Establishes `knowledge_graph_query → web_search` priority chain.
  - Specifies `submitWithEnter` and `coordinates` usage patterns.

#### 🧪 Phase 5 — Verification

- **136 tests across 29 test files** — all passing (`npx vitest run`).
- **Zero TypeScript errors** (`npm run compile` → exit 0).
- **Production build** — `.output/nim-agent-1.4.1-chrome.zip` (1.44 MB).

---

## v1.4.0 — 2026-10-02

### 🗂️ In-Browser Virtual Workspace, Coding Space & Autonomous Agent Intelligence

- **🗂️ NIM Virtual Workspace (VFS):**
  - Built an IndexedDB-backed Virtual File System (`src/lib/workspace/vfs.ts`) providing private, persistent, offline-capable in-browser storage.
  - Full file & folder hierarchy with default directories: `/notes/`, `/research/`, `/code/`, `/data/`, and `/trash/`.
  - Added agent workspace tools: `workspace_create_file`, `workspace_append_file`, `workspace_read_file`, `workspace_list_files`, `workspace_delete_file`, and `workspace_search`.
  - New **WorkspacePanel** UI: folder navigator, markdown viewer, monospace editor, full-text search, file download, and full workspace JSON backup/restore.

- **🔬 Timed Deep Research Engine ("Unstoppable Web Crawler"):**
  - Autonomous multi-site web crawler (`src/lib/agent/deep-research.ts`) that explores the open web continuously until user's timer expires (e.g. 1m, 2m, 5m, 10m, 30m).
  - **Simultaneous Live Note-Taking:** Streams live findings and quotes into `/research/<topic>/live_notes.md` in real-time as pages are crawled.
  - Automatically synthesizes an **Executive Dossier** (`EXECUTIVE_REPORT.md`) with comparative matrix, deep-dive chapters, and citation index upon timer expiration.
  - Upgraded **ResearchPanel** into a Mission Control HUD with countdown timer, live status ticker, live notes stream, and workspace dossier browser.

- **💻 NIM Coding Space:**
  - Dedicated developer environment tab in the side panel (`CodingSpacePanel.tsx`).
  - Monospace code editor with line numbers, Tab key indentation, and syntax support for JS, HTML, Python, and JSON.
  - **In-Browser Sandboxed Runner:** Executes JavaScript in an isolated sandbox with console interception (`log`, `warn`, `error`, `return`) and execution timeout protection.
  - **Live Web App Preview:** Sandboxed `<iframe>` with instant live rendering for HTML/CSS/JS frontend prototypes.
  - **AI Coding Assistant:** Generate, refactor, and debug scripts saved directly into `/code/`.

- **🧠 Lifelong Conversational Session Memory & Auto-Summarizer:**
  - Built `src/lib/agent/session-memory.ts` to preserve dialogue context, discovered facts, and user preferences across turns.
  - Automatically compresses older conversation turns into high-density rolling memory while retaining recent dialogue verbatim, eliminating token explosion and amnesia.

- **⚡ Full Autonomous Proactivity (Upgraded System Prompts):**
  - Overhauled `AGENT_SYSTEM_PROMPT` in `src/lib/agent/prompts.ts` with autonomous decision-making heuristics.
  - The agent proactively saves research to `/research/`, scripts to `/code/`, notes to `/notes/`, and tables to `/data/` without requiring user micro-direction.
  - Connects seamlessly to earlier context across follow-up queries.

### 🚀 Pure Autonomous AI Browser Agent Transformation

- **Decommissioned Desktop Subsystems:** Removed all legacy Python desktop subsystems, root runners (`run.py`, `run.bat`), and temporary runner scripts.
- **Removed Local WebSocket Bridge:** Completely decoupled the browser extension from the local `ws://127.0.0.1:7432` bridge and removed `'http://127.0.0.1:7432/*'` from host permissions in `wxt.config.ts`.
- **Pure Browser Extension Architecture:** Clean standalone Manifest V3 extension for Chrome, Edge, Brave, Opera, and Firefox Add-on.
- **Autonomous In-Browser ReAct Loop:** Enhanced DOM reader, numeric element tagging, atomic form filling (`fill_form`), and download exports.
- **Background Watch Engine:** Alarm-driven background monitors with native browser notifications for price drops and stock changes.
- **Privacy & Security:** All API keys and session memories remain strictly sandboxed in local browser extension storage with zero telemetry.
- **Refreshed Documentation & Portal:** Replaced all hybrid desktop references across `README.md`, `USER_GUIDE.md`, `website/index.html`, and `website/js/app.js` with pure browser agent documentation and simulators.


### 🎙️ Voice & Speech System (Feature 6 — Privacy-First STT with True Barge-In)

- **TTS Audio Fix:** Replaced broken PowerShell COM `wmplayer.ocx` subprocess with in-process **`pygame.mixer`** playback — sub-10ms startup, zero subprocess overhead. Voice now actually speaks.
- **New `src/voice/vad.py`:** Continuous 16kHz real-time Voice Activity Detection using `sounddevice` + `webrtcvad`. Auto-calibrates ambient room noise floor on startup (first 600ms) and debounces speech onset across multiple frames to eliminate false triggers from keyboard clicks and background noise.
- **New `src/voice/stt.py`:** Privacy-first local Speech-to-Text engine transcribing raw 16kHz PCM audio buffers to text using `SpeechRecognition` with async executor delivery.
- **Upgraded `src/voice/barge_in.py`:** Coordinated `BargeInController` links VAD, STT, TTS, and `AgentOrchestrator`. When you speak mid-response: (1) TTS audio cuts in < 15ms, (2) running LLM stream and tools cancelled if and only if a task is active, (3) your speech is transcribed and routed as the new goal.
- **New voice CLI commands:** `/mic on` / `/mic off` (ambient listening), `/listen` (single-phrase capture), `/persona <name>` (switch neural voice), `/voice <text>` (speak).
- **New voice tools registered in agent:** `speak_text`, `listen_voice`, `toggle_voice_input`, `set_voice_persona`.
- **Voice personas:** JARVIS (`en-US-GuyNeural`), FRIDAY (`en-US-AriaNeural`), Christopher, Jenny, Sonia, Ryan.

### 🖥️ Desktop HUD Redesign (Stitch Cyberpunk Acrylic Design System)

- **New 5-part modular layout** based on StitchMCP-generated cyberpunk glassmorphic design:
  - **Top Telemetry Header:** Animated reactor orb, `NIM_AGENT_OS // v1.1_STABLE` brand, `GEMINI FLASH [ONLINE]` provider badge, live `SYS_RES: CPU % | RAM MB` (polled via `psutil`), and prominent red **`⏻ ESC CANCEL`** kill-switch button.
  - **Left Subsystem Quick-Dock:** One-click icons for Actuation, Process Baseline, Scheduler, File Converter, Outlook Email, and Atomic Undo.
  - **Center Reasoning Stream (`LOG_STRM`):** Live goal banner, active tool telemetry, timestamped execution log with auto-scroll.
  - **Proactive Ambient Drawer:** Slide-in contextual cards for Downloads watcher and Clipboard classifier with `Approve`/`Dismiss` actions.
  - **Bottom Command Prompt:** Terminal cursor `⌘ What should I execute? █`, real-time Edge-TTS audio waveform visualizer, `[Ctrl + Space]` hotkey pill, and `RUN ⚡` button.
- **Updated `theme.py`:** Full Stitch Design System color tokens — Deep Cyber Navy `#071425`, Neon Sage `#8fb7ab`, Bright Coral `#df6b48`, Departure Mono font.
- **Updated `acrylic.py`:** Enhanced Windows DWM `SetWindowCompositionAttribute` with Deep Navy tint and robust fallback.

### 👁️ Vision Tool Fix

- **Fixed `vision_describe_image` returning "Tool execution failed":** Default vision provider changed from broken NVIDIA NIM endpoint to **Gemini** (`models/gemini-flash-lite-latest`) which is already configured and works instantly.
- **Provider fallback chain:** Gemini → NVIDIA NIM (corrected model path `meta/llama-3.2-90b-vision-instruct`) → OpenAI → Ollama.
- **Error surfacing:** Vision failures now include the actual error reason and a fix hint in the agent's observation, instead of a blank "Tool execution failed".

### 🧠 Agent Loop

- **`is_busy` state on `AgentOrchestrator`:** Tracks whether a task is actively executing. `cancel_current_task()` now returns `bool` indicating if a task was actually aborted. Prevents spurious `⛔ Task cancelled` spam when the agent is idle and ambient mic picks up sound.

### 🧪 Tests

- **60 automated tests** passing across all desktop subsystems (up from 55 in v1.0.0).
- **5 new voice tests** in `desktop/tests/test_voice.py`: TTS engine, VAD energy calibration, STT PCM→WAV, BargeInController coordination, and all 4 voice tools.

---

## v1.0.0 — 2026-08-29


### 🚀 Major Release: Unified Windows Desktop Automation & Browser Copilot

#### Windows Desktop Automation Suite (`desktop/`)
- **Actuation & Mouse/Keyboard Control:** Windows UI Automation (UIA) tree target grounding, vision LLM fallback, Bézier smooth mouse curves, and closed-loop visual dHash verification.
- **Application & Multi-Window Management:** Friendly application alias launcher, focus stealing bypass, multi-monitor movement, workspace spatial snapshots, and layout restorer.
- **Context-Aware Scheduler:** Natural language & cron-based scheduling (`"every weekday at 9am"`), meeting gatekeeper, and missed-job recovery.
- **Memory-Aware Email Integration:** Microsoft Outlook COM and SMTP/IMAP client, automated follow-up tracking, sensitive information redactor, and mass-send risk guards.
- **Adaptive Process & Resource Monitor:** SQLite per-app baseline learning, resource anomaly scoring, deep file/socket inspection, and safe undoable kill with state checkpointing.
- **Vision-Verified File & Format Converter:** Bidirectional conversion across CSV, XLSX, DOCX, Markdown, PDF, images, and archives (`zip`, `tar.gz`) with closed-loop perceptual spot-checks.
- **Global `ESC` Key Kill-Switch:** Press `ESC` at any time to instantly sever the LLM SSE stream, abort running tool operations, silence TTS audio, and reset the HUD.
- **Rate-Limit Resilient Routing:** Primary brain set to Google AI Studio Gemini Flash with dynamic 35s rate-limit cooldown recovery + NVIDIA NIM Vision (Llama-3.2-90B).
- **Floating Acrylic HUD:** Tkinter acrylic overlay (`Ctrl+Space`), SSE reasoning logs, and Edge-TTS neural speech (`JARVIS`/`FRIDAY`).
- **Comprehensive Test Suite:** 55 automated tests covering all desktop automation subsystems in `desktop/tests/`.

#### Browser Extension Integration
- **WebSocket Bridge:** Live bidirectional bridge connecting desktop Python runtime and Chromium extension on `ws://127.0.0.1:7432`.
- **Multi-Browser Compatibility:** Support for Chrome, Microsoft Edge, Brave, and Chromium browsers.

---

## v0.4.0 — 2026-08-28

### Added

- Deterministic saved-macro replay, including step-by-step status in the Tasks panel.
- Semantic target resolution and a budget-checked model fallback to self-heal replay steps when page elements change.
- Optional saved-macro execution when a Watch Mode condition matches.
- Markdown rendering for assistant replies: headings, ordered and unordered lists, code blocks, and tables.
- Tests for macro replay, Markdown parsing, and retry-delay extraction.

### Improved

- LLM request and streaming retries now interpret provider quota delays and `Retry-After`, retry transient failures up to five times, and surface retry status.
- Navigation tracks the newly opened tab, waits for document completion, and allows time for SPA hydration before the next tool action.
- Macro traces retain target labels and reasoning, and macro/watch outcomes are captured in the security audit log.
