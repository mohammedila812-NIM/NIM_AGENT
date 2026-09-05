"""
session_memory.py
-----------------
Autonomous Dynamic Session Memory & Context Resolver for NIM JARVIS.

Features:
1. Turn-by-turn session memory recording with artifact & tool tracking.
2. Auto-highlighting of critical memory points (decisions, paths, constraints, entities).
3. Autonomous context-need detector: detects elliptical queries, missing context,
   and pronouns (e.g. "do the same for it", "continue", "what did we decide?")
   and extracts targeted relevant context without brute-force prompt dumping.
4. Fast fuzzy/semantic keyword retrieval for on-demand tool recall.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from src.config import MEMORY_DIR

logger = logging.getLogger(__name__)


@dataclass
class SessionTurn:
    turn_id: str
    goal: str
    final_answer: str
    tools_used: List[str] = field(default_factory=list)
    files_touched: List[str] = field(default_factory=list)
    key_entities: Dict[str, str] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)


@dataclass
class HighlightedMemory:
    category: str  # 'decision' | 'filepath' | 'constraint' | 'preference' | 'entity'
    key: str
    value: str
    confidence: float = 1.0
    timestamp: float = field(default_factory=time.time)


class SessionMemoryManager:
    """
    Manages short-term working session memory, automatic entity extraction,
    auto-highlighting of critical context, and autonomous context resolution.
    """

    # Linguistic cues indicating the user prompt references earlier conversation
    ANAPHORIC_PATTERNS = [
        r"\b(it|this|that|them|these|those|both|the same|its|their)\b",
        r"\b(continue|proceed|go on|repeat|redo|again|next step|previous|earlier|before)\b",
        r"\b(what did (we|you)|what was (the|my|that)|remind me|summary of)\b",
        r"\b(fix (that|the error|the issue)|undo (that|it)|why did that happen)\b",
        r"\b(send (it|that)|convert (it|that)|delete (it|that)|save (it|that))\b",
    ]

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or (MEMORY_DIR / "store.db")
        self._turns: List[SessionTurn] = []
        self._highlights: List[HighlightedMemory] = []
        self._init_tables()
        self._load_recent_highlights()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn

    def _init_tables(self):
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                # Session turns table
                cursor.execute("""
                CREATE TABLE IF NOT EXISTS session_turns (
                    turn_id TEXT PRIMARY KEY,
                    goal TEXT NOT NULL,
                    final_answer TEXT,
                    tools_used TEXT,
                    files_touched TEXT,
                    key_entities TEXT,
                    created_at REAL
                )
                """)
                # Auto-highlighted memories table
                cursor.execute("""
                CREATE TABLE IF NOT EXISTS session_highlights (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    category TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    confidence REAL DEFAULT 1.0,
                    created_at REAL
                )
                """)
                conn.commit()
        except Exception as e:
            logger.error("Failed to initialize session memory tables: %s", e)

    def _load_recent_highlights(self):
        """Loads active memory highlights from recent session."""
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM session_highlights ORDER BY created_at DESC LIMIT 30")
                rows = cursor.fetchall()
                self._highlights = [
                    HighlightedMemory(
                        category=r["category"],
                        key=r["key"],
                        value=r["value"],
                        confidence=r["confidence"],
                        timestamp=r["created_at"]
                    )
                    for r in rows
                ]
        except Exception as e:
            logger.debug("Could not load recent highlights: %s", e)

    def record_turn(
        self,
        turn_id: str,
        goal: str,
        final_answer: str,
        tools_used: Optional[List[str]] = None,
        files_touched: Optional[List[str]] = None,
    ) -> SessionTurn:
        """Records a completed turn, extracts key entities, and auto-highlights important facts."""
        tools = tools_used or []
        files = files_touched or []
        entities = self._extract_entities(goal, final_answer, files)

        turn = SessionTurn(
            turn_id=turn_id,
            goal=goal,
            final_answer=final_answer,
            tools_used=tools,
            files_touched=files,
            key_entities=entities,
            timestamp=time.time()
        )
        self._turns.append(turn)

        # Persist to database
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT OR REPLACE INTO session_turns (turn_id, goal, final_answer, tools_used, files_touched, key_entities, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    turn_id,
                    goal,
                    final_answer,
                    json.dumps(tools),
                    json.dumps(files),
                    json.dumps(entities),
                    turn.timestamp
                ))
                conn.commit()
        except Exception as e:
            logger.error("Failed to persist session turn '%s': %s", turn_id, e)

        # Auto-highlight new facts from this turn
        self._auto_highlight_from_turn(turn)
        return turn

    def _extract_entities(self, goal: str, answer: str, files: List[str]) -> Dict[str, str]:
        """Extracts significant entities (file paths, targets, decisions) from a conversation turn."""
        entities: Dict[str, str] = {}
        text = f"{goal}\n{answer}"

        # 1. File paths (Windows and Unix paths)
        path_matches = re.findall(r"([a-zA-Z]:\\[^\s\"'<>|]+|/[^\s\"'<>|]+|[a-zA-Z0-9_\-]+\.[a-zA-Z0-9]{2,5})", text)
        for p in path_matches + files:
            if len(p) > 3 and not p.startswith("http"):
                entities[f"path:{Path(p).name}"] = p

        # 2. Key application mentions
        apps = ["vscode", "chrome", "edge", "excel", "word", "powerpoint", "whatsapp", "notepad", "terminal", "outlook"]
        for app in apps:
            if re.search(rf"\b{app}\b", text, re.IGNORECASE):
                entities[f"app:{app}"] = app.capitalize()

        return entities

    def _auto_highlight_from_turn(self, turn: SessionTurn):
        """Extracts and persists important facts and constraints from a turn."""
        new_highlights: List[HighlightedMemory] = []

        # Highlight touched file paths
        for f in turn.files_touched:
            new_highlights.append(HighlightedMemory(
                category="filepath",
                key=Path(f).name,
                value=str(f),
                confidence=1.0
            ))

        # Highlight key decisions / conclusions
        if len(turn.final_answer) > 20:
            # Capture concise outcome sentence
            first_sentence = turn.final_answer.strip().split("\n")[0]
            if len(first_sentence) < 160 and ("✓" in first_sentence or "created" in first_sentence.lower() or "saved" in first_sentence.lower()):
                new_highlights.append(HighlightedMemory(
                    category="decision",
                    key=f"outcome_{turn.turn_id[:6]}",
                    value=first_sentence,
                    confidence=0.9
                ))

        for h in new_highlights:
            self._highlights.insert(0, h)
            try:
                with self._get_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                    INSERT INTO session_highlights (category, key, value, confidence, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """, (h.category, h.key, h.value, h.confidence, h.timestamp))
                    conn.commit()
            except Exception as e:
                logger.debug("Failed to store highlight: %s", e)

        # Keep in-memory list bounded
        if len(self._highlights) > 50:
            self._highlights = self._highlights[:50]

    def detect_context_need(self, prompt: str) -> Optional[str]:
        """
        Evaluates whether the prompt is incomplete or requires context from previous turns.
        Returns a formatted context snippet if needed, or None if the prompt is self-contained.
        """
        if not prompt or not self._turns:
            return None

        clean_prompt = prompt.strip()

        # Check anaphoric / incomplete query patterns
        needs_context = False
        for pat in self.ANAPHORIC_PATTERNS:
            if re.search(pat, clean_prompt, re.IGNORECASE):
                needs_context = True
                break

        # Ultra-short ambiguous follow-ups (1-2 words, e.g. "why?", "explain", "next")
        words = clean_prompt.split()
        if len(words) <= 2 and clean_prompt.lower() not in ["help", "status", "exit", "quit", "/exit", "/keys"]:
            needs_context = True

        if not needs_context:
            return None

        # Assemble targeted context snippet from last 1-3 turns and auto-highlights
        context_lines = ["[Relevant Prior Session Context]"]

        # Add last 2 turns (goal + brief summary)
        recent = self._turns[-2:]
        for i, t in enumerate(recent, 1):
            ans_summary = t.final_answer.strip().split("\n")[0][:120] if t.final_answer else "Completed"
            context_lines.append(f"• Previous Goal {i}: \"{t.goal}\" → Result: {ans_summary}")
            if t.files_touched:
                context_lines.append(f"  Files involved: {', '.join(t.files_touched[:3])}")

        # Add relevant highlighted memories (file paths & key decisions)
        active_highlights = [h for h in self._highlights[:5] if h.category in ("filepath", "decision", "preference")]
        if active_highlights:
            context_lines.append("\n[Auto-Highlighted Active Memory]")
            for h in active_highlights:
                context_lines.append(f"• [{h.category.upper()}] {h.key}: {h.value}")

        return "\n".join(context_lines)

    def search_memory(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Searches past session turns and highlights by keyword."""
        results: List[Dict[str, Any]] = []
        q_lower = query.lower()

        # 1. Search in-memory turns
        for turn in reversed(self._turns):
            if q_lower in turn.goal.lower() or q_lower in turn.final_answer.lower() or any(q_lower in f.lower() for f in turn.files_touched):
                results.append({
                    "type": "turn",
                    "turn_id": turn.turn_id,
                    "goal": turn.goal,
                    "summary": turn.final_answer[:200],
                    "files": turn.files_touched,
                    "timestamp": turn.timestamp,
                })
                if len(results) >= limit:
                    return results

        # 2. Search highlights
        for h in self._highlights:
            if q_lower in h.key.lower() or q_lower in h.value.lower():
                results.append({
                    "type": "highlight",
                    "category": h.category,
                    "key": h.key,
                    "value": h.value,
                    "timestamp": h.timestamp,
                })
                if len(results) >= limit:
                    break

        return results

    def get_session_summary(self, highlight_important: bool = True) -> str:
        """Returns a formatted summary of the active session with highlighted key memories."""
        if not self._turns:
            return "No previous tasks in current session."

        lines = [f"=== Session Summary ({len(self._turns)} tasks executed) ==="]
        for i, turn in enumerate(self._turns[-5:], 1):
            lines.append(f"{i}. Goal: {turn.goal}")
            if turn.final_answer:
                summary_line = turn.final_answer.strip().split("\n")[0][:100]
                lines.append(f"   Outcome: {summary_line}")
            if turn.files_touched:
                lines.append(f"   Modified: {', '.join(turn.files_touched)}")

        if highlight_important and self._highlights:
            lines.append("\n⭐ Auto-Highlighted Key Memories:")
            for h in self._highlights[:8]:
                lines.append(f"  • [{h.category}] {h.key}: {h.value}")

        return "\n".join(lines)


# Singleton instance
_global_session_manager: Optional[SessionMemoryManager] = None


def get_session_memory() -> SessionMemoryManager:
    global _global_session_manager
    if _global_session_manager is None:
        _global_session_manager = SessionMemoryManager()
    return _global_session_manager
