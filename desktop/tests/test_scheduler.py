import asyncio
import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.triggers.scheduler import (
    SchedulerEngine,
    parse_schedule_expression,
    calculate_next_cron_run,
    ParsedSchedule
)
from src.tools.scheduler_tools import (
    ScheduleTaskTool,
    ListScheduledTasksTool,
    CancelScheduledTaskTool,
    PauseSchedulerTool,
    ResumeSchedulerTool,
    set_scheduler_engine
)
from src.tools.base import ToolContext
from src.perception.window_manager import WindowInfo

def test_parse_schedule_expressions():
    # 1. One-shot delay: "in 15 minutes"
    res1 = parse_schedule_expression("in 15 minutes")
    assert res1.schedule_type == "once"
    assert res1.next_run_at > time.time() + 800

    # 2. Interval: "every 30 seconds"
    res2 = parse_schedule_expression("every 30 seconds")
    assert res2.schedule_type == "interval"
    assert res2.interval_seconds == 30.0

    # 3. Daily: "every day at 9am"
    res3 = parse_schedule_expression("every day at 9am")
    assert res3.schedule_type == "cron"
    assert res3.cron_expr == "0 9 * * *"

    # 4. Weekdays: "every weekday at 8:30"
    res4 = parse_schedule_expression("every weekday at 8:30")
    assert res4.schedule_type == "cron"
    assert res4.cron_expr == "30 8 * * 1-5"

    # 5. Standard 5-part cron: "0 18 * * 1-5"
    res5 = parse_schedule_expression("0 18 * * 1-5")
    assert res5.schedule_type == "cron"
    assert res5.cron_expr == "0 18 * * 1-5"

def test_scheduler_crud():
    engine = SchedulerEngine()

    # Schedule a task
    res = engine.schedule(
        goal="Summarize downloads folder",
        expression="in 30m",
        label="Download Summary",
        defer_if_busy=True
    )
    assert res["success"] is True
    task_id = res["task_id"]

    # List schedules
    schedules = engine.list_schedules()
    assert any(s["task_id"] == task_id for s in schedules)

    # Cancel task
    cancelled = engine.cancel(task_id)
    assert cancelled is True

    # Verify no longer in list
    schedules_after = engine.list_schedules()
    assert not any(s["task_id"] == task_id for s in schedules_after)

def test_meeting_and_busy_gate():
    engine = SchedulerEngine()

    # When no meeting apps are running
    with patch.object(engine.window_manager, "list_windows", return_value=[
        WindowInfo(hwnd=1, title="Notepad", process_name="notepad.exe", pid=10, bounds={})
    ]):
        is_busy, _ = engine.is_user_in_meeting_or_busy()
        assert is_busy is False

    # When Zoom is active
    with patch.object(engine.window_manager, "list_windows", return_value=[
        WindowInfo(hwnd=2, title="Zoom Meeting - Team Sync", process_name="zoom.exe", pid=20, bounds={})
    ]):
        is_busy, reason = engine.is_user_in_meeting_or_busy()
        assert is_busy is True
        assert "meeting" in reason.lower()

def test_missed_task_relevance():
    engine = SchedulerEngine()
    now = time.time()

    # Morning task 6 hours late -> should be flagged obsolete
    old_morning_task = {"goal": "Send daily morning briefing summary to team"}
    is_rel, reason = engine.evaluate_missed_task_relevance(old_morning_task, scheduled_time=now - (6 * 3600))
    assert is_rel is False
    assert "obsolete" in reason.lower()

    # General backup task 2 hours late -> still relevant
    backup_task = {"goal": "Backup database to external drive"}
    is_rel2, _ = engine.evaluate_missed_task_relevance(backup_task, scheduled_time=now - (2 * 3600))
    assert is_rel2 is True

@pytest.mark.asyncio
async def test_scheduler_tools():
    engine = SchedulerEngine()
    set_scheduler_engine(engine)
    ctx = ToolContext(task_id="test_sched_ctx")

    # 1. ScheduleTaskTool
    sched_tool = ScheduleTaskTool()
    res_sched = await sched_tool.execute({
        "goal": "Check system disk space",
        "expression": "every 1 hour",
        "label": "Disk Monitor"
    }, ctx)
    assert res_sched.success is True
    task_id = res_sched.data["task_id"]

    # 2. ListScheduledTasksTool
    list_tool = ListScheduledTasksTool()
    res_list = await list_tool.execute({}, ctx)
    assert res_list.success is True
    assert any(t["task_id"] == task_id for t in res_list.data["scheduled_tasks"])

    # 3. Pause & Resume Tools
    pause_tool = PauseSchedulerTool()
    res_pause = await pause_tool.execute({"duration_minutes": 30}, ctx)
    assert res_pause.success is True
    assert engine._paused_until is not None

    resume_tool = ResumeSchedulerTool()
    res_resume = await resume_tool.execute({}, ctx)
    assert res_resume.success is True
    assert engine._paused_until is None

    # 4. CancelScheduledTaskTool
    cancel_tool = CancelScheduledTaskTool()
    res_cancel = await cancel_tool.execute({"task_id": task_id}, ctx)
    assert res_cancel.success is True
