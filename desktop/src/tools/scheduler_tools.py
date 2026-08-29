from typing import Any, Dict, List, Optional
from .base import BaseTool, ToolContext, ToolResult
from src.triggers.scheduler import SchedulerEngine
from src.security.guard import ActionRiskLevel

# Shared singleton instance
_scheduler_engine: Optional[SchedulerEngine] = None

def get_scheduler_engine() -> SchedulerEngine:
    global _scheduler_engine
    if _scheduler_engine is None:
        _scheduler_engine = SchedulerEngine()
    return _scheduler_engine

def set_scheduler_engine(engine: SchedulerEngine):
    global _scheduler_engine
    _scheduler_engine = engine

class ScheduleTaskTool(BaseTool):
    """
    Schedules an autonomous desktop automation task using natural language timing or cron.
    """
    name = "schedule_task"
    description = (
        "Schedule an automated task or goal to run recurringly or after a delay. "
        "Supports natural language expressions (e.g. 'in 30 minutes', 'every 15m', 'every day at 9:00', 'every weekday at 8:30am') "
        "or standard 5-part cron syntax (e.g. '0 9 * * 1-5'). "
        "Automatically checks for meetings before running."
    )
    parameters = {
        "type": "object",
        "properties": {
            "goal": {
                "type": "string",
                "description": "The natural language instruction/goal to execute when triggered (e.g. 'Summarize downloads and clean temp files')."
            },
            "expression": {
                "type": "string",
                "description": "Timing expression (e.g. 'in 15m', 'every 30 minutes', 'every day at 9am', '0 9 * * 1-5')."
            },
            "label": {
                "type": "string",
                "description": "Optional short label/name for the schedule (e.g. 'Morning Briefing', 'Disk Cleanup')."
            },
            "defer_if_in_meeting": {
                "type": "boolean",
                "default": True,
                "description": "Whether to automatically defer execution if the user is in a Zoom/Teams meeting."
            }
        },
        "required": ["goal", "expression"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_scheduler_engine()
        goal = str(args.get("goal", "")).strip()
        expr = str(args.get("expression", "")).strip()
        label = args.get("label")
        defer = bool(args.get("defer_if_in_meeting", True))

        if not goal or not expr:
            return ToolResult(success=False, data=None, error="Both 'goal' and 'expression' are required.")

        res = engine.schedule(goal=goal, expression=expr, label=label, defer_if_busy=defer)
        return ToolResult(success=True, data=res)

class ListScheduledTasksTool(BaseTool):
    """
    Lists all active, paused, and completed scheduled tasks.
    """
    name = "list_scheduled_tasks"
    description = "List all persistent scheduled tasks, their recurrence expressions, status, and upcoming execution times."
    parameters = {
        "type": "object",
        "properties": {}
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_scheduler_engine()
        tasks = engine.list_schedules()
        return ToolResult(
            success=True,
            data={"scheduled_tasks": tasks, "count": len(tasks)}
        )

class CancelScheduledTaskTool(BaseTool):
    """
    Cancels a scheduled task by ID.
    """
    name = "cancel_scheduled_task"
    description = "Cancel and delete a scheduled task by its task_id."
    parameters = {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "The ID of the scheduled task to cancel (e.g. 'sched_a1b2c3d4')."
            }
        },
        "required": ["task_id"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_scheduler_engine()
        task_id = str(args.get("task_id", "")).strip()

        if not task_id:
            return ToolResult(success=False, data=None, error="No task_id specified.")

        success = engine.cancel(task_id)
        if success:
            return ToolResult(success=True, data={"task_id": task_id, "message": f"Cancelled scheduled task '{task_id}'"})
        else:
            return ToolResult(success=False, data=None, error=f"Scheduled task '{task_id}' not found or could not be cancelled.")

class PauseSchedulerTool(BaseTool):
    """
    Temporarily pauses the scheduler for focus time or meetings.
    """
    name = "pause_scheduler"
    description = "Temporarily suspend all scheduled tasks from firing (e.g. during meetings or focus mode)."
    parameters = {
        "type": "object",
        "properties": {
            "duration_minutes": {
                "type": "number",
                "default": 60.0,
                "description": "Duration in minutes to pause the scheduler (default: 60)."
            }
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_scheduler_engine()
        dur = float(args.get("duration_minutes", 60.0))
        engine.pause(duration_minutes=dur)
        return ToolResult(
            success=True,
            data={"paused_minutes": dur, "message": f"Scheduler paused for {dur} minutes."}
        )

class ResumeSchedulerTool(BaseTool):
    """
    Resumes scheduler execution.
    """
    name = "resume_scheduler"
    description = "Resume normal execution of scheduled tasks after being paused."
    parameters = {
        "type": "object",
        "properties": {}
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_scheduler_engine()
        engine.resume()
        return ToolResult(
            success=True,
            data={"status": "resumed", "message": "Scheduler resumed active polling."}
        )
