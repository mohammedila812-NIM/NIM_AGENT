"""
app.py
------
NIM JARVIS Holographic Command Interface — PyQt6 + QWebEngineView

Replaces the old HUD overlay (desktop/src/ui/hud/) with a full standalone window.
Draws heavily from the Ultron project UI architecture:
  - WebGL animated background
  - Cyberpunk red (#ff1728) holographic theme  
  - Glassmorphism panels with corner brackets
  - Real-time Python↔JavaScript bridge

Window features:
  - Frameless, always-on-top optional mode
  - Python bridge: pushes agent logs, voice state, task progress to the HTML UI
  - Microphone button triggers voice pipeline
  - Keyboard shortcut Alt+Space toggles window
  - Auto-starts NIM agent loop in background thread
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Qt imports (PyQt6)
# ---------------------------------------------------------------------------

try:
    from PyQt6.QtCore import (
        QObject, Qt, QTimer, QUrl, pyqtSignal, pyqtSlot
    )
    from PyQt6.QtGui import QKeySequence, QShortcut
    from PyQt6.QtWebChannel import QWebChannel
    from PyQt6.QtWebEngineWidgets import QWebEngineView
    from PyQt6.QtWebEngineCore import QWebEngineSettings, QWebEngineScript
    from PyQt6.QtWidgets import QApplication, QMainWindow, QWidget
    HAS_QT = True
except ImportError as _e:
    HAS_QT = False
    logger.error("PyQt6 not available: %s", _e)


# ---------------------------------------------------------------------------
# Python ↔ JavaScript Bridge
# ---------------------------------------------------------------------------

if HAS_QT:
    class NIMBridge(QObject):
        """
        Exposed to JavaScript as `window.nimBridge`.
        Allows the HTML UI to call Python methods and receive Python signals.
        """

        # Signals sent FROM Python TO JavaScript
        agentLogReceived = pyqtSignal(str)      # new agent log line (JSON string)
        voiceStateChanged = pyqtSignal(str)     # voice state JSON
        taskProgressChanged = pyqtSignal(str)   # task progress JSON
        systemStatsChanged = pyqtSignal(str)    # CPU/RAM stats JSON
        toastReceived = pyqtSignal(str)         # toast notification JSON

        def __init__(self, parent=None):
            super().__init__(parent)
            self._on_voice_toggle: Optional[Callable] = None
            self._on_command_submit: Optional[Callable[[str], None]] = None

        # Called BY JavaScript → Python

        @pyqtSlot()
        def toggleMic(self) -> None:
            """JavaScript calls this when mic button is pressed."""
            if self._on_voice_toggle:
                threading.Thread(target=self._on_voice_toggle, daemon=True).start()

        @pyqtSlot(str)
        def submitCommand(self, command: str) -> None:
            """JavaScript calls this when user submits a text command."""
            if self._on_command_submit:
                threading.Thread(
                    target=self._on_command_submit, args=(command,), daemon=True
                ).start()

        @pyqtSlot(result=str)
        def getVersion(self) -> str:
            return "NIM JARVIS v1.1.0"

        # Python → JavaScript helpers

        def push_log(self, text: str, level: str = "info") -> None:
            """Push an agent log line to the UI."""
            payload = json.dumps({"text": text, "level": level, "ts": _now_ts()})
            self.agentLogReceived.emit(payload)

        def push_voice_state(self, state: str, transcript: str = "") -> None:
            """Push voice state: 'idle' | 'listening' | 'processing' | 'speaking'."""
            payload = json.dumps({"state": state, "transcript": transcript})
            self.voiceStateChanged.emit(payload)

        def push_task_progress(self, task: str, status: str, pct: int = 0) -> None:
            """Push task progress update."""
            payload = json.dumps({"task": task, "status": status, "pct": pct})
            self.taskProgressChanged.emit(payload)

        def push_stats(self, cpu: float, ram: float, gpu: float = 0.0) -> None:
            """Push system stats."""
            payload = json.dumps({"cpu": cpu, "ram": ram, "gpu": gpu})
            self.systemStatsChanged.emit(payload)

        def push_toast(self, title: str, message: str, kind: str = "info") -> None:
            """Push a toast notification."""
            payload = json.dumps({"title": title, "message": message, "kind": kind})
            self.toastReceived.emit(payload)


# ---------------------------------------------------------------------------
# Holographic Window
# ---------------------------------------------------------------------------

if HAS_QT:
    class HolographicWindow(QMainWindow):
        """
        NIM JARVIS holographic command interface window.
        Uses QWebEngineView to render the full HTML/CSS/JS UI.
        """

        _state_sig = pyqtSignal(str)

        def __init__(
            self,
            on_voice_toggle: Optional[Callable] = None,
            on_command_submit: Optional[Callable[[str], None]] = None,
            always_on_top: bool = False,
            start_hidden: bool = False,
        ):
            super().__init__()
            self._bridge = NIMBridge(self)
            self._bridge._on_voice_toggle = on_voice_toggle
            self._bridge._on_command_submit = on_command_submit
            self._setup_window(always_on_top)
            self._setup_webengine()
            self._setup_channel()
            self._setup_shortcuts()
            self._start_stats_timer()
            if not start_hidden:
                self.show()

        # ---- Window setup ----

        def _setup_window(self, always_on_top: bool) -> None:
            self.setWindowTitle("NIM JARVIS // Holographic Interface")
            self.resize(1400, 900)
            # Remove native title bar for frameless look (optional)
            # self.setWindowFlags(Qt.WindowType.FramelessWindowHint)
            if always_on_top:
                self.setWindowFlags(
                    self.windowFlags() | Qt.WindowType.WindowStaysOnTopHint
                )
            self.setMinimumSize(800, 600)
            # Dark background prevents white flash on load
            self.setStyleSheet("QMainWindow { background: #050001; }")

        def _setup_webengine(self) -> None:
            self._view = QWebEngineView(self)
            self.setCentralWidget(self._view)
            page = self._view.page()
            settings = page.settings()
            # Enable WebGL
            settings.setAttribute(
                QWebEngineSettings.WebAttribute.WebGLEnabled, True
            )
            settings.setAttribute(
                QWebEngineSettings.WebAttribute.JavascriptEnabled, True
            )
            settings.setAttribute(
                QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True
            )
            settings.setAttribute(
                QWebEngineSettings.WebAttribute.AllowRunningInsecureContent, True
            )
            # Load index.html
            html_path = Path(__file__).parent / "static" / "index.html"
            self._view.load(QUrl.fromLocalFile(str(html_path)))

        def _setup_channel(self) -> None:
            """Wire up the Python↔JS QWebChannel."""
            self._channel = QWebChannel(self._view.page())
            self._channel.registerObject("nimBridge", self._bridge)
            self._view.page().setWebChannel(self._channel)

        def _setup_shortcuts(self) -> None:
            """Alt+Space → toggle visibility, Alt+M → toggle mic."""
            toggle_shortcut = QShortcut(QKeySequence("Alt+Space"), self)
            toggle_shortcut.activated.connect(self._toggle_visibility)

        # ---- Visibility toggle ----

        def _toggle_visibility(self) -> None:
            if self.isVisible():
                self.hide()
            else:
                self.show()
                self.activateWindow()
                self.raise_()

        # ---- System stats timer ----

        def _start_stats_timer(self) -> None:
            """Poll CPU/RAM every 3 seconds and push to UI."""
            self._stats_timer = QTimer(self)
            self._stats_timer.setInterval(3000)
            self._stats_timer.timeout.connect(self._push_stats)
            self._stats_timer.start()

        def _push_stats(self) -> None:
            try:
                import psutil
                cpu = psutil.cpu_percent(interval=None)
                ram = psutil.virtual_memory().percent
                self._bridge.push_stats(cpu=cpu, ram=ram)
            except ImportError:
                self._bridge.push_stats(cpu=0, ram=0)

        # ---- Public API for main.py ----

        @property
        def bridge(self) -> "NIMBridge":
            """Access the bridge to push updates from the agent."""
            return self._bridge

        def log(self, text: str, level: str = "info") -> None:
            """Thread-safe: push an agent log line to the UI."""
            self._bridge.push_log(text, level)

        def set_voice_state(self, state: str, transcript: str = "") -> None:
            """Thread-safe: update voice indicator in UI."""
            self._bridge.push_voice_state(state, transcript)

        def set_task_progress(self, task: str, status: str, pct: int = 0) -> None:
            """Thread-safe: update task progress bar in UI."""
            self._bridge.push_task_progress(task, status, pct)

        def toast(self, title: str, message: str, kind: str = "info") -> None:
            """Thread-safe: show a toast notification."""
            self._bridge.push_toast(title, message, kind)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_ts() -> float:
    import time
    return time.time()


# ---------------------------------------------------------------------------
# Standalone launch
# ---------------------------------------------------------------------------

def launch_gui(
    on_voice_toggle: Optional[Callable] = None,
    on_command_submit: Optional[Callable[[str], None]] = None,
    always_on_top: bool = False,
) -> Optional["HolographicWindow"]:
    """
    Launch the NIM JARVIS holographic GUI.
    Returns the HolographicWindow instance.

    Call this from main.py INSTEAD of the old HUD overlay.
    """
    if not HAS_QT:
        logger.error("Cannot launch GUI: PyQt6 not installed.")
        return None

    app = QApplication.instance()
    created_app = False
    if app is None:
        app = QApplication(sys.argv)
        created_app = True

    window = HolographicWindow(
        on_voice_toggle=on_voice_toggle,
        on_command_submit=on_command_submit,
        always_on_top=always_on_top,
    )

    if created_app:
        sys.exit(app.exec())

    return window
