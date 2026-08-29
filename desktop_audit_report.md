# NIM JARVIS Desktop Version: Comprehensive Audit & Remediation Master Report

> **Target Audience:** Engineering Agents & Core Developers  
> **Status:** Actionable Remediation Plan  
> **Scope:** `desktop/` directory (all 37 source files, 6 test suites, configuration, and packaging)

---

## 📊 Executive Summary & Health Index

A full static analysis, code audit, and runtime evaluation of the **NIM JARVIS Desktop Version** was conducted. While the application establishes a solid architectural foundation (ReAct loop, unified tool registry, browser bridge, perception hierarchy, and OS credential management), **28 distinct bugs, security vulnerabilities, edge-case crashes, and architectural weaknesses** were identified.

### Severity Breakdown
* 🔴 **Critical (4 issues):** Remote/local code injection, undeclared missing runtime dependencies, unauthenticated/thread-unsafe operations.
* 🟠 **High (8 issues):** Tool pairing crashes (400 Bad Request), infinite disk traversal, unbounded context window expansion, client connection leaks, and module import crashes on non-Windows.
* 🟡 **Medium (11 issues):** OOM DoS on large files, non-atomic index saves, document generation XML/type crashes, SQLite concurrency locks, and incomplete formula audits.
* 🟢 **Low / Polish (5 issues):** UX window popups, binary perceptual diffing scores, and unintegrated specialist sub-agents.

---

## 🛠️ Sprint 1: Critical Security & Crash-Preventing Fixes (Immediate)

### 🔴 ISSUE-01 [CRITICAL]: PowerShell Command Injection in `notify_user`
* **File:** [`src/tools/system_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/system_tools.py#L73-L80)
* **Location:** Lines 73–80 in `NotifyUserTool.execute`
* **Root Cause:** User/LLM strings (`title`, `message`) are formatted directly into a PowerShell script string with single quotes. Any content containing single quotes (`'`), backticks, or PowerShell delimiters allows arbitrary command execution with user privileges.
* **Exact Vulnerable Code:**
  ```python
  ps_script = f"""
  [reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null
  $notify = new-object system.windows.forms.notifyicon
  $notify.icon = [system.drawing.systemicons]::Information
  $notify.visible = $true
  $notify.showballoontip(5000, '{title}', '{message}', [system.windows.forms.tooltipicon]::Info)
  """
  subprocess.Popen(["powershell", "-NoProfile", "-Command", ps_script], ...)
  ```
* **Required Fix:**
  Use parameterized execution or Base64 script encoding so user input cannot escape into the PowerShell interpreter:
  ```python
  import base64
  # Sanitize / escape single quotes or pass parameters safely
  escaped_title = title.replace("'", "''")
  escaped_msg = message.replace("'", "''")
  ```

---

### 🔴 ISSUE-02 [CRITICAL]: Undeclared Runtime Dependencies in `pyproject.toml`
* **File:** [`pyproject.toml`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/pyproject.toml#L11-L25)
* **Location:** Lines 11–25 (`dependencies` table)
* **Root Cause:** Several modules import third-party packages that are not listed in `dependencies`. A clean `pip install .` or `pip install -e .` crashes immediately upon using features that rely on these packages:
  * `beautifulsoup4` (`bs4`) — imported in `src/tools/web_tools.py`
  * `customtkinter` — imported in `src/ui/hud/overlay.py`
  * `edge-tts` — imported in `src/voice/tts.py`
  * `pywin32` — imported in `src/perception/window.py`
* **Required Fix:** Update `pyproject.toml` to:
  ```toml
  dependencies = [
      "pydantic>=2.0",
      "httpx>=0.25",
      "websockets>=12.0",
      "keyring>=25.0",
      "rich>=13.0",
      "openpyxl>=3.1",
      "python-docx>=1.1",
      "python-pptx>=1.0",
      "reportlab>=4.0",
      "psutil>=5.9",
      "pyautogui>=0.9.54",
      "mss>=9.0",
      "Pillow>=10.0",
      "beautifulsoup4>=4.12",
      "customtkinter>=5.2",
      "edge-tts>=6.1",
      "pywin32>=306; sys_platform == 'win32'"
  ]
  ```

---

### 🔴 ISSUE-03 [CRITICAL]: Unhandled Top-Level Platform Imports in `window.py`
* **File:** [`src/perception/window.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/perception/window.py#L4-L6)
* **Location:** Lines 4–6
* **Root Cause:** `import win32con`, `import win32gui`, and `import win32process` occur at module level without a `try/except` block. On Linux, macOS, or systems without `pywin32`, importing `src.perception.window` crashes at import time before `if os.name != "nt"` can execute.
* **Required Fix:**
  ```python
  if sys.platform == "win32":
      try:
          import win32con
          import win32gui
          import win32process
      except ImportError:
          win32con = win32gui = win32process = None
  else:
      win32con = win32gui = win32process = None
  ```

---

### 🔴 ISSUE-04 [CRITICAL]: Disconnected Goal Dispatcher Callback in HUD
* **File:** [`src/ui/cli.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/ui/cli.py#L163)
* **Location:** Line 163
* **Root Cause:** When the HUD overlay is launched via `/hud`, the submit callback is instantiated as a no-op dummy function:
  ```python
  hud = JarvisHUDOverlay(on_submit_goal=lambda g: None)
  ```
  Entering any prompt or clicking any quick-action button in the HUD overlay discards user input and does nothing.
* **Required Fix:** Wire `on_submit_goal` to an asynchronous task execution queue or dispatch function that feeds goals into `orchestrator.execute_task()`.

---

## ⚡ Sprint 2: Core Loop, LLM Client & Bridge Reliability

### 🟠 ISSUE-05 [HIGH]: Duplicate Tool Call IDs in Inline Tool Recovery
* **File:** [`src/llm/client.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/llm/client.py#L205)
* **Location:** Line 205
* **Root Cause:** `id=f"inline_{int(asyncio.get_event_loop().time())}"`. Multiple inline tool calls parsed from one completion chunk receive identical IDs. Sending duplicate `tool_call_id`s in assistant/tool message pairs causes OpenAI/NVIDIA NIM/Groq APIs to reject with `400 Bad Request`.
* **Required Fix:**
  ```python
  import uuid
  # Use unique UUID per tool call
  id=f"inline_{uuid.uuid4().hex[:8]}"
  ```

---

### 🟠 ISSUE-06 [HIGH]: Unbounded Context Growth & Missing Token Truncation
* **File:** [`src/agent/loop.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agent/loop.py#L157-L274)
* **Location:** ReAct message loop (Lines 157–274)
* **Root Cause:** Every turn appends raw assistant messages and full tool outputs directly to `messages: List[ChatMessage]`. For multi-step tasks or tools returning large text (e.g. `read_file`, `web_search`, `analyze_spreadsheet`), the context exceeds model limits (4096 / 8192 tokens) after a few iterations, resulting in `400 Context Length Exceeded`.
* **Required Fix:**
  Implement atomic tool-turn trimming or sliding window compression:
  1. Truncate individual tool outputs if they exceed a per-turn character threshold (e.g. 4,000 chars).
  2. Maintain a maximum message turn history (e.g. last 12 turns) and summarize older turns into a single system memory block.

---

### 🟠 ISSUE-07 [HIGH]: Token & USD Cost Tracking Stays at 0
* **File:** [`src/agent/loop.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agent/loop.py#L218-L220), [`src/agent/state.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agent/state.py#L36-L38)
* **Location:** `loop.py:218-220`, `client.py:57-63`
* **Root Cause:** `ChatCompletionRequest` does not request usage in streaming payloads (`stream_options: {"include_usage": True}` is omitted). The client never extracts token counts from final chunks, so `state.prompt_tokens`, `state.completion_tokens`, and `state.estimated_usd_cost` remain `0`. SQLite task records always store `tokens_used: 0`.
* **Required Fix:**
  1. In `LLMClient.stream_chat`, add `"stream_options": {"include_usage": True}` to payload.
  2. Parse `chunk.get("usage")` on final SSE chunk and yield a `usage` event.
  3. Accumulate tokens in `state.prompt_tokens` and calculate cost using provider pricing models.

---

### 🟠 ISSUE-08 [HIGH]: Authenticated Client Connection Leak in Bridge Server
* **File:** [`src/bridge/server.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/bridge/server.py#L150-L153)
* **Location:** Lines 150–153 (`_handle_connection` finally block)
* **Root Cause:**
  ```python
  finally:
      self._connected_clients.discard(websocket)
      logger.info("Browser extension disconnected.")
  ```
  `self._authenticated_clients.discard(websocket)` is omitted. When browser tabs or extensions disconnect, stale socket objects remain in `_authenticated_clients`, causing memory leaks and broadcast failure noise.
* **Required Fix:**
  ```python
  finally:
      self._connected_clients.discard(websocket)
      self._authenticated_clients.discard(websocket)
      logger.info("Browser extension disconnected.")
  ```

---

### 🟠 ISSUE-09 [HIGH]: Multi-Client Broadcast Race Condition on Bridge
* **File:** [`src/bridge/server.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/bridge/server.py#L198-L204)
* **Location:** Lines 198–204 in `delegate_browser_task`
* **Root Cause:** The server iterates over all connected authenticated clients and sends the `BROWSER_TASK` message to every one of them. If the user has two browser windows open, both browser instances run the task simultaneously and race to return `BROWSER_RESULT`.
* **Required Fix:** Target the most recently active extension connection or support explicit client IDs.

---

### 🟠 ISSUE-10 [HIGH]: SecurityGuard Bypassed in Agent ReAct Loop
* **File:** [`src/agent/loop.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agent/loop.py#L234-L236)
* **Location:** Lines 234–236
* **Root Cause:**
  ```python
  tool_obj = self.tool_registry.get_tool(tool_name)
  if tool_obj and tool_obj.risk_level == ActionRiskLevel.DESTRUCTIVE and hitl_callback:
  ```
  Instead of evaluating dynamic risk through `SecurityGuard.evaluate_tool_call(tool_name, tool_args)`, it checks only the tool's static `risk_level`. For example, `run_command` has static `MODERATE` risk, so even if a dangerous command is passed, HITL confirmation is never requested!
* **Required Fix:**
  ```python
  calculated_risk = SecurityGuard.evaluate_tool_call(tool_name, tool_args)
  if calculated_risk in [ActionRiskLevel.DESTRUCTIVE, ActionRiskLevel.CRITICAL] and hitl_callback:
      approved = await hitl_callback(tool_name, tool_args)
  ```

---

### 🟠 ISSUE-11 [HIGH]: Sensitive Data Redactor Missing on Cloud Egress
* **File:** [`src/llm/client.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/llm/client.py#L56-L89)
* **Location:** Lines 56–89 in `LLMClient.stream_chat`
* **Root Cause:** `SensitiveDataRedactor` is defined in `src/security/redaction.py`, but is never invoked on outgoing messages in `LLMClient`. Any file content or command output containing API keys or credentials read during agent execution is forwarded unredacted to external cloud LLM APIs.
* **Required Fix:** Apply `SensitiveDataRedactor.redact_text` to message content before sending HTTP payloads.

---

### 🟠 ISSUE-12 [HIGH]: Deprecated `asyncio.get_event_loop()` Invocations
* **File:** [`src/llm/client.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/llm/client.py#L141, #L205)
* **Location:** Lines 141 and 205
* **Root Cause:** Calling `asyncio.get_event_loop()` is deprecated in Python 3.10+ and raises `RuntimeError` if called when no event loop is set on the current thread.
* **Required Fix:** Replace with `time.time()` or `asyncio.get_running_loop().time()`.

---

## 📂 Sprint 3: File, Doc, System & Perception Tool Fixes

### 🟡 ISSUE-13 [HIGH]: Infinite Disk Walk in `SearchFilesTool`
* **File:** [`src/tools/file_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/file_tools.py#L260-L266)
* **Location:** Lines 260–266
* **Root Cause:**
  ```python
  for root, _, files in os.walk(root_dir):
      ...
      for f in files:
          if len(matches) >= max_results:
              break
  ```
  `break` only breaks out of the inner `for f in files` loop. The outer `os.walk` continues traversing the entire drive/folder structure, causing high CPU/disk usage and long freezes.
* **Required Fix:**
  ```python
  for root, _, files in os.walk(root_dir):
      if len(matches) >= max_results:
          break
      ...
  ```

---

### 🟡 ISSUE-14 [MEDIUM]: OOM Risk on Large Files in `ReadFileTool` and `SearchFilesTool`
* **File:** [`src/tools/file_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/file_tools.py#L47-L48, #L270-L272)
* **Location:** `file_tools.py:47-48`, `file_tools.py:270-272`
* **Root Cause:**
  * `ReadFileTool` calls `f.readlines()` on the entire file before slicing. Reading a 2GB file will consume 2GB+ of memory.
  * `SearchFilesTool` executes `file_obj.read()` without checking file size, attempting to load entire binary/video files into memory.
* **Required Fix:**
  * In `ReadFileTool`: Use line-by-line generator / `itertools.islice`.
  * In `SearchFilesTool`: Check `os.path.getsize(full_path) < 10_000_000` (10MB limit) before reading content.

---

### 🟡 ISSUE-15 [MEDIUM]: Missing Path Normalization in `DiffFilesTool`
* **File:** [`src/tools/file_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/file_tools.py#L297-L298)
* **Location:** Lines 297–298
* **Root Cause:** Unlike `ReadFileTool` and `WriteFileTool`, `DiffFilesTool` does not call `resolve_target_path()`. Passing `"Desktop/file1.txt"` fails to resolve.
* **Required Fix:** Wrap arguments in `resolve_target_path(str(args.get("file_a")))`.

---

### 🟡 ISSUE-16 [MEDIUM]: Non-Atomic Snapshot Index File Writes
* **File:** [`src/security/snapshot.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/security/snapshot.py#L48-L53)
* **Location:** Lines 48–53
* **Root Cause:** `_save_index()` writes directly to `index.json` without atomic replace. An interrupted write (e.g. process termination or power loss) corrupts the index and breaks all undo history.
* **Required Fix:** Write to a temporary file in the same folder and use `os.replace(temp_file, self.index_file)`.

---

### 🟡 ISSUE-17 [MEDIUM]: Orphaned Subprocess Leaks on Command Timeout
* **File:** [`src/tools/shell_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/shell_tools.py#L87-L89)
* **Location:** Lines 87–89
* **Root Cause:** On timeout, `process.kill()` terminates only the parent shell. Child processes spawned by the command continue running indefinitely as background orphans.
* **Required Fix:** Use `psutil.Process(process.pid).children(recursive=True)` or Windows `taskkill /F /T /PID <pid>` to terminate the entire process hierarchy.

---

### 🟡 ISSUE-18 [MEDIUM]: Markdown Generation Crash on Non-String Cells
* **File:** [`src/tools/doc_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/doc_tools.py#L262, #L265)
* **Location:** Lines 262 and 265 in `_generate_md`
* **Root Cause:** `" | ".join(row)` raises `TypeError` if table cells contain numeric (int/float) or boolean types.
* **Required Fix:** Use `" | ".join(str(c) for c in row)`.

---

### 🟡 ISSUE-19 [MEDIUM]: XML Parsing Crash in ReportLab PDF Generation
* **File:** [`src/tools/doc_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/doc_tools.py#L180, #L186, #L191)
* **Location:** Lines 180, 186, 191 in `_generate_pdf`
* **Root Cause:** ReportLab `Paragraph` parses input as XML. If headings or content contain `&`, `<`, or `>`, ReportLab throws `xml.parsers.expat.ExpatError`.
* **Required Fix:** Escape strings with `xml.sax.saxutils.escape(text)`.

---

### 🟡 ISSUE-20 [MEDIUM]: Illegal Sheet Names in Excel Generator
* **File:** [`src/tools/doc_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/doc_tools.py#L138)
* **Location:** Line 138 in `_generate_xlsx`
* **Root Cause:** `ws.title = title[:30]`. Excel sheet names forbid characters `\ / ? * : [ ]`. Titles like `"Summary: 2026"` cause openpyxl to raise `InvalidCharacterException`.
* **Required Fix:** Sanitize sheet names: `re.sub(r'[\\/*?:\[\]]', '_', title)[:31]`.

---

### 🟡 ISSUE-21 [MEDIUM]: Broken DuckDuckGo Search Links in `_search_general`
* **File:** [`src/tools/web_tools.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/tools/web_tools.py#L143)
* **Location:** Line 143
* **Root Cause:** DuckDuckGo HTML Lite returns wrapper redirect links (`/l/?uddg=https%3A%2F%2F...`). `title_tag.get("href")` returns the tracker redirect instead of the actual destination URL, causing subsequent `read_url` calls to fail.
* **Required Fix:** Parse the `uddg` URL query parameter to extract the clean destination URL.

---

### 🟡 ISSUE-22 [MEDIUM]: Memory Leak & Open File Locks in `SpreadsheetAnalyzer`
* **File:** [`src/perception/excel.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/perception/excel.py#L41, #L48)
* **Location:** Lines 41 and 48
* **Root Cause:** The workbook is loaded twice (`data_only=False` and `data_only=True`) without `read_only=True`, and `wb.close()` / `wb_data.close()` are never called in a `finally` block, leaving file locks open on Windows.
* **Required Fix:** Wrap workbook operations in `try ... finally: wb.close(); wb_data.close()`.

---

### 🟡 ISSUE-23 [MEDIUM]: Excel Formula & Error Auditing Incomplete (Capped at 25 Rows)
* **File:** [`src/perception/excel.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/perception/excel.py#L60)
* **Location:** Line 60
* **Root Cause:** Formula auditing, `#REF!`/#DIV/0! detection, and column stats only loop over `max_preview_rows` (25). Errors occurring beyond row 25 are never detected.
* **Required Fix:** Audit all rows for formulas and error values, and cap only the `preview_rows` output to `max_preview_rows`.

---

### 🟡 ISSUE-24 [MEDIUM]: SQLite Concurrency Locking in `MemoryStore`
* **File:** [`src/agent/memory.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agent/memory.py#L23, #L64, #L76, #L89, #L117)
* **Location:** All SQLite operations
* **Root Cause:** Every method opens a new SQLite connection without enabling WAL mode (`PRAGMA journal_mode=WAL;`) or setting a busy timeout. Fast concurrent async tasks produce `sqlite3.OperationalError: database is locked`.
* **Required Fix:** Execute `conn.execute("PRAGMA journal_mode=WAL;")` and set `sqlite3.connect(..., timeout=10.0)`.

---

## 🎨 Sprint 4: UI, HUD & Polish

### 🟢 ISSUE-25 [MEDIUM]: Thread-Unsafe CustomTkinter UI Invocations
* **File:** [`src/ui/hud/overlay.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/ui/hud/overlay.py#L243, #L251)
* **Location:** Lines 243 and 251
* **Root Cause:** `update_thought()` and `update_status()` call widget `.configure(...)` methods directly from background threads or async coroutines without scheduling via `root.after()`. This violates Tkinter's single-thread GUI model and can cause crashes.
* **Required Fix:** Schedule UI updates onto the main Tk thread via `self.root.after(0, lambda: self.thought_lbl.configure(...))`.

---

### 🟢 ISSUE-26 [LOW]: Windows Media Player GUI Popup During TTS Speech
* **File:** [`src/voice/tts.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/voice/tts.py#L73-L77)
* **Location:** Lines 73–77
* **Root Cause:** `$wmp.openPlayer('{temp_audio}')` launches the visible Windows Media Player GUI application window, stealing window focus from the user.
* **Required Fix:** Use headless audio output via `System.Media.SoundPlayer` (for WAV) or native Python audio streams (e.g. `pygame` / `sounddevice` / `miniaudio`).

---

### 🟢 ISSUE-27 [LOW]: Binary Perception Difference Score
* **File:** [`src/perception/screen.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/perception/screen.py#L91-L97), [`src/perception/verify.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/perception/verify.py#L19-L20)
* **Location:** `screen.py:91-97`, `verify.py:19-20`
* **Root Cause:** `compute_image_difference` returns only `0.0` or `1.0` based on MD5 comparison of dHash strings. A 1-pixel change (like a blinking cursor) returns `1.0` (100% changed).
* **Required Fix:** Return the normalized Hamming distance `(differing_bits / total_bits)`.

---

### 🟢 ISSUE-28 [LOW]: Specialist Profiles Are Unintegrated Dead Code
* **File:** [`src/agents/specialists.py`](file:///c:/Users/maham/Desktop/NIM_AGENT/desktop/src/agents/specialists.py)
* **Location:** `SpecialistRouter` and `SPECIALIST_PROFILES`
* **Root Cause:** `SpecialistRouter` is tested in `test_specialists.py`, but is never invoked by `AgentOrchestrator` in `src/agent/loop.py`.
* **Required Fix:** In `AgentOrchestrator.execute_task()`, match the specialist profile for the user goal and append `specialist.system_prompt_addon` to the system prompt.

---

## 📋 Comprehensive File-by-File Checklist

| File Path | Issues Identified | Status / Action Needed |
|---|---|---|
| `pyproject.toml` | Undeclared dependencies (`bs4`, `customtkinter`, `edge-tts`, `pywin32`) | Add to `dependencies` |
| `src/config.py` | Import-time directory creation side-effects; unused budget configs | Defer mkdir or guard |
| `src/main.py` | Sudden exit without awaiting bridge server teardown | Clean shutdown |
| `src/agent/loop.py` | No context compression, token counts = 0, false COMPLETED on max iterations, SecurityGuard bypassed | Refactor ReAct loop |
| `src/agent/state.py` | Silent checkpoint error suppression | Log checkpoint errors |
| `src/agent/memory.py` | Missing SQLite WAL mode & timeout; JSON load inconsistencies | Add WAL mode & timeout |
| `src/agents/specialists.py` | Profiles unintegrated into ReAct loop | Wire into `AgentOrchestrator` |
| `src/llm/types.py` | `ChatMessage.to_api_dict` passes `"content": None` for tool calls | Standardize payload dict |
| `src/llm/providers.py` | Static provider configurations | Clean |
| `src/llm/router.py` | Mutates global preset objects; ignores `AgentConfig.api_key` | Dataclass replace |
| `src/llm/client.py` | Duplicate inline tool IDs, deprecated `get_event_loop()`, no `stream_options` | Unique IDs & usage capture |
| `src/bridge/protocol.py` | Protocol message definitions | Clean |
| `src/bridge/server.py` | Connection leak in `_authenticated_clients`, multi-tab broadcast race, timing attack | Fix finally & auth compare |
| `src/bridge/proxy_tools.py` | Missing timeout bounds check | Add clamp (min 5s, max 600s) |
| `src/security/secrets.py` | Clean credential management | Clean |
| `src/security/redaction.py` | Sensitive pattern redaction (not called on LLM egress) | Wire into `LLMClient` |
| `src/security/guard.py` | Brittle positional shell regexes | Enhance command guard |
| `src/security/snapshot.py` | Non-atomic index write; no scheduled snapshot pruning | Atomic write + auto-prune |
| `src/security/audit.py` | Append-only audit logger | Clean |
| `src/tools/base.py` | Base tool interfaces | Clean |
| `src/tools/registry.py` | Repeated tool registrations on singleton | Idempotent registration |
| `src/tools/file_tools.py` | Infinite walk in search; OOM on large files; unnormalized diff paths | Add breaks, size caps |
| `src/tools/shell_tools.py` | Orphaned child processes; Windows OEM code page garbling | Kill tree & UTF-8 output |
| `src/tools/system_tools.py` | PowerShell command injection in notify; Tkinter thread hazard in clipboard | Fix notify & clipboard |
| `src/tools/doc_tools.py` | MD type error on ints; PDF ReportLab XML crash; invalid Excel sheet names | Escape & sanitize |
| `src/tools/web_tools.py` | DuckDuckGo tracking URL corruption; XML parse exception handling | Parse target URLs |
| `src/tools/perception_tools.py` | Perception tool wrappers | Clean |
| `src/tools/undo_tools.py` | Single-step undo wrapper | Clean |
| `src/tools/voice_tools.py` | Voice tool wrapper | Clean |
| `src/perception/screen.py` | Binary 0/1 difference score; Pillow deprecation warning | Hamming distance dHash |
| `src/perception/window.py` | Top-level Windows imports crash on Linux/macOS | Guard Win32 imports |
| `src/perception/excel.py` | Unclosed workbooks, double RAM usage, formula audit capped at 25 rows | Full audit & finally close |
| `src/perception/verify.py` | Post-action verification wrapper | Clean |
| `src/ui/cli.py` | HUD dummy callback; abrupt `sys.exit` in async loop | Wire callback & clean exit |
| `src/ui/hud/overlay.py` | Thread-unsafe widget modifications from background threads | Use `root.after()` |
| `src/ui/hud/theme.py` | Design tokens | Clean |
| `src/voice/tts.py` | Windows Media Player GUI window popup; no Linux/macOS audio | Headless playback |
| `src/voice/barge_in.py` | Speech barge-in manager | Clean |

---

## 🧪 Verification & Testing Plan for Remediation

1. **Unit Test Verification:**
   ```bash
   pytest tests
   ```
2. **Security & Injection Test Suite:**
   * Test `notify_user` with special characters: `{"title": "Test's Title", "message": "'; Start-Process calc.exe; '"}`.
   * Test `run_command` security evaluation with flag-reordered and aliased commands.
3. **Context Truncation & Token Budget Test:**
   * Simulate a 15-turn task with large file reads and verify prompt tokens stay within context bounds.
   * Verify `usage` event is captured and `estimated_usd_cost` > 0.
4. **Document Generation Edge Cases:**
   * Generate Markdown with numeric/boolean table cells (`[[1, 2.5, True]]`).
   * Generate PDF with XML special characters in heading/content (`"Q&A <Review> & Insights"`).
   * Generate Excel with illegal characters in title (`"Sales: 2026/Q1 [Final]"`).
5. **Bridge Concurrency & Disconnection Test:**
   * Connect multiple browser test clients, send tasks, and disconnect clients; verify no leaks in `_authenticated_clients`.
