import json
import logging
import os
import re
import threading
import time
import urllib.parse
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

class ClipboardEntityType(str, Enum):
    CODE_SNIPPET = "code_snippet"
    STACKTRACE = "stacktrace"
    TABULAR_DATA = "tabular_data"
    WEB_URL = "web_url"
    FILE_PATH = "file_path"
    TEXT = "text"

@dataclass
class ClipboardAnalysisResult:
    raw_text: str
    entity_type: ClipboardEntityType
    summary: str
    suggested_actions: List[Dict[str, str]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

def classify_clipboard_content(text: str) -> ClipboardAnalysisResult:
    """
    Intelligently analyzes clipboard text and categorizes it into high-value
    actionable entities (Code, Stacktrace, Tabular Data, URL, File Path, Text).
    """
    clean = text.strip()
    if not clean:
        return ClipboardAnalysisResult(
            raw_text="",
            entity_type=ClipboardEntityType.TEXT,
            summary="Empty clipboard",
            suggested_actions=[]
        )

    # 1. Check for Web URL
    if (clean.startswith("http://") or clean.startswith("https://")) and " " not in clean:
        try:
            parsed = urllib.parse.urlparse(clean)
            if parsed.netloc:
                domain = parsed.netloc
                return ClipboardAnalysisResult(
                    raw_text=clean,
                    entity_type=ClipboardEntityType.WEB_URL,
                    summary=f"Web URL: {domain}",
                    suggested_actions=[
                        {"label": f"🌐 Research {domain}", "goal": f"Fetch content from {clean} and summarize key insights"},
                        {"label": "🔍 Deep Browser Task", "goal": f"Use browser agent to navigate {clean} and report findings"}
                    ],
                    metadata={"url": clean, "domain": domain}
                )
        except Exception:
            pass

    # 2. Check for Existing File Path
    try:
        candidate_path = Path(clean.strip('"\'')).expanduser()
        if candidate_path.exists() and ("\\" in clean or "/" in clean):
            if candidate_path.is_file():
                ext = candidate_path.suffix.lower()
                actions = [{"label": f"📄 Inspect {candidate_path.name}", "goal": f"Read and inspect file: {candidate_path}"}]
                if ext in [".xlsx", ".xls", ".csv"]:
                    actions.insert(0, {"label": f"📊 Audit {candidate_path.name}", "goal": f"Analyze spreadsheet {candidate_path} and audit formulas"})
                return ClipboardAnalysisResult(
                    raw_text=clean,
                    entity_type=ClipboardEntityType.FILE_PATH,
                    summary=f"File: {candidate_path.name} ({ext or 'file'})",
                    suggested_actions=actions,
                    metadata={"path": str(candidate_path), "is_dir": False}
                )
            elif candidate_path.is_dir():
                return ClipboardAnalysisResult(
                    raw_text=clean,
                    entity_type=ClipboardEntityType.FILE_PATH,
                    summary=f"Directory: {candidate_path.name}/",
                    suggested_actions=[
                        {"label": f"📁 List {candidate_path.name}/", "goal": f"List contents and search files in directory: {candidate_path}"}
                    ],
                    metadata={"path": str(candidate_path), "is_dir": True}
                )
    except Exception:
        pass

    # 3. Check for Stacktrace / Exceptions
    is_stacktrace = False
    stacktrace_lang = "general"
    if "Traceback (most recent call last):" in clean or ("File \"" in clean and "line " in clean):
        is_stacktrace = True
        stacktrace_lang = "python"
    elif "    at " in clean and ("Error:" in clean or "Exception:" in clean):
        is_stacktrace = True
        stacktrace_lang = "javascript"
    elif "Exception in thread" in clean or "at com." in clean:
        is_stacktrace = True
        stacktrace_lang = "java"

    if is_stacktrace:
        lines = clean.splitlines()
        last_line = lines[-1].strip() if lines else "Error"
        return ClipboardAnalysisResult(
            raw_text=clean,
            entity_type=ClipboardEntityType.STACKTRACE,
            summary=f"Error: {last_line[:60]}",
            suggested_actions=[
                {"label": "🐞 Debug with JARVIS", "goal": f"Analyze and solve this error stacktrace:\n{clean[:500]}"},
                {"label": "🔍 Search Solution Online", "goal": f"Search the web for solutions to error: {last_line[:120]}"}
            ],
            metadata={"language": stacktrace_lang, "error_preview": last_line}
        )

    # 4. Check for JSON / Code Snippet
    if (clean.startswith("{") and clean.endswith("}")) or (clean.startswith("[") and clean.endswith("]")):
        try:
            parsed_json = json.loads(clean)
            item_count = len(parsed_json) if isinstance(parsed_json, (dict, list)) else 1
            return ClipboardAnalysisResult(
                raw_text=clean,
                entity_type=ClipboardEntityType.CODE_SNIPPET,
                summary=f"JSON Data ({item_count} entries)",
                suggested_actions=[
                    {"label": "📊 Format & Convert to Excel", "goal": f"Convert this JSON data into an Excel spreadsheet:\n{clean[:400]}"},
                    {"label": "⚡ Validate & Pretty-Print", "goal": f"Validate and format this JSON data:\n{clean[:400]}"}
                ],
                metadata={"language": "json", "items": item_count}
            )
        except Exception:
            pass

    # 5. Check for Tabular / CSV Data
    lines = clean.splitlines()
    if len(lines) >= 2:
        # Check tab-separated or comma-separated structure
        tab_counts = [l.count("\t") for l in lines[:5]]
        comma_counts = [l.count(",") for l in lines[:5]]
        pipe_counts = [l.count("|") for l in lines[:5]]

        if len(tab_counts) >= 2 and min(tab_counts) > 0 and max(tab_counts) == min(tab_counts):
            cols = tab_counts[0] + 1
            return ClipboardAnalysisResult(
                raw_text=clean,
                entity_type=ClipboardEntityType.TABULAR_DATA,
                summary=f"Tabular Data ({len(lines)} rows x {cols} cols)",
                suggested_actions=[
                    {"label": f"📊 Export to Excel Workbook", "goal": f"Save this tabular data into an organized Excel workbook on Desktop with calculations and formatting:\n{clean[:600]}"}
                ],
                metadata={"format": "tsv", "rows": len(lines), "cols": cols}
            )
        elif len(comma_counts) >= 2 and min(comma_counts) > 0 and max(comma_counts) == min(comma_counts):
            cols = comma_counts[0] + 1
            return ClipboardAnalysisResult(
                raw_text=clean,
                entity_type=ClipboardEntityType.TABULAR_DATA,
                summary=f"CSV Table ({len(lines)} rows x {cols} cols)",
                suggested_actions=[
                    {"label": f"📊 Generate Excel Report", "goal": f"Generate a formatted Excel report and compute statistics for this CSV data:\n{clean[:600]}"}
                ],
                metadata={"format": "csv", "rows": len(lines), "cols": cols}
            )

    # 6. General Text
    summary = clean[:60] + ("..." if len(clean) > 60 else "")
    return ClipboardAnalysisResult(
        raw_text=clean,
        entity_type=ClipboardEntityType.TEXT,
        summary=summary,
        suggested_actions=[
            {"label": "✨ Summarize Text", "goal": f"Provide an executive summary and key points of:\n{clean[:500]}"},
            {"label": "📝 Write Document", "goal": f"Create a structured Markdown document based on:\n{clean[:500]}"}
        ] if len(clean) > 100 else []
    )

class ClipboardListener:
    """
    Lightweight background listener that monitors clipboard updates,
    classifies entities, and notifies subscribers without blocking the OS.
    """

    def __init__(
        self,
        on_event_callback: Optional[Callable[[ClipboardAnalysisResult], None]] = None,
        poll_interval: float = 0.8
    ):
        self.on_event_callback = on_event_callback
        self.poll_interval = poll_interval
        self._last_hash: Optional[int] = None
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        """Starts the clipboard listener in a background daemon thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="JARVIS-ClipboardWatcher")
        self._thread.start()
        logger.info("Clipboard intelligence listener started.")

    def stop(self):
        """Stops the clipboard listener."""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
        logger.info("Clipboard intelligence listener stopped.")

    def _get_current_clipboard(self) -> Optional[str]:
        """Reads current clipboard text safely."""
        try:
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            try:
                content = root.clipboard_get()
            except Exception:
                content = None
            finally:
                root.destroy()
            return content
        except Exception:
            return None

    def _run_loop(self):
        # Initialize with current clipboard hash so we don't trigger on initial launch
        initial_text = self._get_current_clipboard()
        if initial_text:
            self._last_hash = hash(initial_text)

        while self._running:
            time.sleep(self.poll_interval)
            try:
                text = self._get_current_clipboard()
                if not text or not text.strip():
                    continue

                text_hash = hash(text)
                if text_hash != self._last_hash:
                    self._last_hash = text_hash
                    # Analyze clipboard entity
                    result = classify_clipboard_content(text)
                    if self.on_event_callback and result.suggested_actions:
                        try:
                            self.on_event_callback(result)
                        except Exception as cb_err:
                            logger.warning("Error in clipboard callback: %s", cb_err)
            except Exception as e:
                logger.debug("Clipboard read error: %s", e)
