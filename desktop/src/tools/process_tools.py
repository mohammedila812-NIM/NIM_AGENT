from typing import Any, Dict, List, Optional, Union
from .base import BaseTool, ToolContext, ToolResult
from src.perception.process_monitor import ProcessMonitor
from src.security.guard import ActionRiskLevel
from src.security.redaction import SensitiveDataRedactor

# Shared singleton instance
_process_monitor: Optional[ProcessMonitor] = None

def get_process_monitor() -> ProcessMonitor:
    global _process_monitor
    if _process_monitor is None:
        _process_monitor = ProcessMonitor()
    return _process_monitor

class ListProcessesTool(BaseTool):
    """
    Lists running applications and background processes with RAM/CPU usage and anomaly notes.
    """
    name = "list_processes"
    description = (
        "List running processes and desktop applications sorted by RAM (MB), CPU%, or name. "
        "Flags memory anomalies based on learned per-app baselines."
    )
    parameters = {
        "type": "object",
        "properties": {
            "sort_by": {
                "type": "string",
                "enum": ["ram", "cpu", "name"],
                "default": "ram",
                "description": "Metric to sort by (default: 'ram')."
            },
            "filter_name": {
                "type": "string",
                "description": "Optional keyword or app name filter (e.g. 'chrome', 'python', 'code')."
            },
            "limit": {
                "type": "integer",
                "default": 15,
                "description": "Maximum number of processes to return (default: 15)."
            }
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        monitor = get_process_monitor()
        sort_by = str(args.get("sort_by", "ram"))
        filter_name = args.get("filter_name")
        limit = int(args.get("limit", 15))

        items = monitor.list_processes(sort_by=sort_by, filter_name=filter_name, limit=limit)
        data = [i.__dict__ for i in items]
        clean_data = SensitiveDataRedactor.redact_dict({"processes": data, "count": len(data)})
        return ToolResult(success=True, data=clean_data)

class GetProcessDetailsTool(BaseTool):
    """
    Deep diagnostic inspection of a running process (open files, network sockets, memory breakdown).
    """
    name = "get_process_details"
    description = (
        "Retrieve deep diagnostic metrics for a process: open file handles, active network connections/ports, "
        "memory breakdown (RSS/VMS), thread count, and historical baseline comparison."
    )
    parameters = {
        "type": "object",
        "properties": {
            "pid_or_name": {
                "type": "string",
                "description": "Process ID (PID integer) or executable name (e.g. '1234' or 'chrome.exe')."
            }
        },
        "required": ["pid_or_name"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        monitor = get_process_monitor()
        target = args.get("pid_or_name")
        if target is None or str(target).strip() == "":
            return ToolResult(success=False, data=None, error="Field 'pid_or_name' is required.")

        res = monitor.get_process_details(target)
        if not res.get("success"):
            return ToolResult(success=False, data=None, error=res.get("error", "Failed to get process details"))

        clean_res = SensitiveDataRedactor.redact_dict(res)
        return ToolResult(success=True, data=clean_res)

class KillProcessTool(BaseTool):
    """
    Terminates a process with pre-kill state checkpointing for instant undo/restart.
    """
    name = "kill_process"
    description = (
        "Safely terminate a hanging or unwanted process. "
        "Automatically checkpoints the process's command line and working directory so it can be restarted if needed."
    )
    parameters = {
        "type": "object",
        "properties": {
            "pid_or_name": {
                "type": "string",
                "description": "Process ID (PID) or executable name to terminate (e.g. 'notepad.exe' or '4532')."
            },
            "force": {
                "type": "boolean",
                "default": False,
                "description": "Whether to force-kill immediately (SIGKILL) instead of graceful termination."
            }
        },
        "required": ["pid_or_name"]
    }
    risk_level = ActionRiskLevel.DESTRUCTIVE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        monitor = get_process_monitor()
        target = args.get("pid_or_name")
        force = bool(args.get("force", False))

        if target is None or str(target).strip() == "":
            return ToolResult(success=False, data=None, error="Field 'pid_or_name' is required.")

        res = monitor.kill_process(target, force=force)
        if not res.get("success"):
            return ToolResult(success=False, data=res, error=res.get("error", "Failed to terminate process"))

        return ToolResult(success=True, data=res)

class RestartProcessTool(BaseTool):
    """
    Restarts a previously terminated or snapshotted process using its saved checkpoint.
    """
    name = "restart_process"
    description = "Restart an application or process that was previously closed or terminated, using its saved checkpoint."
    parameters = {
        "type": "object",
        "properties": {
            "checkpoint_id_or_name": {
                "type": "string",
                "description": "Process name or checkpoint ID (e.g. 'notepad.exe' or 'ckpt_1234_notepad')."
            }
        },
        "required": ["checkpoint_id_or_name"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        monitor = get_process_monitor()
        target = str(args.get("checkpoint_id_or_name", "")).strip()

        if not target:
            return ToolResult(success=False, data=None, error="Field 'checkpoint_id_or_name' is required.")

        res = monitor.restart_process(target)
        if not res.get("success"):
            return ToolResult(success=False, data=res, error=res.get("error", "Failed to restart process"))

        return ToolResult(success=True, data=res)

class MonitorProcessBaselineTool(BaseTool):
    """
    Queries learned resource baselines from episodic memory.
    """
    name = "monitor_process_baseline"
    description = "Query learned memory and CPU baselines for desktop applications."
    parameters = {
        "type": "object",
        "properties": {
            "process_name": {
                "type": "string",
                "description": "Optional process name to look up (e.g. 'chrome.exe', 'code.exe'). If omitted, returns all baselines."
            }
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        monitor = get_process_monitor()
        proc_name = args.get("process_name")

        if proc_name:
            base = monitor.memory_store.get_process_baseline(proc_name)
            return ToolResult(success=True, data={"baseline": base, "process_name": proc_name})
        else:
            all_bases = monitor.memory_store.list_process_baselines()
            return ToolResult(success=True, data={"baselines": all_bases, "count": len(all_bases)})
