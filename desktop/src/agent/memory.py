import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from src.config import MEMORY_DIR

logger = logging.getLogger(__name__)

class MemoryStore:
    """
    Persistent Memory and Knowledge System for NIM JARVIS.
    Stores episodic task history, user preferences, and shared macros.
    """

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or (MEMORY_DIR / "store.db")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn

    def _init_db(self):
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                # 1. Episodic Task History Table
                cursor.execute("""
                CREATE TABLE IF NOT EXISTS task_history (
                    task_id TEXT PRIMARY KEY,
                    goal TEXT NOT NULL,
                    summary TEXT,
                    status TEXT,
                    steps_count INTEGER,
                    tokens_used INTEGER,
                    created_at REAL
                )
                """)

                # 2. User Preferences Table
                cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_preferences (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    category TEXT,
                    updated_at REAL
                )
                """)

                # 3. Macro Library Table
                cursor.execute("""
                CREATE TABLE IF NOT EXISTS macros (
                    name TEXT PRIMARY KEY,
                    description TEXT,
                    steps_json TEXT NOT NULL,
                    run_count INTEGER DEFAULT 0,
                    created_at REAL
                )
                """)

                # 4. Workspace Layouts Table
                cursor.execute("""
                CREATE TABLE IF NOT EXISTS workspaces (
                    name TEXT PRIMARY KEY,
                    description TEXT,
                    windows_json TEXT NOT NULL,
                    created_at REAL,
                    updated_at REAL
                )
                """)

                # 5. Scheduled Tasks Table
                cursor.execute("""
                CREATE TABLE IF NOT EXISTS scheduled_tasks (
                    task_id TEXT PRIMARY KEY,
                    goal TEXT NOT NULL,
                    cron_expr TEXT,
                    schedule_type TEXT NOT NULL,
                    next_run_at REAL NOT NULL,
                    last_run_at REAL,
                    status TEXT DEFAULT 'active',
                    defer_if_busy INTEGER DEFAULT 1,
                    label TEXT,
                    runs_count INTEGER DEFAULT 0,
                    metadata_json TEXT,
                    created_at REAL
                )
                """)

                # 6. Process Baselines & Resource Metrics Table
                cursor.execute("""
                CREATE TABLE IF NOT EXISTS process_baselines (
                    process_name TEXT PRIMARY KEY,
                    sample_count INTEGER DEFAULT 1,
                    avg_ram_mb REAL NOT NULL,
                    max_ram_mb REAL NOT NULL,
                    min_ram_mb REAL NOT NULL,
                    avg_cpu_percent REAL DEFAULT 0.0,
                    last_seen_at REAL,
                    created_at REAL
                )
                """)
                conn.commit()
        except Exception as e:
            logger.error("Failed to initialize memory store DB: %s", e)

    def record_task(self, task_id: str, goal: str, summary: str, status: str, steps_count: int, tokens: int):
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT OR REPLACE INTO task_history (task_id, goal, summary, status, steps_count, tokens_used, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (task_id, goal, summary, status, steps_count, tokens, time.time()))
                conn.commit()
        except Exception as e:
            logger.error("Failed to record task in memory: %s", e)

    def get_recent_tasks(self, limit: int = 10) -> List[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM task_history ORDER BY created_at DESC LIMIT ?", (limit,))
                rows = cursor.fetchall()
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error("Failed to fetch task history: %s", e)
            return []

    def set_preference(self, key: str, value: Any, category: str = "general"):
        try:
            val_str = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT OR REPLACE INTO user_preferences (key, value, category, updated_at)
                VALUES (?, ?, ?, ?)
                """, (key, val_str, category, time.time()))
                conn.commit()
        except Exception as e:
            logger.error("Failed to set preference: %s", e)

    def get_preference(self, key: str, default: Optional[Any] = None) -> Optional[Any]:
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT value FROM user_preferences WHERE key = ?", (key,))
                row = cursor.fetchone()
                if row:
                    try:
                        return json.loads(row[0])
                    except Exception:
                        return row[0]
                return default
        except Exception as e:
            logger.error("Failed to get preference: %s", e)
            return default

    def save_macro(self, name: str, description: str, steps: List[Dict[str, Any]]):
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                INSERT OR REPLACE INTO macros (name, description, steps_json, created_at)
                VALUES (?, ?, ?, ?)
                """, (name, description, json.dumps(steps), time.time()))
                conn.commit()
        except Exception as e:
            logger.error("Failed to save macro: %s", e)

    def get_macro(self, name: str) -> Optional[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM macros WHERE name = ?", (name,))
                row = cursor.fetchone()
                if row:
                    d = dict(row)
                    d["steps"] = json.loads(d["steps_json"])
                    return d
                return None
        except Exception as e:
            logger.error("Failed to get macro: %s", e)
            return None

    def list_macros(self) -> List[Dict[str, Any]]:
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT name, description, run_count, created_at FROM macros ORDER BY name ASC")
                return [dict(r) for r in cursor.fetchall()]
        except Exception as e:
            logger.error("Failed to list macros: %s", e)
            return []

    def save_workspace(self, name: str, description: str, windows: List[Dict[str, Any]]):
        """Saves a multi-window layout snapshot into SQLite memory."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                now = time.time()
                cursor.execute("""
                INSERT OR REPLACE INTO workspaces (name, description, windows_json, created_at, updated_at)
                VALUES (?, ?, ?, COALESCE((SELECT created_at FROM workspaces WHERE name = ?), ?), ?)
                """, (name, description, json.dumps(windows), name, now, now))
                conn.commit()
        except Exception as e:
            logger.error("Failed to save workspace layout '%s': %s", name, e)

    def get_workspace(self, name: str) -> Optional[Dict[str, Any]]:
        """Retrieves a saved workspace layout by name."""
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM workspaces WHERE name = ?", (name,))
                row = cursor.fetchone()
                if row:
                    d = dict(row)
                    d["windows"] = json.loads(d["windows_json"])
                    return d
                return None
        except Exception as e:
            logger.error("Failed to get workspace layout '%s': %s", name, e)
            return None

    def list_workspaces(self) -> List[Dict[str, Any]]:
        """Lists all saved workspace layouts."""
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT name, description, created_at, updated_at FROM workspaces ORDER BY name ASC")
                return [dict(r) for r in cursor.fetchall()]
        except Exception as e:
            logger.error("Failed to list workspace layouts: %s", e)
            return []

    def delete_workspace(self, name: str) -> bool:
        """Deletes a saved workspace layout."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM workspaces WHERE name = ?", (name,))
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            logger.error("Failed to delete workspace layout '%s': %s", name, e)
            return False

    def save_scheduled_task(
        self,
        task_id: str,
        goal: str,
        schedule_type: str,
        next_run_at: float,
        cron_expr: Optional[str] = None,
        defer_if_busy: bool = True,
        label: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Saves or updates a scheduled task in the database."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                now = time.time()
                meta_str = json.dumps(metadata) if metadata else None
                cursor.execute("""
                INSERT OR REPLACE INTO scheduled_tasks (
                    task_id, goal, cron_expr, schedule_type, next_run_at, status,
                    defer_if_busy, label, metadata_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, COALESCE((SELECT created_at FROM scheduled_tasks WHERE task_id = ?), ?))
                """, (task_id, goal, cron_expr, schedule_type, next_run_at, 1 if defer_if_busy else 0, label, meta_str, task_id, now))
                conn.commit()
        except Exception as e:
            logger.error("Failed to save scheduled task '%s': %s", task_id, e)

    def list_scheduled_tasks(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """Lists scheduled tasks, optionally filtered by status ('active', 'paused', 'completed')."""
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                if status:
                    cursor.execute("SELECT * FROM scheduled_tasks WHERE status = ? ORDER BY next_run_at ASC", (status,))
                else:
                    cursor.execute("SELECT * FROM scheduled_tasks ORDER BY next_run_at ASC")
                rows = cursor.fetchall()
                res = []
                for r in rows:
                    d = dict(r)
                    if d.get("metadata_json"):
                        try:
                            d["metadata"] = json.loads(d["metadata_json"])
                        except Exception:
                            d["metadata"] = {}
                    res.append(d)
                return res
        except Exception as e:
            logger.error("Failed to list scheduled tasks: %s", e)
            return []

    def get_scheduled_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a specific scheduled task by ID."""
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM scheduled_tasks WHERE task_id = ?", (task_id,))
                row = cursor.fetchone()
                if row:
                    d = dict(row)
                    if d.get("metadata_json"):
                        try:
                            d["metadata"] = json.loads(d["metadata_json"])
                        except Exception:
                            d["metadata"] = {}
                    return d
                return None
        except Exception as e:
            logger.error("Failed to get scheduled task '%s': %s", task_id, e)
            return None

    def update_task_run(
        self,
        task_id: str,
        next_run_at: Optional[float] = None,
        status: Optional[str] = None
    ):
        """Updates task execution metadata after a run."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                now = time.time()
                if next_run_at is not None and status is not None:
                    cursor.execute("""
                    UPDATE scheduled_tasks
                    SET last_run_at = ?, next_run_at = ?, status = ?, runs_count = runs_count + 1
                    WHERE task_id = ?
                    """, (now, next_run_at, status, task_id))
                elif next_run_at is not None:
                    cursor.execute("""
                    UPDATE scheduled_tasks
                    SET last_run_at = ?, next_run_at = ?, runs_count = runs_count + 1
                    WHERE task_id = ?
                    """, (now, next_run_at, task_id))
                elif status is not None:
                    cursor.execute("""
                    UPDATE scheduled_tasks SET status = ? WHERE task_id = ?
                    """, (status, task_id))
                conn.commit()
        except Exception as e:
            logger.error("Failed to update scheduled task run for '%s': %s", task_id, e)

    def delete_scheduled_task(self, task_id: str) -> bool:
        """Deletes a scheduled task by ID."""
        try:
            with self._get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM scheduled_tasks WHERE task_id = ?", (task_id,))
                conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            logger.error("Failed to delete scheduled task '%s': %s", task_id, e)
            return False

    def record_process_metric(self, process_name: str, ram_mb: float, cpu_percent: float = 0.0):
        """Records a process resource observation and updates the cumulative baseline."""
        try:
            clean_name = process_name.strip().lower()
            with self._get_connection() as conn:
                cursor = conn.cursor()
                now = time.time()
                cursor.execute("SELECT sample_count, avg_ram_mb, max_ram_mb, min_ram_mb, avg_cpu_percent FROM process_baselines WHERE process_name = ?", (clean_name,))
                row = cursor.fetchone()
                if row:
                    count, avg_ram, max_ram, min_ram, avg_cpu = row
                    new_count = count + 1
                    # Incremental moving average formula
                    new_avg_ram = avg_ram + (ram_mb - avg_ram) / new_count
                    new_max_ram = max(max_ram, ram_mb)
                    new_min_ram = min(min_ram, ram_mb)
                    new_avg_cpu = avg_cpu + (cpu_percent - avg_cpu) / new_count
                    cursor.execute("""
                    UPDATE process_baselines
                    SET sample_count = ?, avg_ram_mb = ?, max_ram_mb = ?, min_ram_mb = ?, avg_cpu_percent = ?, last_seen_at = ?
                    WHERE process_name = ?
                    """, (new_count, new_avg_ram, new_max_ram, new_min_ram, new_avg_cpu, now, clean_name))
                else:
                    cursor.execute("""
                    INSERT INTO process_baselines (process_name, sample_count, avg_ram_mb, max_ram_mb, min_ram_mb, avg_cpu_percent, last_seen_at, created_at)
                    VALUES (?, 1, ?, ?, ?, ?, ?, ?)
                    """, (clean_name, ram_mb, ram_mb, ram_mb, cpu_percent, now, now))
                conn.commit()
        except Exception as e:
            logger.error("Failed to record process metric for '%s': %s", process_name, e)

    def get_process_baseline(self, process_name: str) -> Optional[Dict[str, Any]]:
        """Retrieves learned baseline metrics for an application."""
        try:
            clean_name = process_name.strip().lower()
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM process_baselines WHERE process_name = ?", (clean_name,))
                row = cursor.fetchone()
                return dict(row) if row else None
        except Exception as e:
            logger.error("Failed to get process baseline for '%s': %s", process_name, e)
            return None

    def list_process_baselines(self) -> List[Dict[str, Any]]:
        """Lists all learned application resource baselines."""
        try:
            with self._get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM process_baselines ORDER BY avg_ram_mb DESC")
                return [dict(r) for r in cursor.fetchall()]
        except Exception as e:
            logger.error("Failed to list process baselines: %s", e)
            return []

_global_memory_store: Optional[MemoryStore] = None

def get_memory_store() -> MemoryStore:
    global _global_memory_store
    if _global_memory_store is None:
        _global_memory_store = MemoryStore()
    return _global_memory_store
