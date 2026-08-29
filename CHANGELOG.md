# Changelog

All notable changes to NIM Agent are documented here.

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
