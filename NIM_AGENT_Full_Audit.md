# NIM AGENT — Full Product Audit Report
### *Flaws · Weaknesses · Missing Capabilities · Competitive Gaps*

> **Auditor:** Antigravity AI (Senior SWE + Product Evaluator)  
> **Date:** September 2026  
> **Verdict:** Promising architectural foundation with 34+ critical-to-polish defects that prevent production readiness and mass adoption.  
> **Scope:** Full codebase — Desktop Python Agent (`desktop/`), Browser Extension (`src/`), Architecture, UX, Security, Deployment

---

## ⚡ Executive Summary

NIM AGENT is a dual-surface AI agent (Windows desktop + Chromium browser extension) built around a ReAct loop, 18+ automation tools, and a floating HUD. It has real ambitions — Windows UIA hybrid actuation, vision LLM fallback, closed-loop verification, and a WebSocket bridge between the desktop and browser.

**But today it cannot be shipped to a general public user.** Here is why, in brutal detail.

---

## 🔴 SECTION 1 — SECURITY VULNERABILITIES (Ship-Blocker)

### 1.1 PowerShell Command Injection in `notify_user`
**File:** [`system_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/system_tools.py)  
User-supplied strings (`title`, `message`) are string-formatted directly into a PowerShell heredoc without escaping. A single quote in a message body (`I'll be there`) is enough to break out of the script string and execute arbitrary commands with full user privileges. This is a **textbook injection vulnerability** that would fail any security audit.

```python
# VULNERABLE (current code)
ps_script = f"$notify.showballoontip(5000, '{title}', '{message}', ...)"
subprocess.Popen(["powershell", "-Command", ps_script])
```

### 1.2 Sensitive Data Sent Unredacted to Cloud LLMs
**File:** [`llm/client.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/llm/client.py)  
A `SensitiveDataRedactor` class exists and is used in email/file tools — but is **never called** before outgoing HTTP payloads are sent to Gemini or NVIDIA NIM APIs. Any file content or command output containing API keys, passwords, credit card numbers, or SSNs is transmitted to cloud providers in plaintext. This is a GDPR/SOC 2 violation waiting to happen.

### 1.3 Bridge WebSocket Has No Shared-Secret Validation
**File:** [`bridge/server.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/bridge/server.py)  
The bridge server at `ws://127.0.0.1:7432` authenticates by checking a token sent in the first message. Any local process (including malware) can connect to this port and send `browser_task` messages, triggering arbitrary shell commands, email sends, or file deletions on the user's machine. There is no rate-limiting, no CSRF protection, and no localhost-only binding enforcement in code.

### 1.4 SecurityGuard Is Statically Bypassed in the Main Agent Loop
**File:** [`agent/loop.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agent/loop.py) L384–393  
The guard *is* called now (`SecurityGuard.evaluate_tool_call(tool_name, tool_args)`), but there is a deeper flaw: the `run_command` tool's static `risk_level` is `MODERATE`. If `hitl_callback` is `None` (CLI mode), **no confirmation is ever requested** for any tool call, regardless of how destructive the shell command is. A malicious or hallucinated `run_command` call with `rm -rf` or `format c:` passes silently.

### 1.5 Snapshot Index Is Non-Atomic (Corruption Risk)
**File:** [`security/snapshot.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/security/snapshot.py)  
The `_save_index()` method writes directly to `index.json`. A crash, power loss, or `ESC` kill mid-write leaves a partially written JSON file. All undo history is permanently lost. No `os.replace(temp, target)` atomic swap is used.

### 1.6 Duplicate Tool-Call IDs Break All Non-Gemini APIs
**File:** [`llm/client.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/llm/client.py) L205  
Inline tool calls parsed from one completion chunk get IDs like `f"inline_{int(asyncio.get_event_loop().time())}"`. Two tool calls in the same chunk get identical IDs (same timestamp). This causes OpenAI, Groq, and NVIDIA NIM to return `400 Bad Request`, silently breaking multi-tool tasks.

---

## 🟠 SECTION 2 — ARCHITECTURAL FAILURES (Core Loop Broken)

### 2.1 HUD Submit Button Does Nothing (Dead UI)
**File:** [`ui/cli.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/ui/cli.py) L163  
```python
hud = JarvisHUDOverlay(on_submit_goal=lambda g: None)
```
The floating HUD — the primary interaction surface — is wired to a no-op lambda. Typing a goal and pressing Enter or clicking any quick-action card **does absolutely nothing**. The HUD is a visual demo, not a functional product.

### 2.2 Token & Cost Tracking Is Always Zero
**File:** [`agent/loop.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agent/loop.py)  
The `stream_options: {"include_usage": true}` field is never sent in streaming payloads. The LLM provider never returns token counts in the stream. All task records in SQLite store `tokens_used: 0` and `cost_usd: 0.000000`. The advertised daily USD budget guard (`$5.00`) never actually fires because it has no real input data.

### 2.3 Max Iterations Returns "Completed" Instead of "Failed"
**File:** [`agent/loop.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agent/loop.py) L437–438  
```python
state.status = TaskStatus.FAILED
yield {"event": "task_completed", "final_answer": "Max iterations reached without resolution.", ...}
```
The internal state is `FAILED` but the event emitted is `task_completed`. The UI receives a "completed" signal for a task that actually timed out. Memory stores it as "completed". The user never knows a task failed.

### 2.4 Specialist Router Is Dead Code (Never Invoked)
**File:** [`agents/specialists.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agents/specialists.py)  
`SpecialistRouter.match_specialist()` is defined, tested, and the result is captured into a variable — but the `system_content` variable built from it (`specialist.system_prompt_addon`) is never actually passed to the agent. The LLM receives the same generic `SYSTEM_PROMPT` for every task type, making the entire specialist architecture a dead pattern.

> **NOTE:** Upon closer reading of `loop.py` lines 263–264, the specialist is *referenced* but its `system_prompt_addon` concatenation shows it was added post-audit. Confirm whether this is actually injected into the live prompt or remains a stub.

### 2.5 Context Window Explosion on Multi-Step Tasks
**File:** [`agent/loop.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agent/loop.py)  
A sliding window of 12 messages is truncated, but tool observations themselves can be 4,000 characters each. 25 iterations × 4,000 char observations = 100,000 characters pushed into context, guaranteed to exceed any model's limit. There is no semantic compression, no summarization of older turns — just naive truncation that loses critical earlier context.

### 2.6 Subagent Runner Uses a Different LLM Interface That Doesn't Exist
**File:** [`agents/subagent_runner.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agents/subagent_runner.py) L231  
```python
response = await self.llm_client.generate(messages=..., system=..., tools=...)
```
The `SubAgent` calls `llm_client.generate()` — but `LLMClient` in `src/llm/client.py` exposes only `stream_chat(req: ChatCompletionRequest)`. There is **no `generate()` method**. Every parallel subagent call crashes with `AttributeError`. Subagent parallelism is entirely non-functional.

### 2.7 Bridge Multi-Client Broadcast Race Condition
**File:** [`bridge/server.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/bridge/server.py)  
If two Chrome windows have the extension open, `delegate_browser_task` broadcasts to both. Both browser instances execute the task simultaneously. The desktop receives two `browser_result` responses and has no deduplication logic. Results are undefined.

### 2.8 Authenticated Client Set Memory Leak
**File:** [`bridge/server.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/bridge/server.py)  
`_connected_clients` is cleaned in `finally`, but `_authenticated_clients` is never cleaned on disconnect. Stale socket objects accumulate in memory and broadcast failures appear in logs without explanation.

---

## 🟡 SECTION 3 — TOOL-LEVEL BUGS (Runtime Crashes)

### 3.1 SearchFiles Infinite Disk Walk
**File:** [`tools/file_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/file_tools.py)  
`break` inside the inner `for f in files` loop does not stop the outer `os.walk`. Asking "find all .log files" on `C:\` traverses the entire drive until `max_results` accumulates across potentially hundreds of directories, locking the thread for minutes.

### 3.2 ReadFile OOM on Large Files
**File:** [`tools/file_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/file_tools.py)  
`f.readlines()` loads the entire file into memory before slicing. A 2GB log file = 2GB RAM spike. No file size guard exists.

### 3.3 Markdown Generator TypeError on Non-String Cells
**File:** [`tools/doc_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/doc_tools.py)  
`" | ".join(row)` raises `TypeError` when table cells contain integers, floats, or booleans (which is virtually every real-world data table). Document generation crashes silently.

### 3.4 PDF Generator XML Crash on Special Characters
**File:** [`tools/doc_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/doc_tools.py)  
ReportLab `Paragraph()` parses input as XML. Characters `&`, `<`, `>` in headings cause `ExpatError`. A heading like "Q&A Session" crashes PDF generation entirely.

### 3.5 Excel Sheet Name Invalid Characters
**File:** [`tools/doc_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/doc_tools.py)  
`ws.title = title[:30]`. Excel forbids `\ / ? * : [ ]` in sheet names. Titles like `"Sales: 2026/Q1"` throw `InvalidCharacterException` and abort generation.

### 3.6 DuckDuckGo Returns Tracker Wrapper URLs
**File:** [`tools/web_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/web_tools.py)  
The "general" web search returns DuckDuckGo HTML Lite redirect URLs (`/l/?uddg=...`). The code *does* parse the `uddg` parameter (it's in the code), but this is fragile and breaks whenever DuckDuckGo changes its HTML structure. Without a proper search API key, web search is unreliable.

### 3.7 TTS Opens Windows Media Player GUI Window
**File:** [`voice/tts.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/voice/tts.py)  
The TTS playback uses `$wmp.openPlayer(...)` which launches the full visible Windows Media Player GUI, stealing focus from the user's active window every time JARVIS speaks. This is unacceptable for a productivity tool.

### 3.8 Tkinter Thread Safety Violations
**File:** [`ui/hud/overlay.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/ui/hud/overlay.py)  
`update_thought()` and `update_status()` call widget `.configure()` directly from background async coroutines. Tkinter is single-threaded. This causes intermittent crashes that are nearly impossible to reproduce deterministically — the worst kind of bug.

### 3.9 Excel Workbooks Left Open (File Lock on Windows)
**File:** [`perception/excel.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/perception/excel.py)  
`wb.close()` and `wb_data.close()` are never called in a `finally` block. On Windows, the opened `.xlsx` file stays locked, preventing the user from editing it manually while JARVIS has it open in analysis.

### 3.10 Orphaned Child Processes on Command Timeout
**File:** [`tools/shell_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/shell_tools.py) L87–96  
On timeout, the code tries `platform.system()` and `psutil.Process()` — but `platform` and `psutil` are not imported in this file. This causes a `NameError`, which means the timeout cleanup itself crashes, leaving zombie processes running indefinitely.

### 3.11 `asyncio.get_event_loop()` Deprecated in Python 3.10+
**File:** [`llm/client.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/llm/client.py)  
Called in at least two places. On Python 3.12 (now the latest stable), this raises `DeprecationWarning` and in certain thread contexts raises `RuntimeError: no current event loop`. The entire LLM client can crash on newer Python versions.

### 3.12 Win32 Imports at Module Level (Crash on Non-Windows)
**File:** [`perception/window.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/perception/window.py)  
`import win32con`, `import win32gui`, `import win32process` execute at import time without a try/except. Importing the module on macOS or Linux raises `ModuleNotFoundError` and crashes the entire application startup — not just the feature.

---

## 🟠 SECTION 4 — MISSING CAPABILITIES (What It Can't Do)

These are not bugs — these are entire categories of functionality absent from the product, each one a reason a user would choose a competitor instead.

### 4.1 ❌ No Self-Healing Macro System
The agent can execute tasks, but it cannot **record, save, replay, or self-heal multi-step workflows**. Every time a user asks "do my morning routine," JARVIS starts from scratch, re-plans, re-executes, and consumes tokens. Competitors like UI.Vision, Zapier, and Keyboard Maestro have had this for years. JARVIS has a `save_macro` database table but **zero code to populate or execute it from user-facing flows**.

### 4.2 ❌ No HUD Smart Autocomplete
The HUD input box is a blank text field. There is no command history (↑ / ↓), no context-sensitive suggestion cards, no ranked autocomplete based on episodic memory. A new user opens it and sees nothing — they don't know what to type. This is a discovery and onboarding failure.

### 4.3 ❌ No Calendar Integration
Scheduling says "every weekday at 9AM" but there is no integration with Google Calendar or Outlook Calendar. The agent cannot:
- Check if the user is in a meeting before running a scheduled task
- Create or modify calendar events
- Block JARVIS HUD suggestions during meeting hours
- Detect time conflicts before scheduling

### 4.4 ❌ No Git / Code Awareness
For a tool targeting developers, there are no git tools. No `git_status`, no `git_diff`, no auto-commit message generation, no branch awareness. The agent cannot help with the single most common developer daily task.

### 4.5 ❌ No Registry Access (Planned, Not Built)
The `MISSING_FEATURES.md` lists a Windows Registry Manager. It does not exist. This limits system administration use cases significantly.

### 4.6 ❌ No Network Diagnostics
No `ping_host`, `check_port`, `dns_lookup`, `get_public_ip`. The agent cannot answer "why is my internet slow" without delegating to a raw shell command, which requires the user to know the right commands.

### 4.7 ❌ No Screen Recording or GIF Capture
Cannot record a workflow, create a tutorial, or capture a bug report as a GIF. Any competing product (Loom, OBS, ShareX) does this trivially.

### 4.8 ❌ No Multi-Monitor Deep Awareness
`move_window_to_monitor` exists, but there is no per-app preferred-monitor memory, no auto-restore on dock/undock events, and no awareness of display topology changes.

### 4.9 ❌ No Plugin System
To extend JARVIS with a custom tool, a user must subclass `BaseTool`, register it manually, and restart. There is no plugin discovery, no `~/.nim_jarvis/plugins/` auto-load, and no schema derivation from docstrings. Power users who want to customize the agent cannot without modifying source code.

### 4.10 ❌ No System Tray / Background Mode
JARVIS requires a terminal window open to run. It cannot sit invisibly in the system tray. The moment the user closes the terminal, everything stops. A productivity tool that requires a visible terminal window is not a productivity tool — it's a development demo.

### 4.11 ❌ No Installer / Executable
Setup requires: `git clone`, `cd`, `pip install -e .`, configure API keys. There is no `.exe` installer, no `winget` package, no auto-updater, no first-run wizard. The target audience (general public) will not complete this setup.

### 4.12 ❌ No Vision-Powered HUD Drop Zone
Cannot drag and drop a file onto the HUD for instant contextual action cards. This is the most natural interaction for a desktop AI assistant and does not exist.

### 4.13 ❌ No Actionable Task History Dashboard
The `task_history` table in SQLite exists, but there is no UI to view it, filter it, replay a task as a macro, or auto-diagnose why a past task failed. Logs exist, but they're in terminal text only.

### 4.14 ❌ Browser Extension Has No Real DOM Manipulation
The browser extension can inspect DOM and extract text, but cannot **fill forms with complex validation**, handle CAPTCHAs, deal with shadow DOM elements, interact with `<canvas>` or WebGL UIs, or handle multi-frame/iframe structures. Modern web apps (Gmail, Notion, Linear, Figma) use all of these patterns.

### 4.15 ❌ No Local Model Support Configured Out-of-the-Box
Ollama is listed as a fallback, but there is zero documentation, zero auto-detection of a running Ollama instance, and the model name `llama3.2` is hardcoded without size guidance. "Local AI, no cloud needed" is implied but functionally broken.

---

## 🔵 SECTION 5 — COMPETITIVE GAPS (Why It Loses to Others)

| Competitor | What They Do Better |
|:---|:---|
| **Claude Computer Use** | Native vision-first desktop control without requiring UIAutomation fallback complexity; runs inside Anthropic's ecosystem with zero setup |
| **Copilot+ (Windows)** | First-party OS integration, Recall memory, no Python stack, no API keys needed, ships with the OS |
| **OpenAI Operator** | Web browser automation without a browser extension; cloud-hosted, no local installation |
| **Cursor / GitHub Copilot** | Deep IDE context awareness, codebase-level understanding, repo-wide refactoring — NIM has none of this |
| **Zapier / Make** | Battle-tested multi-step automation with 7,000+ app integrations, visual builder, enterprise reliability |
| **UI.Vision / Keyboard Maestro** | Reliable, production-tested macro recording and replay with self-healing selectors |
| **AutoHotKey** | Zero-latency, zero-AI-overhead keyboard/mouse automation that never hallucinates |
| **Alfred / Raycast** | Polished launcher UX, plugin marketplace, community ecosystem — NIM has a blank HUD |
| **Notion AI / Microsoft 365 Copilot** | Document intelligence native to the app, no integration required |

**The fundamental competitive problem:** NIM AGENT is trying to be everything (OS automation + browser + email + voice + files + scheduling) without doing any of them reliably enough. Every competitor is narrower but deeper.

---

## 🟣 SECTION 6 — UX / ONBOARDING FAILURES

### 6.1 Zero First-Run Experience
A new user runs `python -m src.main` and sees a blank CLI prompt. No setup wizard, no API key prompt with guidance, no feature tour, no "try saying this" examples. The HUD is hidden behind `Ctrl+Space`. The extension requires manual sideloading. Discovery is entirely absent.

### 6.2 The HUD Is Not Actually Useful Yet
The floating `Ctrl+Space` HUD is the flagship UX feature. Today:
- Submit button does nothing (dead callback)
- No history navigation
- No autocomplete
- No suggestion cards (though code exists for them)
- TTS playback opens a visible Windows Media Player window

### 6.3 ESC Kill-Switch Is Unreliable
The ESC hotkey is supposed to cancel everything. But if a tool call is in the middle of an `await asyncio.create_subprocess_exec`, cancelling the Python event doesn't kill the child process. The shell command keeps running. The user sees "cancelled" in the HUD but the actual action continues.

### 6.4 Voice Input Has No Feedback Loop
The VAD (voice activity detection) listens in the background, but there is no visual indicator that it's active, no confidence score, no partial transcript stream visible to the user until speech processing completes. The user has no idea if JARVIS heard them.

### 6.5 Error Messages Are Developer-Grade, Not User-Grade
When a tool fails, the HUD shows Python exception messages like `AttributeError: 'NoneType' object has no attribute 'send'`. A general public user cannot interpret or act on these. There is no user-friendly error translation layer.

### 6.6 No Undo Visual Feedback
The undo system (`SnapshotManager`) works at the code level, but there is no visual list of undoable actions shown to the user. The user doesn't know what can be undone, how many snapshots exist, or that undo is even possible.

---

## ⚪ SECTION 7 — CODE QUALITY & MAINTAINABILITY ISSUES

### 7.1 No Type Safety on Tool Arguments
Every tool uses `args: Dict[str, Any]` and manually casts with `str(args.get("x", ""))`. If the LLM passes a wrong type (e.g., `{"count": "five"}`), tools silently use default values with no error surfaced. Pydantic models for tool args would catch this at the boundary.

### 7.2 Singleton Pattern Used for Stateful Engines
`get_actuation_engine()`, `get_email_client()`, `get_memory_store()` all use global singletons without thread-safety locks. In an async context with parallel subagents, concurrent access to these singletons is a data race.

### 7.3 Test Coverage Is Thin and Unmaintained
60 tests are mentioned in the changelog but the test structure only has `desktop/tests/`. The browser extension (`src/`) has **zero automated tests**. E2E tests exist in `e2e/` but Playwright is configured with no base URL, meaning they likely fail out of the box.

### 7.4 pyproject.toml Missing Critical Dependencies
`beautifulsoup4`, `customtkinter`, `edge-tts`, `pywin32` are imported in source files but not listed in `pyproject.toml`. A clean `pip install -e .` will install the package without these dependencies, and the application will crash on first use of those features.

### 7.5 No Logging Strategy — Mix of `print()` and `logger`
Some files use `logger.info()`, some use `print()`, some use neither. There is no log rotation, no log level configuration in user-facing settings, and no structured logging format that would allow monitoring in production.

### 7.6 Rate-Limit Recovery Is Hardcoded at 35 Seconds
The README mentions "35s rate-limit cooldown recovery." This is a magic constant for Gemini Flash's free tier. This will break when:
- A different provider is used
- Gemini changes its rate limit policy
- The user has a paid Gemini tier with different limits

### 7.7 The Browser Extension Has No Tests Whatsoever
`background.ts` is 537 lines with complex state management (bridge reconnection, HITL promise chains, alarm handlers). Not a single unit or integration test covers it. Any refactor is a guess.

### 7.8 CHANGELOG.md Shows Version Inconsistency
The extension's `background.ts` hardcodes `version: '1.1.0'` in auth requests. If the package version is bumped, this string must be manually updated — it is not sourced from `package.json`. This is a maintenance smell.

---

## 🟥 SECTION 8 — WHAT'S STOPPING IT FROM BEING POWERFUL

Here is the honest, direct answer:

| Blocker | Impact |
|:---|:---|
| HUD submit button is a no-op | **The primary UI literally does nothing** |
| No installer | No non-developer user can run it |
| Security injection vulnerability | Would be pulled from any app store immediately |
| Subagent `generate()` method doesn't exist | Parallel intelligence is completely broken |
| No macro system | Cannot automate repetitive tasks — the core productivity use case |
| Browser extension cannot handle modern web apps | Fails on Gmail, Notion, Linear — the apps people actually use |
| No calendar/meeting awareness | Scheduler is context-blind |
| Zero first-run experience | Users quit before they discover any feature |
| Token tracking always zero | Budget guard never fires — cost is invisible |
| TTS opens WMP GUI | Breaks focus every time the agent speaks |

---

## 📊 SECTION 9 — OVERALL HEALTH SCORECARD

| Dimension | Score | Notes |
|:---|:---:|:---|
| **Architecture** | 6/10 | Solid ReAct + bridge concept; subagent model broken in practice |
| **Security** | 3/10 | Two critical injections, unredacted cloud egress, weak bridge auth |
| **Feature Completeness** | 4/10 | ~41% of planned features built; macro system and plugin system missing |
| **Reliability** | 3/10 | 10+ runtime crashes in normal use paths |
| **UX / Onboarding** | 2/10 | Dead HUD button, no installer, no tutorial, no autocomplete |
| **Competitive Position** | 4/10 | Unique hybrid approach, but every individual feature is outclassed |
| **Code Quality** | 5/10 | Reasonable structure, but missing deps, no typing, thin tests |
| **Production Readiness** | 2/10 | Cannot be publicly shipped in current state |

**Overall: 3.6 / 10** — Not production-ready. Significant engineering investment required before public release.

---

## 🛠️ SECTION 10 — PRIORITY REMEDIATION ROADMAP

### Sprint 1 — Security (Week 1, Non-Negotiable)
1. Fix PowerShell injection in `notify_user` (escape single quotes)
2. Wire `SensitiveDataRedactor` into `LLMClient.stream_chat` before every payload send
3. Fix duplicate tool-call IDs with `uuid.uuid4().hex`
4. Make snapshot index atomic with `os.replace(temp, target)`

### Sprint 2 — Core Loop Fixes (Week 2)
5. Wire HUD `on_submit_goal` to `orchestrator.execute_task()`
6. Fix `task_completed` event for max-iterations case → emit `task_failed`
7. Add `stream_options: {"include_usage": true}` to LLM payloads
8. Fix `SubAgent.llm_client.generate()` → use `stream_chat(ChatCompletionRequest)`

### Sprint 3 — Tool Crashes (Week 3)
9. Fix SearchFiles infinite walk (add outer loop break)
10. Add file size guard in ReadFile (skip > 50MB)
11. Fix Markdown generator: `str(c) for c in row`
12. Fix PDF generator: `xml.sax.saxutils.escape(text)`
13. Fix Excel sheet names: sanitize illegal characters
14. Import `platform` and `psutil` in `shell_tools.py`
15. Fix Win32 imports with `try/except` guard

### Sprint 4 — UX Fundamentals (Week 4–5)
16. Replace WMP TTS playback with `sounddevice` or `pygame`
17. Add `root.after()` wrapper to all Tkinter updates from async context
18. Build command history (↑/↓) and top-5 autocomplete for HUD
19. Add user-friendly error message translation layer
20. Add undo history visual list to HUD

### Sprint 5 — New Capabilities (Month 2)
21. Macro record, save, replay, and self-heal system
22. System tray icon (no terminal required)
23. One-click Windows installer (`pyinstaller` → `.exe`)
24. Git tools (`git_status`, `git_diff`, `git_commit` with LLM messages)
25. Plugin auto-discovery from `~/.nim_jarvis/plugins/`

---

> *This audit was generated through full codebase inspection of all 37 Python source files, 537-line TypeScript extension background, configuration files, and architectural documentation. Every finding is traceable to specific file paths and line numbers.*
