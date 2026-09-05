"""
engine.py — Personalization & Proactive Suggestion Engine
=========================================================
Analyzes user tasks, workflows, habits, and active applications.
Generates proactive suggestions at startup and when applications are opened.
"""

from __future__ import annotations

import datetime
import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.agent.memory import get_memory_store
from src.agent.session_memory import get_session_memory
from src.config import MEMORY_DIR

logger = logging.getLogger(__name__)


class PersonalizationEngine:
    """
    Learns user habits from task history, preferences, and active applications.
    Generates intelligent startup suggestions and app-context interventions.
    """

    APP_ACTIONS_MAP: Dict[str, List[Dict[str, str]]] = {
        "code": [
            {"label": "🔍 Check Git Status", "goal": "Run git status and summarize uncommitted changes"},
            {"label": "🧪 Run Unit Tests", "goal": "Run test suite and check for failures"},
        ],
        "excel": [
            {"label": "📊 Analyze Spreadsheet", "goal": "Inspect active Excel sheet and calculate summary totals"},
            {"label": "🔄 Convert to CSV/PDF", "goal": "Convert active spreadsheet to CSV format"},
        ],
        "chrome": [
            {"label": "📑 Summarize Tab", "goal": "Read and summarize active browser web page"},
            {"label": "📋 Extract Table Data", "goal": "Extract table data from active web page to CSV"},
        ],
        "edge": [
            {"label": "📑 Summarize Tab", "goal": "Read and summarize active browser web page"},
            {"label": "📋 Extract Table Data", "goal": "Extract table data from active web page to CSV"},
        ],
        "outlook": [
            {"label": "✉️ Check High-Priority Mail", "goal": "Check unread high-priority emails in Outlook"},
            {"label": "📅 List Today's Meetings", "goal": "Check today's scheduled meetings and calendar events"},
        ],
        "notepad": [
            {"label": "✍️ Format as Markdown", "goal": "Format text in active window as clean Markdown document"},
        ],
    }

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or (MEMORY_DIR / "store.db")
        self.memory_store = get_memory_store()
        self.session_memory = get_session_memory()
        self._last_suggested_app: Optional[str] = None
        self._last_suggested_time: float = 0.0

    def get_profile_summary(self) -> Dict[str, Any]:
        """Returns the user's learned habits, frequent tools, and preferences."""
        recent_tasks = self.memory_store.get_recent_tasks(limit=20)
        task_count = len(recent_tasks)

        # Analyze frequent topics / keywords
        top_goals = [t.get("goal", "") for t in recent_tasks[:5]]

        # Load all preferences
        preferences: Dict[str, Any] = {}
        try:
            with sqlite3.connect(str(self.db_path), timeout=5.0) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT key, value, category FROM user_preferences")
                for r in cursor.fetchall():
                    try:
                        preferences[r["key"]] = json.loads(r["value"])
                    except Exception:
                        preferences[r["key"]] = r["value"]
        except Exception:
            pass

        return {
            "total_tasks_recorded": task_count,
            "recent_goals": top_goals,
            "preferences": preferences,
            "highlights_count": len(self.session_memory._highlights),
        }

    def get_startup_suggestions(self) -> List[Dict[str, str]]:
        """Generates proactive suggestions to present at application launch."""
        suggestions: List[Dict[str, str]] = []
        now = datetime.datetime.now()
        hour = now.hour

        # 1. Time-of-day contextual suggestions
        if 5 <= hour < 12:
            greeting = "Good morning! ☀️"
            suggestions.append({
                "label": "📅 Today's Agenda & Mail",
                "goal": "Check unread emails and list scheduled calendar events for today",
                "description": f"{greeting} Review today's schedule and high-priority messages."
            })
            suggestions.append({
                "label": "🧹 Clean Downloads",
                "goal": "Scan and organize newly downloaded files in Downloads folder",
                "description": "Keep your workspace clean and organized."
            })
        elif 12 <= hour < 18:
            greeting = "Good afternoon! ⚡"
            suggestions.append({
                "label": "📊 Task Progress Check",
                "goal": "Review active tasks and summarize pending follow-up actions",
                "description": f"{greeting} Check in on active workflows."
            })
        else:
            greeting = "Good evening! 🌙"
            suggestions.append({
                "label": "📝 Daily Work Summary",
                "goal": "Summarize tasks completed today and create end-of-day report",
                "description": f"{greeting} Generate a clean wrap-up summary."
            })

        # 2. Task continuity: Suggest resuming recent project if available
        recent = self.session_memory._turns[-1:] if self.session_memory._turns else []
        if recent:
            last_turn = recent[0]
            suggestions.insert(0, {
                "label": f"⏩ Resume: {last_turn.goal[:30]}...",
                "goal": f"Continue previous task: '{last_turn.goal}'",
                "description": f"Pick up where you left off ({last_turn.goal[:45]})."
            })

        return suggestions[:3]

    def get_app_context_suggestions(self, process_name: str, window_title: str = "") -> List[Dict[str, str]]:
        """
        Generates contextual action suggestions when an application is opened or focused.
        Debounced to avoid repetitive popups for the same application.
        """
        clean_proc = (process_name or "").lower().replace(".exe", "").strip()
        now = time.time()

        # Debounce: don't suggest for the same app within 60 seconds
        if clean_proc == self._last_suggested_app and (now - self._last_suggested_time) < 60:
            return []

        # Find matching actions
        matched_actions: List[Dict[str, str]] = []
        for key, actions in self.APP_ACTIONS_MAP.items():
            if key in clean_proc or key in window_title.lower():
                matched_actions.extend(actions)

        if matched_actions:
            self._last_suggested_app = clean_proc
            self._last_suggested_time = now
            return matched_actions[:2]

        return []


_global_personalization_engine: Optional[PersonalizationEngine] = None


def get_personalization_engine() -> PersonalizationEngine:
    global _global_personalization_engine
    if _global_personalization_engine is None:
        _global_personalization_engine = PersonalizationEngine()
    return _global_personalization_engine
