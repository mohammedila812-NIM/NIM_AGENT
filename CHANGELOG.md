# Changelog

All notable changes to NIM Agent are documented here.

## v1.1.0 — 2026-08-30

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
