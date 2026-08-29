# NIM JARVIS Desktop: Next-Gen Perception, Voice STT/TTS & Futuristic HUD Overlay

This implementation plan details the architecture and roadmap for advancing **NIM JARVIS Desktop** into a full autonomous Jarvis-like operating partner with deep screen perception, natural voice conversation, and a futuristic glassmorphic Desktop HUD overlay.

---

## 🔬 Research Note: How the Best Computer-Use Agents Achieve Precision

Before redesigning the perception stack, it's worth looking at what already works in production. **NeuralAgent** is the closest existing product to what you're building — a desktop agent that watches the screen and drives mouse/keyboard directly, no API required. A few things it does are directly reusable here:

- **Two-tier model architecture.** NeuralAgent trains a small, purpose-built model (they call it *NeuralAction*) that does one job only: turn the current screen into a grounded mouse/keyboard action. It's reported at roughly 285ms per action and close to frontier-model-level accuracy, but far cheaper. A separate, stronger reasoning model is only invoked for planning and for recovery when something looks wrong. Routine clicking never touches the expensive model.
- **Specialized sub-agents per domain**, rather than one generic system prompt for everything (their public specialist agents include a coding-focused one and a research-focused one). A narrower prompt and tool set per domain measurably reduces mistakes versus a single do-everything agent.
- **Continuous supervision, not just error-triggered recovery.** The stronger reasoning model gets pulled in specifically when the interface changes state unexpectedly — not only after an action throws an error, which is a meaningfully different (and better) trigger.
- **Reusable, parametrized workflows.** A workflow is captured once and replayed with new variables, with the fast model handling the repeat runs and only escalating on drift — the same shape as the Learn-by-Demonstration idea from your broader plan.

The open building block that implements the "fast, precise seeing" half of this is **Microsoft's OmniParser**. It doesn't try to have one model both see and reason — it runs a small, fast object-detection model (a fine-tuned YOLO) to draw a tight box around every clickable element on screen, then a second small captioning model (Florence-2) to describe what each box does ("gear icon → Settings"). The output is a clean, structured list of elements with bounding boxes and functional labels — which is then handed to a general LLM for reasoning. This is exactly Set-of-Marks, but generated automatically instead of by manual heuristics, and it's the technique that measurably fixes GPT-4V's grounding problem in Microsoft's own benchmarks.

Other relevant reference points:
- **ByteDance's UI-TARS-desktop** operates at full OS level (not just browser) — clicking system tray icons, navigating file explorers, changing system settings — and pairs a visual desktop-control component with a separate API/MCP-capable reasoning layer. That split maps closely onto your Browser Bridge / Desktop Execution divide.
- **Simular's Agent S2** replans after *every* subtask, not only when a step fails — since a UI can silently change state (a toast appears, a dialog steals focus) even when the click itself "succeeded."
- **UiPath's Computer Vision activities** exist specifically because accessibility trees/selectors don't work reliably inside Citrix/VDI/remote-desktop sessions — a reminder that pure-vision grounding isn't just a fallback tier for you either; it's the *only* option in a large class of enterprise environments.
- **License note:** OmniParser's code is MIT, but its detector weights are a YOLOv8 fine-tune, and YOLOv8's license is AGPL — a real constraint if NIM JARVIS is ever distributed as closed-source. Options: use OmniParser only for personal/internal builds, retrain a detector on a permissively-licensed base, or evaluate UI-TARS' open weights or ShowUI/SeeClick as alternatives before shipping anything publicly.

---

## 🏗️ Architecture & Component Roadmap

```
                                  ┌──────────────────────────────────────────────┐
                                  │       NIM JARVIS DESKTOP AGENT (Core)        │
                                  └──────────────────────┬───────────────────────┘
                                                         │
         ┌───────────────────────┬───────────────────────┼───────────────────────┬───────────────────────┐
         │                       │                       │                       │                       │
         ▼                       ▼                       ▼                       ▼                       ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Phase 2:        │    │  Phase 3:        │    │  Phase 4:        │    │  Phase 5:        │    │  Phase 6:        │
│  Perception      │    │  Voice & Speech  │    │  HUD & Overlay   │    │  Trigger Engine  │    │  MCP & Bridge    │
│  Hierarchy       │    │  (STT/TTS)       │    │  (Glassmorphic)  │    │  & Watchers      │    │  Ecosystem       │
├──────────────────┤    ├──────────────────┤    ├──────────────────┤    ├──────────────────┤    ├──────────────────┤
│• Structured Read │    │• Whisper / STT   │    │• Transparent HUD │    │• File Watcher    │    │• MCP Client      │
│• Accessibility   │    │• Edge-TTS/Eleven │    │• Waveform Visual │    │• Clipboard Watch │    │• Browser Sync    │
│• Screen Capture  │    │• Barge-In Voice  │    │• Thought Stream  │    │• App Lifecycle   │    │• Shared Context  │
│• Precision       │    │• VAD Detection   │    │• Hotkey Summon   │    │• Cron Schedules  │    │• Tool Federation │
│  Visual Grounding│    │                  │    │• Approval States │    │                  │    │                  │
└──────────────────┘    └──────────────────┘    └──────────────────┘    └──────────────────┘    └──────────────────┘
```

---

## 1. Phase 2: Perception Hierarchy & Screen Analysis

### Concept: Perception Hierarchy
Never take expensive, slow screenshots when structured programmatic data is available. And once you do need vision, don't ask one general model to both find and understand — split those jobs, the way every production computer-use agent does.

1. **Level 1 (Direct Structured Parse)**: Excel (`openpyxl` / `pandas`), Word (`python-docx`), PDF (`pypdf`), CSV/JSON.
2. **Level 2 (UI Automation & Accessibility Tree)**: Inspect focused window, buttons, menus, and text fields via Windows UI Automation / `pywinauto`.
   - **Not available in remote/virtual sessions (new)**: Citrix, RDP, and most VDI environments render pixels only — no accessibility tree exists to query. Detect this case (no UIA elements returned for a window that clearly has controls) and fall straight to Level 4 rather than assuming Level 2 always works. This matters if NIM JARVIS is ever used against enterprise/legacy systems, not just local apps.
3. **Level 3 (Window & Region Screen Capture)**: Focused application window or desktop multi-monitor capture using `mss`.
   - **Screen-diffing (new)**: hash/diff captured regions between frames; only re-run downstream analysis on regions that actually changed. This matters most for the HUD's live Thought Stream and any "watch mode," where a naive implementation would otherwise re-capture and re-analyze the full screen dozens of times a minute.
   - **DPI/multi-monitor scaling awareness (new)**: Windows per-monitor DPI scaling (100%/125%/150%/200%) means a screenshot's pixel coordinates do not equal actual screen coordinates unless the capture and the click-injection code both account for the active scale factor per monitor. This is a common, silent source of "the agent clicked the wrong spot by a consistent offset" bugs — worth a dedicated coordinate-translation utility used by every click/drag action, tested explicitly at 100/125/150/200%.
4. **Level 4 (Precision Visual Grounding — redesigned)**: Two separate models, not one:
   - **Detector pass**: a fast, fine-tuned object-detection model finds every interactable region (buttons, icons, fields, links) and returns tight bounding boxes — this is the "where" step, and it should run in well under a second.
   - **Captioner pass**: a small vision-captioning model labels what each detected region does ("floppy disk icon → Save"), producing a structured element list.
   - **Reasoning pass**: only now does the general LLM (Gemini Vision / NVIDIA NIM VLM / GPT-4V) see the screenshot — annotated with auto-generated Set-of-Marks from the two passes above — and decide *which* labeled element to act on. It is reasoning over labels and boxes, not guessing raw pixel coordinates.
   - **Fast-path/slow-path routing (new)**: routine, previously-seen UI states go through the detector+captioner pass alone with a cached/simple action mapping; the full reasoning LLM is only invoked for planning, ambiguous screens, or when the detector's output doesn't match what was expected (see verification below).
   - **Cross-validation (new)**: when Level 2 accessibility data is also available, compare it against the Level 4 detector's output for the same region — a mismatch (e.g. accessibility says "TextBox: 1,204.50" but OCR/vision reads "1,204.30") should be flagged rather than silently trusted, especially for numeric/financial data.

### Post-Action Verification (new)
Don't only recover when an action throws an error. After every click/type/action, re-run a lightweight detector pass on the affected region to confirm the expected state actually changed (a dialog appeared, a value updated, a page navigated). A click can "succeed" with no exception and still do nothing — a moved button, a covered dialog, a disabled control — and that failure mode is invisible unless you check.

### New Tools to Implement:
- `analyze_spreadsheet`: Open, inspect sheets, formulas, cell summaries, and compute statistics from any active or target `.xlsx`/`.csv`.
- `get_active_window_info`: Returns title, process name, window bounds, and UI accessibility elements of the currently focused application (and explicitly reports when no accessibility tree is available, e.g. inside a remote session).
- `capture_screen_region`: Captures full screen or target application window, returning base64/file path with visual element annotations; DPI-scale-aware coordinates included.
- `ocr_screen_text`: Fast local text recognition on any window or screen rectangle without cloud latency.
- `parse_screen_elements` (new): Runs the detector+captioner pipeline on a screenshot/region and returns a structured, numbered element list (bounding box, label, interactable flag) — the automated Set-of-Marks generator.
- `verify_action_result` (new): Re-checks a region after an action to confirm the expected state change occurred; returns success/mismatch/unclear.
- `redact_sensitive_regions` (new): Runs before any screen content is sent to a cloud model — pattern-matches and blanks card numbers, SSNs, and password-manager fields detected via OCR.

---

## 2. Phase 3: Real-Time Voice Interaction (STT / TTS & Barge-In)

### Capabilities:
- **Speech-to-Text (STT)**:
  - Streaming Voice Input via Whisper (Local `faster-whisper` or Cloud Whisper / Groq API for sub-300ms transcription).
  - WebRTC Voice Activity Detection (`webrtcvad`) & Silero VAD to detect when the user starts speaking.
  - **Privacy-first buffering (new)**: only retain/transcribe audio *after* wake-word detection; the always-listening stage should run a tiny local wake-word model only, never a full continuous recording buffer written to disk.
- **Natural Voice Synthesis (TTS)**:
  - Ultra-fast natural TTS via `edge-tts` (neural voices: *Christopher*, *Aria*, *Guy*) or ElevenLabs API.
- **Barge-In Interruption**:
  - If JARVIS is speaking and you start talking ("*Wait, cancel that and open Excel instead*"), the audio playback terminates instantly and JARVIS switches to listening mode.
  - **False-positive guard (new)**: distinguish real barge-in speech from background media (a TV, a call, music) — require either a short wake-word-adjacent cue or a VAD confidence/debounce threshold before interrupting, otherwise background audio will constantly cut JARVIS off mid-sentence.

---

## 3. Phase 4: Futuristic JARVIS HUD & Floating Screen Overlay

```
  ┌────────────────────────────────────────────────────────────────────────────────┐
  │  [⚡ NIM JARVIS]   🟢 Online  │  🧠 Gemini Flash Lite  │  🎙️ Listening... [  -|||-  ] │
  ├────────────────────────────────────────────────────────────────────────────────┤
  │  Active Task: "Analyzing quarterly financials.xlsx & drafting summary doc"     │
  │  ↳ Thought Stream: "Reading sheet 'Q3_Revenue'... Found 14% EBITDA growth"      │
  │                                                                                │
  │  [⚡ Step 1: read_file]  [⚡ Step 2: analyze_sheet]  [⏸ Step 3: awaiting approval] │
  │                                                                                │
  │  Quick Actions:  [ 📄 New Doc ]  [ 📊 Analyze Screen ]  [ ⏪ Undo Last Action ] │
  └────────────────────────────────────────────────────────────────────────────────┘
```

### HUD Architecture:
- **Framework**: Modern Glassmorphic Frameless Window (PySide6 / PyQt6 with translucent background & Acrylic blur, or lightweight Tauri/Webview overlay).
  - **Cross-platform overlay caveat (new)**: true acrylic/blur transparency, always-on-top behavior, and click-through (so the HUD doesn't block clicks to the app underneath except on its own controls) are implemented very differently per OS — layered windows + `WS_EX_TRANSPARENT` region hit-testing on Windows (DWM composition) vs. `NSVisualEffectView` + per-view `ignoresMouseEvents` on macOS. Budget this as real, separate engineering per platform rather than one shared code path.
- **Summon Hotkey**: `Win + Shift + J` or `Ctrl + Space` toggles HUD floating bar anywhere across the OS.
- **Visual Features**:
  1. **Reactor Core / Audio Waveform**: Animated pulsating aura reacting to JARVIS's thought cycles and voice amplitude.
  2. **Live Action Strip**: Floating badge indicators showing real-time tool execution (`write_file`, `web_search`, `run_command`), **including a distinct "awaiting approval" state (new)** — separate from "thinking" and "acting" — so a paused task is visually unmistakable, not just quietly stalled.
  3. **Thought Stream Ticker**: Translucent HUD readout of what JARVIS is currently planning and reasoning.
     - **Redaction before display (new)**: run the same sensitive-content redaction used for cloud vision calls on anything shown in the ticker — a live reasoning feed is exactly what gets screen-recorded during a demo or glanced at by someone walking by.
  4. **Snapshots & Undo Drawer**: One-click rollback button hovering whenever a file is modified.
  5. **Screen Region Snapper**: Click-and-drag crosshair to select any window or chart on screen for JARVIS to analyze.
  6. **Pre-Click Highlight (new)**: before executing any click/type on a risky or first-seen element, briefly highlight the target region on screen (a flash outline) so the user can see exactly what's about to be interacted with — critical once precision visual grounding is doing the targeting instead of a human.
  7. **Recording Indicator (new)**: a persistent, unmistakable icon whenever screen capture or watch mode is active — no silent background perception, ever.

---

## 4. Phase 5: Autonomous Trigger Engine & Event Watchers

- **Folder Watcher**: Monitors `Downloads/` and `Desktop/` to automatically unpack archives, format messy file names, or notify of incoming PDFs.
- **Clipboard Intelligence**: Automatically detects copied URLs, error logs, or data tables and offers 1-click transformation tools.
- **Cron Automation**: Runs scheduled background tasks (e.g. daily news brief, weekly financial report generation, system backup).
- **Unattended-approval queue (new)**: any trigger-fired task that would take a risky action (delete, send, purchase, install) queues for approval rather than firing silently just because it was scheduled — a schedule shouldn't imply blanket pre-approval for everything the task ends up doing.

---

## 5. Phase 6: MCP (Model Context Protocol) & Ecosystem Sync

- **Native MCP Client**: Connects NIM JARVIS to community MCP servers (GitHub, SQLite, Postgres, Memory, Docker, Unity).
- **Shared Memory with NIM Agent**: Shared clipboard, shared task state, and cross-platform handoff.
- **Tool federation (new)**: MCP tools, native desktop tools, and browser-bridge tools should register into one shared tool schema, so the planner treats "call a GitHub MCP tool" and "call `write_file`" as the same kind of thing rather than two separate integration paths.

---

## 6. Specialized Sub-Agents (new)

Rather than one generic system prompt handling every task type, define narrower domain-specialist agent profiles — each with a tighter tool set, a prompt tuned to that domain's failure modes, and (later) its own fine-tuned grounding cache for that app's UI:

| Specialist | Scope | Example |
|---|---|---|
| Spreadsheet Agent | Excel/Sheets structured analysis, formula auditing | "Find the formula error in row 44" |
| Document Agent | Drafting/formatting docx/pdf/pptx, citation/review pass | "Turn this outline into a formatted proposal" |
| System Agent | File management, process control, installs | "Clean up my Downloads, keep anything from this week" |
| Research Agent | Multi-source lookup via Browser Bridge/MCP, synthesis | "Compare pricing across these three vendors" |
| Coding Agent | IDE-focused: read/write code, run tests, interpret errors | "Fix the failing test and explain why it broke" |

The Goal Parser's first job becomes routing to the right specialist (or a general fallback) rather than handling everything with one broad prompt.

---

## 7. Background / Unattended Execution Mode (new)

A meaningful chunk of the value here is the agent working *while the user keeps using the computer normally* — which the current design doesn't yet address, since a shared mouse/keyboard means the agent and the user fight for control.

Two real options, different tradeoffs:
- **Hidden virtual desktop (Windows) / separate session**: run the automated task on a second virtual desktop or an isolated session the agent controls exclusively, while the user's foreground desktop stays untouched. Lower overhead, but some apps behave oddly when not the foreground window (rendering, focus-dependent behavior).
- **Nested VM**: run a full lightweight VM for unattended tasks. Cleanest isolation and closest to how NeuralAgent's cloud/enterprise execution works, but heavier to set up and maintain, and file/clipboard sharing between VM and host needs explicit design.

Either approach needs its own recording-indicator equivalent and its own approval queue — "the user isn't watching this session" is exactly when unattended risky actions matter most.

---

## 📋 Proposed Changes & Files to Build

### Perception Engine (`desktop/src/perception/`)
- `desktop/src/perception/screen.py`: Fast multi-monitor capture & window cropping via `mss`, with DPI-scale-aware coordinate translation and screen-diffing.
- `desktop/src/perception/window.py`: Active window detection & UI Automation tree using `win32gui` and `ctypes`; reports when no accessibility tree is available (remote/VDI sessions).
- `desktop/src/perception/excel.py`: Advanced spreadsheet structure analyzer with formula & cell range summaries.
- `desktop/src/perception/vision.py`: Local OCR & Multimodal visual prompt packaging (the reasoning-pass side of Level 4).
- `desktop/src/perception/grounding.py` (new): Detector + captioner pipeline (OmniParser-style or equivalent) producing structured, numbered elements — the "where + what" step that runs before the reasoning LLM.
- `desktop/src/perception/verify.py` (new): Post-action state-change verification.
- `desktop/src/security/redaction.py` (new): Sensitive-content pattern matching and blanking, shared by cloud vision calls and the HUD Thought Stream Ticker.

### Voice Engine (`desktop/src/voice/`)
- `desktop/src/voice/stt.py`: Streaming microphone capture, VAD, and Whisper transcription; wake-word-gated buffering.
- `desktop/src/voice/tts.py`: Neural voice generation with edge-tts & async audio playback.
- `desktop/src/voice/barge_in.py`: Real-time audio interruption manager with false-positive debounce.

### GUI & HUD Overlay (`desktop/src/ui/hud/`)
- `desktop/src/ui/hud/window.py`: Glassmorphic frameless floating HUD overlay with hotkey summon, per-OS click-through handling.
- `desktop/src/ui/hud/widgets.py`: Waveform visualizer, tool execution pills (including an "awaiting approval" state), thought stream ticker (redaction-aware), undo drawer, pre-click highlight overlay.
- `desktop/src/ui/hud/theme.py`: Cyberpunk / Iron Man Jarvis dark neon theme with acrylic blur.

### Agent Profiles (`desktop/src/agents/`)
- `desktop/src/agents/specialists.py` (new): Domain-specific agent profiles (Spreadsheet, Document, System, Research, Coding) and the routing logic that picks between them.

---

## 🎯 Verification Plan

### Automated Tests:
- `pytest tests/test_perception.py`: Verify spreadsheet structured analysis, window detection, and screen cropping.
- `pytest tests/test_voice.py`: Verify TTS synthesis and speech event handling.
- `pytest tests/test_hud.py`: Verify HUD event binding and hotkey listener initialization.
- `pytest tests/test_grounding.py` (new): Verify the detector+captioner pipeline against a small internal benchmark of labeled app screenshots (own "ScreenSpot"-style set) — track hit-rate % and latency per release so accuracy regressions are caught, not just presence/absence of a crash.
- `pytest tests/test_dpi_scaling.py` (new): Verify click-coordinate translation is correct at 100%/125%/150%/200% display scaling and across a two-monitor setup with mixed scale factors.
- `pytest tests/test_ui_drift.py` (new): Adversarial test — resize the target window, switch its theme (light/dark), or move a button, and verify the agent still locates the correct element via the vision path rather than only succeeding when the UI is pixel-identical to training/dev conditions.

### Interactive Verification:
- Open an Excel sheet on screen, summon JARVIS via voice or hotkey: *"Analyze the revenue trends on my screen"*.
- Verify JARVIS captures the structured data, reasons in the HUD thought ticker, speaks the answer, and generates a formatted Word/PDF summary.
- Run the same task inside a remote desktop/VDI session (or a VM with accessibility APIs disabled) and confirm the agent falls back to the vision grounding path correctly rather than failing silently.

---

## Competitive Landscape (for context, not to copy verbatim)

| System | Approach | Relevant takeaway for NIM JARVIS |
|---|---|---|
| NeuralAgent | Small trained grounding model + escalation to a reasoning model; specialized sub-agents; enterprise dashboard for multi-machine supervision | The two-tier model split and sub-agent routing are directly reusable |
| Microsoft OmniParser | Open-source detector+captioner pipeline for auto Set-of-Marks | Concrete building block for `grounding.py`; note the AGPL detector-weight caveat |
| ByteDance UI-TARS-desktop | Pure-vision OS-level control, paired with an API/MCP reasoning layer | Validates the Desktop-Execution/Browser-Bridge split already in the broader plan |
| Simular Agent S2 | Replans after every subtask, not just on failure | Motivates the post-action verification step above |
| OpenAI Operator/CUA | General vision+RL model acting via screenshots only | Shows the ceiling of a single-model approach — reinforces why a dedicated grounding step outperforms it on precision |
| UiPath Computer Vision | Purpose-built detector for Citrix/VDI where selectors don't exist | Confirms pure-vision grounding is a first-class requirement, not just a fallback, for real enterprise use |
