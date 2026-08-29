# NIM JARVIS — Missing Features Specification

> **Generated:** 2026-08-29 | **Current Version:** Phase 1 Complete  
> **Purpose:** Authoritative design spec for all remaining features, including architectural decisions and differentiators vs. generic RPA tools.

---

## ✅ Currently Built

| Category | Features |
|:---|:---|
| **File System** | `read_file`, `write_file`, `move_file`, `delete_file`, `search_files`, `diff_files`, `list_dir` |
| **Shell** | `run_command` (sandboxed PowerShell with process-tree cleanup) |
| **Documents** | Generate `.docx`, `.xlsx`, `.pdf`, `.pptx`, `.md` with tables & styling |
| **Web** | `web_search` (DuckDuckGo), `read_url` (static HTML→Markdown) |
| **System** | `get_clipboard`, `set_clipboard`, `notify_user`, `get_system_info` |
| **Perception** | Spreadsheet audit, active window inspector, screen capture, OCR (Tesseract), vision LLM |
| **Actuation (GUI)** | `click_element`, `click_coordinate`, `type_text`, `send_hotkey`, `drag_and_drop`, `scroll_wheel` |
| **Window & Apps** | `open_application`, `focus_window`, `close_window`, `resize_window`, `set_window_state`, `list_open_windows`, `save_workspace`, `restore_workspace`, `move_window_to_monitor` |
| **Scheduler (Cron)** | `schedule_task`, `list_scheduled_tasks`, `cancel_scheduled_task`, `pause_scheduler`, `resume_scheduler` |
| **Email (Outlook & SMTP)** | `read_emails`, `send_email`, `reply_email`, `search_emails`, `track_email_reply` |
| **Process & Resource Monitor** | `list_processes`, `get_process_details`, `kill_process`, `restart_process`, `monitor_process_baseline` |
| **File & Archive Converter** | `convert_file`, `compress_archive`, `extract_archive`, `render_document_preview` |
| **Control & Cancellation** | Global `ESC` key task abortion, immediate SSE stream disconnection, voice TTS cutoff |
| **Voice** | TTS output via Edge-TTS neural voices (`JARVIS` / `FRIDAY`) |
| **Safety** | Snapshot rollback, atomic undo, SecurityGuard risk evaluator, sensitive data redactor |
| **Bridge** | NIM Agent browser extension WebSocket delegation (`ws://127.0.0.1:7432`) |
| **Memory** | SQLite episodic task memory with WAL mode |
| **Ambient Triggers** | Downloads folder watcher, clipboard entity classifier |
| **HUD** | Glassmorphic floating overlay with acrylic blur, animations, proactive suggestion cards |
| **Dual Vision** | Independent NVIDIA vision LLM provider alongside the Gemini brain |

---

## 🔴 CRITICAL — Core Desktop Automation Gaps

---

### 1. 🖱️ Mouse & Keyboard Control (Hybrid GUI Actuation)

**Status:** ✅ Built (`src/perception/actuation.py`, `src/tools/actuation_tools.py`)

#### Design Philosophy
Do **not** do pure pixel-coordinate clicking like AppAgent or basic pyautogui. Use a **hybrid 3-tier targeting model**:

| Tier | Method | Latency | When Used |
|:---|:---|:---|:---|
| **Tier 1** | Windows UIA / Accessibility Tree (AutomationId, Name, ControlType) | 10ms | Primary — resolution-independent, reliable |
| **Tier 2** | Vision LLM coordinate grounding (NVIDIA model describes bounding box) | 600ms | Fallback when UIA element not found |
| **Tier 3** | Raw pixel coordinate (DPI-scaled) | 5ms | Last resort when vision also fails |

#### Closed-Loop Verification (Critical Differentiator)
After **every** click or keypress action:
1. Capture before-screenshot (already exists via `capture_screen_region`)
2. Execute the action
3. Capture after-screenshot
4. Run perceptual dHash diff (already in `verify_action_result`)
5. If the diff shows no meaningful change → retry with next tier or raise to HITL
6. Log the result to episodic memory for skill-vault learning

#### Pre-Execution Risk Routing
Route **before** execution (not after):
```
User Goal → SecurityGuard.evaluate_tool_call() → Risk Score
  SAFE     → execute immediately
  MODERATE → log + execute
  DESTRUCTIVE → HITL confirm first
  CRITICAL → block + explain
```

#### Tools Required
- `click_element(element_name, window_title)` — UIA-first, coordinate fallback
- `click_coordinate(x, y, button, double_click)` — direct DPI-scaled coordinate
- `type_text(text, interval_ms)` — human-like keystroke timing with modifier support
- `send_hotkey(keys)` — `Ctrl+C`, `Alt+F4`, `Win+D`, `Ctrl+Shift+P`
- `drag_and_drop(start_x, start_y, end_x, end_y, duration_ms)` — smooth bezier path
- `scroll_wheel(direction, clicks, x, y)` — mouse wheel at optional target position
- `right_click_menu(element_name, menu_item)` — open context menu and select item
- `verify_click_result(before_path, after_path)` — closed-loop diff confirmation

**Libraries:** `pyautogui`, `pynput`, `pywinauto`, `win32api`, `comtypes`

---

### 2. 🪟 App Launcher & Memory-Aware Window Manager

**Status:** ✅ Built (`src/perception/window_manager.py`, `src/tools/window_tools.py`)

#### Design Philosophy
Most window managers are **stateless** — they open apps and forget. JARVIS's window manager learns **workspace patterns** from episodic memory and can reconstruct them.

#### Workspace Memory (Key Differentiator)
- When the user manually arranges windows into a productive layout (VS Code left half + Terminal bottom right + Chrome right half), JARVIS silently observes and stores the pattern in episodic memory as a named **workspace snapshot**.
- Later: "Hey JARVIS, switch to dev mode" → instantly restores VS Code + Terminal + Chrome in the memorized layout.
- **Rollback Integration:** Window layouts are snapshotted into the existing `SnapshotManager` before any automation run. A bad run can restore not just files, but the entire desktop state.

#### Tools Required
- `open_application(name)` — launch by friendly name (`"Chrome"`, `"Excel"`, `"Notepad"`, `"VS Code"`)
- `focus_window(title_pattern)` — bring window to foreground by title regex
- `close_window(title_pattern)` — gracefully close (WM_CLOSE first, force after timeout)
- `resize_window(title, width, height, x, y)` — set window position and dimensions
- `minimize_window(title)` / `maximize_window(title)` / `restore_window(title)`
- `list_open_windows()` — all visible windows with title, PID, bounds, monitor
- `save_workspace(name)` — snapshot current window layout to memory
- `restore_workspace(name)` — reopen and reposition apps to saved layout
- `move_window_to_monitor(title, monitor_index)` — multi-display placement

**Libraries:** `pygetwindow`, `win32gui`, `win32con`, `psutil`

---

### 3. ⏰ Context-Aware Intelligent Scheduler

**Status:** ✅ Built (`src/triggers/scheduler.py`, `src/tools/scheduler_tools.py`)

#### Design Philosophy
A cron job that fires blindly is dumb. The scheduler must be **context-aware** — it checks environmental state before running and reasons about whether a missed task is still relevant.

#### Smart Execution Gate
Before any scheduled task fires:
1. **Check mic state** — if voice activity detected, user is in a call → defer N minutes
2. **Check active window** — if `zoom.exe` / `teams.exe` is fullscreen → defer
3. **Check time relevance** — "send morning summary" missed at 9AM → at 3PM, reason: *"This is a morning briefing. Sending now would be confusing. Skip until tomorrow."*
4. **Check system idle** — only run heavy background tasks when CPU < 20% and user idle > 5 min

#### Output Piped to Memory
Every scheduled task's result is stored in episodic memory with the cron label, so the user can search: *"What was in my 9AM summary last Tuesday?"*

#### Tools Required
- `schedule_task(cron_expr, goal, label, context_checks)` — persistent SQLite-backed schedule
- `list_scheduled_tasks()` — view all active schedules with next-run time
- `cancel_scheduled_task(task_id)` — remove a schedule
- `pause_scheduler(duration_min)` — temporarily suspend all scheduled tasks (e.g. during meetings)
- Natural-language parsing: *"every weekday at 8AM"* → auto-converts to `0 8 * * 1-5`
- Missed-task recovery with LLM reasoning about relevance (not blind replay)

**Libraries:** `APScheduler`, `croniter`, `parsedatetime`

---

### 4. 🎞️ Self-Healing Semantic Macro System

**Status:** ❌ Missing

#### Design Philosophy
Traditional RPA macros are brittle literal replays — they break the moment a button moves 10 pixels. JARVIS macros are stored as **semantic step graphs** (`"click the Save button"` not `"click 412,318"`), so the vision LLM can self-heal them when the UI shifts.

#### Proactive Macro Mining (Key Differentiator)
JARVIS should **proactively suggest** turning repeated action patterns into macros — the user never has to press "record":
- After JARVIS completes a multi-step task 3+ times, it mines episodic memory, detects the repetition pattern, and presents: *"I've helped you convert Excel files to PDF 4 times this week. Want me to save this as a 1-click macro?"*

#### Self-Healing Mechanism
If a macro step fails (button not found at expected UIA location):
1. Call `vision_describe_image` to get current UI state
2. Ask vision LLM: *"Where is the Save button in this screenshot?"*
3. Get corrected coordinates / element ID
4. Update the macro step in the vault automatically
5. Resume execution from the failed step (no full restart)

#### Tie-in to Phase 2 Skill Vault
All macros live in the same `~/.nim_jarvis/skills/` vault as compiled Gizmos. A macro that runs successfully 10+ times gets automatically compiled into a deterministic Python function for sub-100ms replay.

#### Tools Required
- `save_macro(name, steps_description)` — save semantic step graph
- `run_macro(name, params)` — execute with self-healing fallback
- `list_macros()` — browse with usage stats and success rate
- `delete_macro(name)` — remove from vault
- `suggest_macro_from_history(threshold)` — mine episodic memory for patterns

---

## 🟠 HIGH PRIORITY — Severely Limits Real-World Use

---

### 5. 📧 Memory-Aware Email Integration

**Status:** ✅ Built (`src/perception/email_client.py`, `src/tools/email_tools.py`)

#### Design Philosophy
Email tools without memory are stateless SMTP wrappers. JARVIS's email system is tied to memory and the scheduler for follow-up tracking.

#### Security Gate
Every send/reply routes through SecurityGuard with elevated scrutiny for:
- **Mass send** (BCC count > 5) → HITL confirm mandatory
- **External domain** (outside user's common recipients) → warn + confirm
- **Financial keywords** (`invoice`, `payment`, `transfer`, `wire`) → HITL confirm
- **Attachment with sensitive data** → redactor scan before attach

#### Follow-Up Memory Integration
- *"Remind me if John doesn't respond in 3 days"* → creates a scheduled check task, not a one-off note
- JARVIS checks the thread on day 3 and if no reply: *"John hasn't replied to your Tuesday email about the Q3 report. Want me to send a polite follow-up?"*

#### Tools Required
- `read_emails(folder, count, filter)` — inbox/sent/custom folder with body extraction
- `send_email(to, cc, subject, body, attachments)` — compose + send with SecurityGuard gate
- `reply_email(message_id, body)` — reply to a specific thread
- `search_emails(query, folder, date_range)` — keyword, sender, subject, date
- `move_email(message_id, folder)` — file/archive
- `track_reply(message_id, remind_after_days)` — follow-up scheduler hook

**Backends:** Win32 Outlook COM (`win32com.client`) for local Outlook; SMTP/IMAP for Gmail/custom

---

### 6. 🎙️ Privacy-First Speech-to-Text with True Barge-In

**Status:** ❌ Missing (TTS output exists; STT input does not)

#### Design Philosophy
Local Whisper is already a privacy differentiator vs. cloud assistants. Push further:

#### Key Differentiators
- **Noise-adaptive wake sensitivity** — VAD threshold auto-adjusts based on ambient noise floor sampled at startup
- **Live transcript streamed to HUD** — transcript appears in the HUD text box in real-time as you speak (not after-the-fact when Whisper finishes), using partial decoding
- **True Barge-In** — not just cancelling TTS audio. When user starts speaking:
  1. TTS audio cuts in < 50ms
  2. The in-flight `run_command` or tool call generating the next response is also cancelled (not just muted)
  3. New voice transcript immediately becomes the new goal
- **Push-to-talk + wake word** — `Ctrl+Space` for discrete use; *"Hey JARVIS"* for hands-free

#### Tools / Modules Required
- `src/voice/vad.py` — `webrtcvad` / `silero-vad` 16kHz background buffer
- `src/voice/stt.py` — `faster-whisper` local transcription engine with streaming partial decode
- `src/voice/barge_in.py` — coordinated TTS + task cancellation controller
- `/mic on` / `/mic off` CLI commands and tray toggle

**Libraries:** `faster-whisper`, `webrtcvad`, `sounddevice`, `pyaudio`, `silero-vad`

---

### 7. 🔄 Adaptive Process & App Monitor

**Status:** ✅ Built (`src/perception/process_monitor.py`, `src/tools/process_tools.py`)

#### Design Philosophy
Don't use static RAM thresholds. Learn **per-app personal baselines** from history so alerts say *"Chrome is using 2.1GB — that's 3× your normal baseline"* instead of a generic "80% RAM" warning.

#### Per-App Baseline Learning
- Over time, JARVIS records each app's typical CPU/RAM range in episodic memory
- Alerts trigger on **deviation from personal baseline**, not on fixed thresholds
- Seasonal patterns are respected: *"VS Code always spikes during build tasks — this is normal"*

#### Safe Kill with Undo
- Before `kill_process`, snapshot the process's open files and window state (where supported)
- Register the kill in `SnapshotManager` so the process can be restarted with original args

#### Tools Required
- `list_processes(sort_by, filter_name)` — all running processes with CPU%, RAM, PID, window title
- `kill_process(name_or_pid)` — terminate with snapshot + HITL confirm
- `get_process_details(name)` — open files, network connections, threads, path
- `monitor_process(name, alert_on_deviation)` — baseline-aware alerting loop
- `get_memory_baseline(app_name)` — query learned baseline from episodic memory

**Libraries:** `psutil` (already installed — new tools only needed)

---

### 8. 🔄 Vision-Verified File & Format Converter

**Status:** ✅ Built (`src/perception/file_converter.py`, `src/tools/converter_tools.py`)

#### Design Philosophy
Don't trust the conversion library blindly. Use the vision LLM to **spot-check that the converted file renders correctly** (e.g. tables preserved, images intact, fonts readable). Chain conversions into macros. Redact sensitive data from conversion output.

#### Post-Conversion Vision Check
After every conversion:
1. Render a preview page of the output file (first page as PNG)
2. Send to `vision_describe_image` with prompt: *"Does this document render correctly? Are tables, headings, and images intact?"*
3. If vision LLM reports issues → warn user before delivering the file

#### Chain Integration
Conversions can be chained directly into macros:
- *"Convert all PDFs in the Downloads folder to Word, redact any SSNs, then email them to legal@company.com"*

#### Tools Required
- `convert_pdf_to_docx(path, output_path)` / `convert_docx_to_pdf(path)`
- `convert_image(path, format, width, height, quality)` — PNG→JPEG, resize, compress
- `compress_files(files, output_zip)` / `extract_archive(path, dest)`
- `merge_pdfs(files, output)` / `split_pdf(path, page_ranges, output_dir)`
- `convert_csv_to_excel(path)` / `convert_excel_to_csv(path, sheet)`

**Libraries:** `pdf2docx`, `Pillow`, `PyMuPDF`, `openpyxl`

---

### 9. 🧠 Context-Sensitive HUD Smart Auto-Complete

**Status:** ❌ Missing

#### Design Philosophy
Generic autocomplete is boring. Suggestions should be **ranked by episodic memory** (frequency × recency × success rate) and **context-sensitive** based on the active window.

#### Context Sensitivity
| Active Window | Suggested Commands |
|:---|:---|
| `explorer.exe` focused | `"Convert all PDFs here to Word"`, `"Find large files in this folder"` |
| `outlook.exe` focused | `"Summarize unread emails"`, `"Reply to latest email from..."` |
| `chrome.exe` focused | `"Research this page and summarize"`, `"Extract all links from this page"` |
| `code.exe` focused | `"Git commit with auto-message"`, `"Run tests"`, `"Fix the last error"` |

#### Ranking Algorithm
```
score = (frequency × 0.4) + (recency_decay × 0.4) + (success_rate × 0.2)
```
Top 5 suggestions shown in dropdown. Selected suggestion auto-fills and can be edited.

#### UX Behaviors
- Up/Down arrow key scrolls command history (like a terminal)
- `/` prefix immediately shows all available slash commands
- Tab-complete for file paths typed in the goal box
- Failed past tasks shown with ⚠️ badge so user knows to rephrase

---

## 🟡 MEDIUM PRIORITY — Quality-of-Life

---

### 10. 📋 Actionable Task History Dashboard

- View past goals, tool call traces, token cost, outcome (completed/failed/denied)
- Filter by date, status, keyword
- **"Replay as Macro"** button on any past entry → one-click conversion to a saved macro
- **Auto-diagnose failures** by cross-referencing SecurityGuard logs (not just showing "failed") — explains *why* it failed

---

### 11. 🔧 Secure `.env` / Config File Manager

- `read_env(path)`, `set_env_var(path, key, value)`, `list_env_vars(path)`, `delete_env_var(path, key)`
- **Diff-and-confirm before every write** (HITL) — show exactly what will change
- **Warn if `.env` is not in `.gitignore`** — prevent accidental secret exposure
- Pipe all values through the existing `SensitiveDataRedactor` before rendering in HUD — secrets never appear in plaintext

---

### 12. 🌐 Guided Network Diagnostic Flows

- Wrap raw tools in troubleshooting flows: *"my internet feels slow"* → auto-triggers ping + port-check + DNS chain automatically
- `ping_host(host)`, `check_port(host, port)`, `get_public_ip()`, `dns_lookup(domain)`, `network_interfaces()`
- Results summarized by LLM into plain English: *"DNS resolves fine but port 443 is blocked — likely a firewall issue"*

---

### 13. 📅 Calendar (Meeting-Aware Integration)

- `list_events(date_range)`, `create_event(...)`, `delete_event(id)`, `find_free_slots(duration)`
- **Cross-wire with scheduler**: auto-suppress proactive HUD suggestions during calendar-blocked time
- **Pattern learning**: *"You decline 9AM invites every week — want me to counter-propose 10AM by default?"*
- Google Calendar API + Outlook COM backends

---

### 14. 🔧 LLM-Enhanced Git Tools

- `git_status(path)`, `git_diff(file)`, `git_log(n)`, `git_pull()`, `git_push()`, `git_commit(message)`
- **Auto-generate commit messages** from the diff via LLM — never write a commit message manually again
- **SecurityGuard high-risk actions**: `push --force`, `reset --hard`, `rebase` → mandatory HITL confirm with plain-English risk explanation
- `gitpython` backend

---

### 15. 🗝️ Safe Windows Registry Manager

> ⚠️ **Single most dangerous tool on the list — UX must reflect this.**

- `read_registry(hive, path, key)`, `write_registry(...)`, `delete_registry_key(...)`, `list_registry_keys(path)`
- **Every write mandatorily goes through `SnapshotManager` first** — registry state backed up before any modification
- **Plain-English risk explanation before HITL confirm** — not just "write HKCU\Software\..." but *"This will change your default browser to Chrome. This can be undone."*
- Locked to `HKCU` by default; `HKLM` writes require elevated SecurityGuard review

---

## 🟢 NICE-TO-HAVE — Polish & Power User

---

### 16. 🖥️ Multi-Monitor Awareness

- Per-app preferred monitor remembered in episodic memory
- Auto-restore layout on dock/undock events
- Tied to the same memory used for Window Manager workspaces

---

### 17. 🎬 Auto-Narrated Screen Recording

- `start_recording(output_path)` / `stop_recording()` — captures desktop as MP4
- `capture_gif(duration, fps, region)` — animated GIF for documentation
- **Auto-narration**: After recording, vision LLM detects distinct UI steps and TTS narrates each one — turns a raw screen capture into a step-by-step tutorial automatically

---

### 18. 📂 Vision-Powered Drag & Drop onto HUD

- Drop any file onto the JARVIS HUD overlay
- Instead of a generic OS "open with" menu, the vision LLM **actually reads the file content** (first page of PDF, first sheet of Excel, image preview) and generates intelligent action cards: `[ 📊 Audit This Report ]`, `[ 📧 Email to Team ]`, `[ 🔍 Summarize & Archive ]`

---

### 19. 🔔 Privacy-Controlled System Tray Icon

- JARVIS lives as a persistent Windows system tray icon — no terminal window required
- Right-click → `"New Goal"`, `"View History"`, `"Toggle Mic"`, `"Pause Watchers"`, `"Exit"`
- **Privacy quick-toggle**: one-click pause for microphone + vision watchers (for sensitive meetings), tied to existing `TriggerCoordinator.stop_all()` / `start_all()`

---

### 20. 🔌 Auto-Discovering Plugin System

- Drop a Python file into `~/.nim_jarvis/plugins/` → JARVIS auto-discovers and registers it as a new tool on next startup
- **Schema auto-derivation**: Tool name, description, and parameters inferred from function docstrings and type signatures — no manual `BaseTool` subclass required for simple plugins
- **Elevated security scrutiny**: Every new plugin's first 10 executions run through SecurityGuard at elevated risk level until the plugin is marked "trusted" by the user

---

## 📊 Completion Tracker

```
Total features tracked:   34
Already built:            14  ████████████████████░░░░░░░░░░░░░  41%
Remaining to build:       20  ░░░░░░░░░░░░░░░░░░░░████████████░  59%

  🔴 Critical:            4 features
  🟠 High Priority:       5 features
  🟡 Medium Priority:     6 features
  🟢 Nice-to-Have:        5 features
```

---

## 🚀 Recommended Implementation Order

| Sprint | Feature | Key Design Note |
|:---|:---|:---|
| **1** | Mouse & Keyboard Control | UIA-first hybrid targeting + closed-loop diff verification |
| **2** | App Launcher & Window Manager | Workspace memory + layout rollback into SnapshotManager |
| **3** | Speech-to-Text (Whisper STT) | Live HUD streaming + true barge-in cancels in-flight tool calls |
| **4** | Intelligent Scheduler | Context-aware gate (mic/meeting check) + missed-task LLM reasoning |
| **5** | Email Integration | SecurityGuard gate on sends + follow-up memory tracking |
| **6** | File & Format Converter | Vision-verified output + chain into macros |
| **7** | Self-Healing Semantic Macros | Semantic step graphs + proactive mining from episodic memory |
| **8** | Adaptive Process Monitor | Per-app baseline learning + safe kill with snapshot |
| **9** | HUD Smart Auto-Complete | Memory-ranked + context-sensitive active window detection |
| **10** | Network Diagnostics | Guided troubleshooting flows, not raw tool dumps |
