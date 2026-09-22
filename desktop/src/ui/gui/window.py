"""
NIM_AGENT Holographic GUI Window.
Implements a PyQt6 + QWebEngineView desktop interface with 3D WebGL core reactor,
audio-reactive pulses, live telemetry, and zero-latency bridge to AgentOrchestrator.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Optional

import psutil

# ─────────────────────────────────────────────────────────────────────────────
# Qt Anti-Flicker & Chromium Hardware Acceleration Environment
# ─────────────────────────────────────────────────────────────────────────────
os.environ["QTWEBENGINE_DISABLE_NO_SANDBOX"] = "1"
os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "1"
os.environ["QT_SCALE_FACTOR_ROUNDING_POLICY"] = "PassThrough"

_ui_chrome_flags = [
    "--enable-gpu-rasterization",
    "--enable-accelerated-2d-canvas",
    "--enable-zero-copy",
    "--ignore-gpu-blocklist",
    "--disable-gpu-driver-bug-workarounds",
    "--disable-direct-composition",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--use-gl=angle",
    "--use-angle=d3d11",
]
if "QTWEBENGINE_CHROMIUM_FLAGS" not in os.environ:
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = " ".join(_ui_chrome_flags)

try:
    from PyQt6.QtWebEngineWidgets import QWebEngineView
    from PyQt6.QtWebEngineCore import QWebEngineSettings
    _WEBENGINE_OK = True
except ImportError:
    _WEBENGINE_OK = False

from PyQt6.QtCore import (
    Qt, QUrl, pyqtSignal, QCoreApplication, QTimer, QThread,
)
from PyQt6.QtGui import (
    QColor, QPalette, QSurfaceFormat, QIcon,
)
from PyQt6.QtWidgets import (
    QApplication, QLabel, QMainWindow, QVBoxLayout, QWidget,
    QDialog, QLineEdit, QPushButton, QHBoxLayout, QMessageBox,
)

from src.agent.loop import AgentOrchestrator
from src.security.secrets import get_secret_store
from src.security.snapshot import get_snapshot_manager
from src.bridge.server import get_bridge_server
from src.llm.providers import get_provider_preset, PROVIDER_PRESETS
from src.skills import get_skill_manager

logger = logging.getLogger(__name__)

GUI_STATIC_DIR = Path(__file__).resolve().parent / "static"
APP_HTML_PATH = GUI_STATIC_DIR / "app.html"


def _setup_qt_environment():
    chrome_switches = [
        "--enable-gpu-rasterization",
        "--enable-accelerated-2d-canvas",
        "--enable-zero-copy",
        "--ignore-gpu-blocklist",
        "--disable-gpu-driver-bug-workarounds",
        "--disable-direct-composition",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        "--use-gl=angle",
        "--use-angle=d3d11",
    ]
    for switch in chrome_switches:
        if switch not in sys.argv:
            sys.argv.append(switch)

    try:
        if hasattr(Qt.ApplicationAttribute, "AA_ShareOpenGLContexts"):
            QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts, True)
        if hasattr(Qt.ApplicationAttribute, "AA_DontCreateNativeWidgetSiblings"):
            QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_DontCreateNativeWidgetSiblings, True)
    except Exception:
        pass

    try:
        fmt = QSurfaceFormat()
        fmt.setSwapBehavior(QSurfaceFormat.SwapBehavior.DoubleBuffer)
        fmt.setSwapInterval(1)
        fmt.setDepthBufferSize(24)
        fmt.setStencilBufferSize(8)
        fmt.setRenderableType(QSurfaceFormat.RenderableType.OpenGL)
        QSurfaceFormat.setDefaultFormat(fmt)
    except Exception:
        pass


class AgentWorkerThread(QThread):
    """Executes orchestrator tasks on a background thread with an event loop."""
    event_emitted = pyqtSignal(dict)
    approval_requested = pyqtSignal(str, dict, str)

    def __init__(self, orchestrator: AgentOrchestrator, goal: str):
        super().__init__()
        self.orchestrator = orchestrator
        self.goal = goal
        self._approval_queue: queue.Queue = queue.Queue()

    def run(self):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._execute())
        finally:
            loop.close()

    def request_approval_sync(self, tool_name: str, args: dict, risk: str) -> str:
        self.approval_requested.emit(tool_name, args, risk)
        return self._approval_queue.get()

    def provide_approval_response(self, choice: Any):
        self._approval_queue.put(choice)

    def cancel(self):
        try:
            self.orchestrator.cancel_current_task()
        except Exception:
            pass

    async def _execute(self):
        async def gui_hitl_callback(tool_name: str, tool_args: dict) -> str:
            val = await asyncio.to_thread(self.request_approval_sync, tool_name, tool_args, "DESTRUCTIVE")
            return str(val) if val is not None else "n"

        try:
            async for ev in self.orchestrator.execute_task(self.goal, hitl_callback=gui_hitl_callback):
                self.event_emitted.emit(ev)
        except Exception as e:
            self.event_emitted.emit({"event": "error", "message": str(e)})


class NimHolographicWindow(QMainWindow):
    _state_sig = pyqtSignal(str)
    _log_sig = pyqtSignal(str)
    _chat_sig = pyqtSignal(str, str)
    _telemetry_sig = pyqtSignal(float, float, float)
    _reasoning_sig = pyqtSignal(str)
    _content_sig = pyqtSignal(str)
    _audit_sig = pyqtSignal(str, bool, int, str)

    def __init__(self, orchestrator: Optional[AgentOrchestrator] = None):
        super().__init__()
        self.setWindowTitle("NIM AGENT — Autonomous Holographic Command Interface")
        self.resize(1340, 840)
        self.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent, True)
        self.setStyleSheet("background-color: #000b10; border: none;")

        pal = self.palette()
        pal.setColor(QPalette.ColorRole.Window, QColor("#000b10"))
        pal.setColor(QPalette.ColorRole.Base, QColor("#000b10"))
        self.setPalette(pal)
        self.setAutoFillBackground(True)

        self.orchestrator = orchestrator or AgentOrchestrator()
        self._active_worker: Optional[AgentWorkerThread] = None

        if _WEBENGINE_OK:
            self._web = QWebEngineView(self)
            self._web.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent, True)
            self._web.setStyleSheet("background-color: #000b10; border: none;")
            if hasattr(self._web, "page") and self._web.page():
                self._web.page().setBackgroundColor(QColor("#000b10"))

            self._web.titleChanged.connect(self._on_title_changed)
            settings = self._web.settings()
            settings.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)
            settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
            settings.setAttribute(QWebEngineSettings.WebAttribute.Accelerated2dCanvasEnabled, True)
            settings.setAttribute(QWebEngineSettings.WebAttribute.WebGLEnabled, True)
            settings.setAttribute(QWebEngineSettings.WebAttribute.ScrollAnimatorEnabled, True)
            settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
            settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)

            self.setCentralWidget(self._web)
            self._web.setUrl(QUrl.fromLocalFile(str(APP_HTML_PATH)))
        else:
            container = QWidget()
            lbl = QLabel("PyQt6 WebEngine is required for Holographic GUI.", container)
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            lbl.setStyleSheet("color: #e5c07b; font-size: 16px;")
            layout = QVBoxLayout(container)
            layout.addWidget(lbl)
            self.setCentralWidget(container)

        self._state_sig.connect(self._on_js_state)
        self._log_sig.connect(self._on_js_log)
        self._chat_sig.connect(self._on_js_chat)
        self._telemetry_sig.connect(self._on_js_telemetry)
        self._reasoning_sig.connect(self._on_js_reasoning)
        self._content_sig.connect(self._on_js_content)
        self._audit_sig.connect(self._on_js_audit)

        # Telemetry timer
        self._telemetry_timer = QTimer(self)
        self._telemetry_timer.timeout.connect(self._update_system_telemetry)
        self._telemetry_timer.start(2000)

        # Send initial config to front-end shortly after loading
        QTimer.singleShot(1000, self._push_initial_config)

    def _eval_js(self, js_code: str):
        if _WEBENGINE_OK and hasattr(self, "_web") and self._web.page():
            try:
                self._web.page().runJavaScript(js_code)
            except Exception as e:
                logger.debug("eval_js error: %s", e)

    def _push_initial_config(self):
        prov = self.orchestrator.config.provider_id
        model = self.orchestrator.config.model
        key = get_secret_store().get_key(prov) or ""
        self._eval_js(f"if (typeof populateSettings === 'function') populateSettings({json.dumps(prov)}, {json.dumps(key)}, {json.dumps(model)});")

    def _on_js_state(self, state: str):
        js = f"if (typeof updateAIState === 'function') updateAIState('{state}');"
        self._eval_js(js)

    def _on_js_log(self, text: str):
        escaped = json.dumps(text)
        js = f"if (typeof addMemoryLog === 'function') addMemoryLog({escaped});"
        self._eval_js(js)

    def _on_js_chat(self, speaker: str, text: str):
        escaped_speaker = json.dumps(speaker)
        escaped_text = json.dumps(text)
        js = f"if (typeof addChatMessage === 'function') addChatMessage({escaped_speaker}, {escaped_text});"
        self._eval_js(js)

    def _on_js_reasoning(self, delta: str):
        escaped_delta = json.dumps(delta)
        js = f"if (typeof appendReasoningChunk === 'function') appendReasoningChunk({escaped_delta});"
        self._eval_js(js)

    def _on_js_content(self, delta: str):
        escaped_delta = json.dumps(delta)
        js = f"if (typeof appendContentChunk === 'function') appendContentChunk({escaped_delta});"
        self._eval_js(js)

    def _on_js_audit(self, path: str, success: bool, errors: int, details: str):
        js = f"if (typeof renderAuditResult === 'function') renderAuditResult({json.dumps(path)}, {json.dumps(success)}, {errors}, {json.dumps(details)});"
        self._eval_js(js)

    def _on_js_telemetry(self, cpu: float, ram: float, disk: float):
        js = f"""
        if (document.getElementById('cpu-load-val')) document.getElementById('cpu-load-val').textContent = '{cpu:.0f}%';
        if (document.getElementById('cpu-bar')) document.getElementById('cpu-bar').style.setProperty('--v', '{cpu:.0f}%');
        if (document.getElementById('ram-pct-lbl')) document.getElementById('ram-pct-lbl').textContent = '{ram:.0f}%';
        if (document.getElementById('disk-lbl')) document.getElementById('disk-lbl').textContent = '{disk:.0f}%';
        if (document.getElementById('diag-cpu')) document.getElementById('diag-cpu').textContent = '{cpu:.1f}%';
        if (document.getElementById('diag-ram')) document.getElementById('diag-ram').textContent = '{ram:.1f}%';
        """
        self._eval_js(js)

    def _update_system_telemetry(self):
        try:
            cpu = psutil.cpu_percent(interval=None)
            ram = psutil.virtual_memory().percent
            disk = psutil.disk_usage(os.path.abspath("/")).percent
            self._telemetry_sig.emit(cpu, ram, disk)
        except Exception:
            pass

    def _on_title_changed(self, title: str):
        if not title.startswith("CMD:"):
            return

        raw = title[4:].strip()
        parts = raw.split(":", 2)

        if len(parts) == 3 and parts[0].isdigit():
            action = parts[1]
            payload = parts[2]
        elif len(parts) == 2 and parts[0].isdigit():
            action = parts[1]
            payload = ""
        else:
            action = "run"
            payload = raw

        self._handle_bridge_action(action, payload)

    def _handle_bridge_action(self, action: str, payload: str):
        if action == "run":
            cmd = payload.strip()
            if cmd:
                self._dispatch_command(cmd)

        elif action == "stop":
            if self._active_worker:
                self._active_worker.cancel()
            self._state_sig.emit("LISTENING")
            self._eval_js("if (typeof showToast === 'function') showToast('TASK CANCELLED', 'Active task aborted by operator.');")

        elif action == "undo":
            res = get_snapshot_manager().undo_last_action()
            msg = res.get("message", "Reverted last change.")
            self._eval_js(f"if (typeof showToast === 'function') showToast('UNDO COMPLETE', {json.dumps(msg)});")
            self._eval_js(f"if (typeof addExecutionCard === 'function') addExecutionCard('tool', 'UNDO ACTION', {json.dumps(msg)});")

        elif action == "reset":
            self.orchestrator.reset_session()
            self._eval_js("if (typeof showToast === 'function') showToast('SESSION RESET', 'Conversation memory cleared.');")

        elif action == "open_path":
            path = payload.strip()
            if os.path.exists(path):
                try:
                    os.startfile(path)
                except Exception as e:
                    self._eval_js(f"showToast('OPEN ERROR', {json.dumps(str(e))});")

        elif action == "reveal_path":
            path = payload.strip()
            if os.path.exists(path):
                try:
                    subprocess.Popen(["explorer", f"/select,{os.path.normpath(path)}"])
                except Exception as e:
                    self._eval_js(f"showToast('EXPLORER ERROR', {json.dumps(str(e))});")

        elif action == "settings_get":
            self._push_initial_config()

        elif action == "settings_save":
            parts = payload.split("::")
            if len(parts) >= 3:
                prov, key, model = parts[0].strip(), parts[1].strip(), parts[2].strip()
                if key:
                    get_secret_store().set_key(prov, key)
                preset = get_provider_preset(prov)
                self.orchestrator.config.provider_id = prov
                if preset:
                    self.orchestrator.config.base_url = preset.base_url
                self.orchestrator.config.model = model
                self.orchestrator.model_router.primary_provider_id = prov
                self.orchestrator.model_router.primary_model = model
                self._eval_js(f"if (typeof showToast === 'function') showToast('CONFIG APPLIED', 'Model: {model}');")

        elif action == "approval_response":
            choice = payload.strip().lower()
            if self._active_worker:
                self._active_worker.provide_approval_response(choice)

        elif action == "toggle_mic":
            self._state_sig.emit("LISTENING")

    def _dispatch_command(self, cmd: str):
        if cmd == "/clear" or cmd == "/reset":
            self.orchestrator.reset_session()
            self._log_sig.emit("Session memory reset.")
            return

        self._state_sig.emit("THINKING")
        self._log_sig.emit(f"Goal: {cmd}")

        self._active_worker = AgentWorkerThread(self.orchestrator, cmd)
        self._active_worker.event_emitted.connect(self._on_agent_event)
        self._active_worker.approval_requested.connect(self._on_approval_requested)
        self._active_worker.start()

    def _on_approval_requested(self, tool_name: str, args: dict, risk: str):
        args_str = json.dumps(args, indent=2)
        if len(args_str) > 250:
            args_str = args_str[:250] + "..."

        # Trigger In-Engine Cyberpunk Holographic Modal
        js = f"if (typeof showHoloApproval === 'function') showHoloApproval({json.dumps(tool_name)}, {json.dumps(risk)}, {json.dumps(args_str)});"
        self._eval_js(js)

    def _on_agent_event(self, ev: dict):
        etype = ev.get("event")

        if etype == "reasoning_chunk":
            delta = ev.get("delta", "")
            if delta:
                self._reasoning_sig.emit(delta)

        elif etype == "content_chunk":
            delta = ev.get("delta", "")
            if delta:
                self._content_sig.emit(delta)

        elif etype == "skill_activated":
            s_name = ev.get("skill", "")
            self._log_sig.emit(f"Skill Activated: {s_name}")
            self._eval_js(f"if (typeof addExecutionCard === 'function') addExecutionCard('tool', '⚡ SKILL ACTIVATED', {json.dumps(s_name)});")

        elif etype == "tool_call_start":
            self._state_sig.emit("PROCESSING")
            tn = ev.get("tool", "")
            args_dict = ev.get("args", {})
            args_preview = json.dumps(args_dict, indent=2) if args_dict else "{}"
            if len(args_preview) > 250:
                args_preview = args_preview[:250] + "..."
            self._log_sig.emit(f"Step: {tn}")
            self._eval_js(f"if (typeof addExecutionCard === 'function') addExecutionCard('tool', '⚙️ EXECUTING TOOL: ' + {json.dumps(tn)}, {json.dumps(args_preview)});")

        elif etype == "tool_call_result":
            tn = ev.get("tool", "")
            ok = ev.get("success", True)
            res = str(ev.get("result", ""))
            if len(res) > 250:
                res = res[:250] + "..."
            mark = "✓ COMPLETED" if ok else "✗ FAILED"
            card_type = "success" if ok else "error"
            self._log_sig.emit(f"[{mark}] {tn}")
            self._eval_js(f"if (typeof addExecutionCard === 'function') addExecutionCard({json.dumps(card_type)}, {json.dumps(mark + ': ' + tn)}, {json.dumps(res)});")

        elif etype == "artifact_audit_result":
            path = ev.get("path", "")
            success = bool(ev.get("success", True))
            err_count = int(ev.get("errors", 0))
            details = str(ev.get("details", ""))
            self._audit_sig.emit(path, success, err_count, details)

        elif etype == "artifact_presentation":
            path = ev.get("path", "")
            app = ev.get("app", "")
            norm_path = os.path.normpath(path)
            basename = os.path.basename(norm_path)
            self._log_sig.emit(f"Artifact: {basename}")
            self._eval_js(f"if (typeof recordArtifact === 'function') recordArtifact({json.dumps(norm_path)});")
            self._eval_js(f"if (typeof addExecutionCard === 'function') addExecutionCard('artifact', '📦 ARTIFACT CREATED: ' + {json.dumps(basename)}, 'Saved to: ' + {json.dumps(norm_path)}, true, {json.dumps(norm_path)});")

        elif etype == "verification_reflection_start":
            self._state_sig.emit("THINKING")
            audit_msg = ev.get("audit", "")
            self._log_sig.emit("Reflective Verification: Checking quality...")
            self._eval_js("if (typeof addExecutionCard === 'function') addExecutionCard('tool', 'REFLECTIVE VERIFICATION', 'Inspecting task completion and format quality...');")

        elif etype == "task_completed":
            self._state_sig.emit("LISTENING")
            ans = ev.get("final_answer", "")
            tokens = ev.get("tokens", 0)
            cost = ev.get("cost_usd", 0.0)
            detail = f"{ans}\n\n[Tokens: {tokens} | Cost: ${cost:.4f}]"
            self._chat_sig.emit("NIM_AGENT", ans)
            self._log_sig.emit(f"Task Complete ({tokens} tokens)")
            self._eval_js(f"if (typeof addExecutionCard === 'function') addExecutionCard('success', '✓ TASK COMPLETE', {json.dumps(detail)});")

        elif etype == "task_cancelled":
            self._state_sig.emit("LISTENING")
            self._log_sig.emit("Task cancelled by operator.")
            self._eval_js("if (typeof addExecutionCard === 'function') addExecutionCard('error', 'TASK CANCELLED', 'Operation stopped by operator.');")

        elif etype == "error":
            self._state_sig.emit("LISTENING")
            err_msg = ev.get("message", "An unexpected error occurred.")
            self._chat_sig.emit("SYSTEM", f"Error: {err_msg}")
            self._log_sig.emit(f"ERROR: {err_msg}")
            self._eval_js(f"if (typeof addExecutionCard === 'function') addExecutionCard('error', 'ERROR OCCURRED', {json.dumps(err_msg)});")


def run_gui():
    """Initializes and runs the NIM AGENT Holographic GUI."""
    _setup_qt_environment()
    app = QApplication.instance() or QApplication(sys.argv)
    app.setStyle("Fusion")

    # Anti-flicker global dark palette to prevent white flashes on focus/window change
    dark_pal = QPalette()
    dark_pal.setColor(QPalette.ColorRole.Window, QColor("#000b10"))
    dark_pal.setColor(QPalette.ColorRole.WindowText, QColor("#e0f9ff"))
    dark_pal.setColor(QPalette.ColorRole.Base, QColor("#000b10"))
    dark_pal.setColor(QPalette.ColorRole.AlternateBase, QColor("#01121a"))
    dark_pal.setColor(QPalette.ColorRole.ToolTipBase, QColor("#000b10"))
    dark_pal.setColor(QPalette.ColorRole.ToolTipText, QColor("#e0f9ff"))
    dark_pal.setColor(QPalette.ColorRole.Text, QColor("#e0f9ff"))
    dark_pal.setColor(QPalette.ColorRole.Button, QColor("#01121a"))
    dark_pal.setColor(QPalette.ColorRole.ButtonText, QColor("#e0f9ff"))
    dark_pal.setColor(QPalette.ColorRole.BrightText, QColor("#00e5ff"))
    app.setPalette(dark_pal)

    orchestrator = AgentOrchestrator()
    win = NimHolographicWindow(orchestrator)
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    run_gui()
