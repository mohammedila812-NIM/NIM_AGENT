import asyncio
import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .downloads_watcher import DownloadsWatcher, DownloadedFileEvent
from .clipboard_listener import ClipboardListener, ClipboardAnalysisResult
from .scheduler import SchedulerEngine
from src.personalization.engine import get_personalization_engine, PersonalizationEngine

logger = logging.getLogger(__name__)

class TriggerCoordinator:
    """
    Central Coordinator for NIM JARVIS Ambient Intelligence Watchers & Scheduler.
    Manages DownloadsWatcher, ClipboardListener, SchedulerEngine, and PersonalizationEngine lifecycles
    and dispatches proactive smart suggestions to the HUD overlay and CLI.
    """

    def __init__(
        self,
        downloads_dir: Optional[Path] = None,
        on_suggestion_callback: Optional[Callable[[str, str, List[Dict[str, str]]], None]] = None,
        on_scheduled_task_callback: Optional[Callable[[str], Any]] = None
    ):
        self.on_suggestion_callback = on_suggestion_callback
        self.personalization_engine = get_personalization_engine()
        self.downloads_watcher = DownloadsWatcher(
            watch_dir=downloads_dir,
            on_download_callback=self._handle_download_event
        )
        self.clipboard_listener = ClipboardListener(
            on_event_callback=self._handle_clipboard_event
        )
        self.scheduler_engine = SchedulerEngine(
            execution_callback=on_scheduled_task_callback
        )
        # Wire global singleton for scheduler tools
        from src.tools.scheduler_tools import set_scheduler_engine
        set_scheduler_engine(self.scheduler_engine)

        self._is_active = False
        self._app_monitor_task: Optional[asyncio.Task] = None

    async def start_all(self):
        """Starts all ambient background watchers, scheduler, and personalization suggestions."""
        if self._is_active:
            return
        self.downloads_watcher.start()
        self.clipboard_listener.start()
        await self.scheduler_engine.start()
        self._is_active = True

        # Dispatch startup recommendations
        self._dispatch_startup_suggestions()

        # Start active window context poller
        self._app_monitor_task = asyncio.create_task(self._poll_active_window_context())
        logger.info("TriggerCoordinator: All ambient watchers, scheduler, and personalization engine are active.")

    async def stop_all(self):
        """Stops all ambient background watchers and the scheduler."""
        if not self._is_active:
            return
        if self._app_monitor_task:
            self._app_monitor_task.cancel()
        self.downloads_watcher.stop()
        self.clipboard_listener.stop()
        await self.scheduler_engine.stop()
        self._is_active = False
        logger.info("TriggerCoordinator: All ambient watchers stopped.")

    def _dispatch_startup_suggestions(self):
        """Emits startup recommendations to the HUD drawer."""
        try:
            suggestions = self.personalization_engine.get_startup_suggestions()
            if suggestions and self.on_suggestion_callback:
                actions = [{"label": s["label"], "goal": s["goal"]} for s in suggestions]
                self.on_suggestion_callback("startup", "⚡ Recommended Actions for Today", actions)
        except Exception as e:
            logger.debug("Error generating startup suggestions: %s", e)

    async def _poll_active_window_context(self):
        """Periodically polls foreground window and offers context-aware suggestions."""
        try:
            from src.perception.window import WindowInspector
            while self._is_active:
                await asyncio.sleep(4.0)
                info = WindowInspector.get_foreground_window_info()
                proc = info.get("process_name", "")
                title = info.get("title", "")
                if proc and proc != "unknown":
                    actions = self.personalization_engine.get_app_context_suggestions(proc, title)
                    if actions and self.on_suggestion_callback:
                        self.on_suggestion_callback("app_focus", f"💡 {proc.capitalize()} Actions", actions)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug("Window context polling notice: %s", e)

    def _handle_download_event(self, event: DownloadedFileEvent):
        title = f"📥 Download: {event.filename} ({event.size_mb} MB)"
        logger.info("Ambient trigger: %s", title)
        if self.on_suggestion_callback and event.suggested_actions:
            self.on_suggestion_callback("downloads", title, event.suggested_actions)

    def _handle_clipboard_event(self, result: ClipboardAnalysisResult):
        title = f"📋 Copied: {result.summary}"
        logger.info("Ambient trigger: %s", title)
        if self.on_suggestion_callback and result.suggested_actions:
            self.on_suggestion_callback("clipboard", title, result.suggested_actions)
