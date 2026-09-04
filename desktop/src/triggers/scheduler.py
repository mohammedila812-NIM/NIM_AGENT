import asyncio
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple

from src.perception.window_manager import WindowManager

logger = logging.getLogger(__name__)

# List of process/window keywords that signify a meeting or active presentation
MEETING_APP_PATTERNS = [
    "zoom.exe",
    "teams.exe",
    "webex.exe",
    "slack.exe",
    "discord.exe",
    "meet.google.com",
    "google meet",
    "zoom meeting",
    "microsoft teams meeting",
]

@dataclass
class ParsedSchedule:
    schedule_type: str  # "interval", "cron", "once"
    next_run_at: float
    cron_expr: Optional[str] = None
    interval_seconds: Optional[float] = None
    description: str = ""

def parse_schedule_expression(expr: str) -> ParsedSchedule:
    """
    Parses natural language timing or standard 5-part cron syntax.
    Examples:
      - 'in 15 minutes' / 'in 2 hours' / 'in 30s'
      - 'every 10m' / 'every 30 minutes' / 'every 2 hours'
      - 'every day at 9:00' / 'every day at 9am'
      - 'every weekday at 8:30' / 'every weekday at 8:30am'
      - '0 9 * * *' (standard cron)
    """
    clean = expr.strip().lower()
    now = time.time()
    now_dt = datetime.now()

    # 1. One-shot Delay: "in X minutes / hours / seconds"
    m_in = re.match(r"^in\s+(\d+(?:\.\d+)?)\s*(s|sec|seconds?|m|min|minutes?|h|hrs?|hours?)$", clean)
    if m_in:
        val = float(m_in.group(1))
        unit = m_in.group(2)
        if unit.startswith("s"):
            sec = val
        elif unit.startswith("m"):
            sec = val * 60
        else:
            sec = val * 3600
        return ParsedSchedule(
            schedule_type="once",
            next_run_at=now + sec,
            description=f"One-time run in {val} {unit}"
        )

    # 2. Interval: "every X minutes / hours / seconds"
    m_every = re.match(r"^every\s+(\d+(?:\.\d+)?)\s*(s|sec|seconds?|m|min|minutes?|h|hrs?|hours?)$", clean)
    if m_every:
        val = float(m_every.group(1))
        unit = m_every.group(2)
        if unit.startswith("s"):
            sec = val
        elif unit.startswith("m"):
            sec = val * 60
        else:
            sec = val * 3600
        return ParsedSchedule(
            schedule_type="interval",
            next_run_at=now + sec,
            interval_seconds=sec,
            description=f"Runs every {val} {unit}"
        )

    # 3. Daily at specific time: "every day at 9:00" or "every day at 9am" / "every day at 14:30"
    m_daily = re.match(r"^every\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$", clean)
    if m_daily:
        hour = int(m_daily.group(1))
        minute = int(m_daily.group(2) or 0)
        ampm = m_daily.group(3)
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0

        target_dt = now_dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target_dt.timestamp() <= now:
            target_dt += timedelta(days=1)

        cron = f"{minute} {hour} * * *"
        return ParsedSchedule(
            schedule_type="cron",
            next_run_at=target_dt.timestamp(),
            cron_expr=cron,
            description=f"Runs daily at {hour:02d}:{minute:02d}"
        )

    # 4. Weekdays at specific time: "every weekday at 8:30"
    m_weekday = re.match(r"^every\s+weekday\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$", clean)
    if m_weekday:
        hour = int(m_weekday.group(1))
        minute = int(m_weekday.group(2) or 0)
        ampm = m_weekday.group(3)
        if ampm == "pm" and hour < 12:
            hour += 12
        elif ampm == "am" and hour == 12:
            hour = 0

        target_dt = now_dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
        while target_dt.timestamp() <= now or target_dt.weekday() >= 5:
            target_dt += timedelta(days=1)

        cron = f"{minute} {hour} * * 1-5"
        return ParsedSchedule(
            schedule_type="cron",
            next_run_at=target_dt.timestamp(),
            cron_expr=cron,
            description=f"Runs weekdays (Mon-Fri) at {hour:02d}:{minute:02d}"
        )

    # 5. Standard 5-Part Cron (e.g. "*/15 * * * *" or "0 9 * * 1-5")
    parts = clean.split()
    if len(parts) == 5:
        # Calculate next run timestamp from simple cron fields
        next_ts = now + 60.0  # Default next minute fallback
        try:
            from croniter import croniter
            itr = croniter(clean, now_dt)
            next_ts = itr.get_next()
        except ImportError:
            # Simple manual calculation for common minute/hour intervals
            if parts[0].startswith("*/"):
                min_step = int(parts[0][2:])
                next_ts = now + (min_step * 60)
            elif parts[1] != "*":
                hour = int(parts[1])
                target_dt = now_dt.replace(hour=hour, minute=int(parts[0] if parts[0] != '*' else 0), second=0, microsecond=0)
                if target_dt.timestamp() <= now:
                    target_dt += timedelta(days=1)
                next_ts = target_dt.timestamp()

        return ParsedSchedule(
            schedule_type="cron",
            next_run_at=next_ts,
            cron_expr=clean,
            description=f"Cron schedule: '{clean}'"
        )

    # Default fallback: 1 hour from now
    return ParsedSchedule(
        schedule_type="once",
        next_run_at=now + 3600.0,
        description=f"Custom one-time trigger: {expr}"
    )

def calculate_next_cron_run(cron_expr: str, base_time: float) -> float:
    """Calculates next epoch timestamp for a given cron expression."""
    try:
        from croniter import croniter
        base_dt = datetime.fromtimestamp(base_time)
        itr = croniter(cron_expr, base_dt)
        return float(itr.get_next())
    except Exception:
        # Fallback: +1 day
        return base_time + 86400.0

class SchedulerEngine:
    """
    Intelligent Context-Aware Scheduler Engine.
    Manages persistent scheduled jobs, checks meeting/presentation states before triggering,
    reasons about missed task relevance, and executes automation pipelines.
    """

    def __init__(
        self,
        execution_callback: Optional[Callable[[str], Any]] = None,
        poll_interval: float = 3.0
    ):
        from src.agent.memory import get_memory_store
        self.memory_store = get_memory_store()
        self.window_manager = WindowManager()
        self.execution_callback = execution_callback
        self.poll_interval = poll_interval
        self._running = False
        self._paused_until: Optional[float] = None
        self._worker_task: Optional[asyncio.Task] = None

    def is_user_in_meeting_or_busy(self) -> Tuple[bool, str]:
        """
        Checks if the user is currently in a meeting (Zoom, Teams, Webex, Meet)
        or full-screen presentation to avoid disruptive popups/actions.
        """
        try:
            open_wins = self.window_manager.list_windows()
            for w in open_wins:
                proc = w.process_name.lower()
                title = w.title.lower()
                for pat in MEETING_APP_PATTERNS:
                    if pat in proc or pat in title:
                        return True, f"User is in a meeting/call ({w.title or proc})"
        except Exception:
            pass
        return False, ""

    def evaluate_missed_task_relevance(self, task: Dict[str, Any], scheduled_time: float) -> Tuple[bool, str]:
        """
        Evaluates whether a task that missed its run time (e.g. while the PC was off)
        is still relevant or should be skipped/rescheduled.
        """
        now = time.time()
        elapsed_hours = (now - scheduled_time) / 3600.0
        goal = task.get("goal", "").lower()

        # If more than 4 hours late and it was a morning-specific summary
        if elapsed_hours > 4.0 and any(k in goal for k in ["morning briefing", "morning summary", "start of day"]):
            return False, f"Skipped obsolete morning task (scheduled {round(elapsed_hours, 1)}h ago)"

        return True, "Task is relevant"

    def schedule(
        self,
        goal: str,
        expression: str,
        label: Optional[str] = None,
        defer_if_busy: bool = True
    ) -> Dict[str, Any]:
        """
        Creates and persists a new scheduled task.
        """
        parsed = parse_schedule_expression(expression)
        task_id = f"sched_{uuid.uuid4().hex[:8]}"

        self.memory_store.save_scheduled_task(
            task_id=task_id,
            goal=goal,
            schedule_type=parsed.schedule_type,
            next_run_at=parsed.next_run_at,
            cron_expr=parsed.cron_expr,
            defer_if_busy=defer_if_busy,
            label=label or parsed.description,
            metadata={
                "expression": expression,
                "interval_seconds": parsed.interval_seconds,
                "description": parsed.description
            }
        )

        next_dt_str = datetime.fromtimestamp(parsed.next_run_at).strftime("%Y-%m-%d %H:%M:%S")
        return {
            "success": True,
            "task_id": task_id,
            "goal": goal,
            "schedule_type": parsed.schedule_type,
            "next_run_at": parsed.next_run_at,
            "next_run_readable": next_dt_str,
            "label": label or parsed.description,
            "message": f"Scheduled task '{task_id}': {parsed.description} (Next: {next_dt_str})"
        }

    def list_schedules(self) -> List[Dict[str, Any]]:
        """Returns all scheduled tasks with human-readable timestamps."""
        tasks = self.memory_store.list_scheduled_tasks()
        now = time.time()
        for t in tasks:
            next_ts = t.get("next_run_at", 0)
            t["next_run_readable"] = datetime.fromtimestamp(next_ts).strftime("%Y-%m-%d %H:%M:%S") if next_ts else "N/A"
            t["due_in_seconds"] = max(0, int(next_ts - now)) if next_ts else 0
        return tasks

    def cancel(self, task_id: str) -> bool:
        """Cancels a scheduled task."""
        return self.memory_store.delete_scheduled_task(task_id)

    def pause(self, duration_minutes: float = 60.0):
        """Temporarily pauses the scheduler."""
        self._paused_until = time.time() + (duration_minutes * 60.0)
        logger.info("Scheduler paused for %s minutes", duration_minutes)

    def resume(self):
        """Resumes scheduler execution."""
        self._paused_until = None
        logger.info("Scheduler resumed")

    # -------------------------------------------------------------------------
    # Background Execution Worker Loop
    # -------------------------------------------------------------------------

    async def start(self):
        """Starts the background scheduler loop."""
        if self._running:
            return
        self._running = True
        self._worker_task = asyncio.create_task(self._run_loop())
        logger.info("SchedulerEngine started.")

    async def stop(self):
        """Stops the scheduler loop."""
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        logger.info("SchedulerEngine stopped.")

    async def _run_loop(self):
        while self._running:
            try:
                await asyncio.sleep(self.poll_interval)
                now = time.time()

                # Check pause state
                if self._paused_until and now < self._paused_until:
                    continue

                active_tasks = self.memory_store.list_scheduled_tasks(status="active")
                for task in active_tasks:
                    next_run = task.get("next_run_at", 0)
                    if next_run <= now:
                        await self._process_due_task(task)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Scheduler run loop error: %s", e)

    async def _process_due_task(self, task: Dict[str, Any]):
        task_id = task["task_id"]
        goal = task["goal"]
        sched_type = task.get("schedule_type", "once")
        defer_if_busy = bool(task.get("defer_if_busy", 1))
        now = time.time()

        # 1. Context Gate: Check if user is in a meeting
        if defer_if_busy:
            is_busy, busy_reason = self.is_user_in_meeting_or_busy()
            if is_busy:
                logger.info("Deferring scheduled task '%s': %s", task_id, busy_reason)
                # Defer 10 minutes
                self.memory_store.update_task_run(task_id, next_run_at=now + 600.0)
                return

        # 2. Missed Task Relevance Reasoner
        scheduled_at = task.get("next_run_at", now)
        is_relevant, reason = self.evaluate_missed_task_relevance(task, scheduled_at)
        if not is_relevant:
            logger.info("Skipping obsolete task '%s': %s", task_id, reason)
            if sched_type == "cron" and task.get("cron_expr"):
                next_ts = calculate_next_cron_run(task["cron_expr"], now)
                self.memory_store.update_task_run(task_id, next_run_at=next_ts)
            else:
                self.memory_store.update_task_run(task_id, status="completed")
            return

        # 3. Execute Task via callback or orchestrator
        logger.info("Executing scheduled task '%s': %s", task_id, goal)
        try:
            if self.execution_callback:
                res = self.execution_callback(goal)
                if asyncio.iscoroutine(res):
                    await res
        except Exception as exec_err:
            logger.error("Error executing scheduled task '%s': %s", task_id, exec_err)

        # 4. Advance Next Run Time
        if sched_type == "cron" and task.get("cron_expr"):
            next_ts = calculate_next_cron_run(task["cron_expr"], now)
            self.memory_store.update_task_run(task_id, next_run_at=next_ts)
        elif sched_type == "interval":
            interval_sec = task.get("metadata", {}).get("interval_seconds", 3600.0)
            self.memory_store.update_task_run(task_id, next_run_at=now + interval_sec)
        else:
            # One-shot complete
            self.memory_store.update_task_run(task_id, status="completed")
