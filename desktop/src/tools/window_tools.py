from typing import Any, Dict, List, Optional, Union
from .base import BaseTool, ToolContext, ToolResult
from src.perception.window_manager import WindowManager
from src.security.guard import ActionRiskLevel
from src.security.redaction import SensitiveDataRedactor

# Shared singleton instance
_window_manager: Optional[WindowManager] = None

def get_window_manager() -> WindowManager:
    global _window_manager
    if _window_manager is None:
        _window_manager = WindowManager()
    return _window_manager

class OpenApplicationTool(BaseTool):
    """
    Launches a Windows desktop application by friendly alias (e.g. 'chrome', 'notepad', 'vscode', 'excel', 'calc')
    or executable path, and detects its window upon opening.
    """
    name = "open_application"
    description = (
        "Launch a Windows desktop application by name or path (e.g. 'notepad', 'chrome', 'vscode', 'excel', 'word', 'calc', 'terminal', 'explorer'). "
        "Automatically resolves friendly app aliases and detects when the application window is ready."
    )
    parameters = {
        "type": "object",
        "properties": {
            "app_name": {
                "type": "string",
                "description": "Name, alias, or path of the application to launch (e.g. 'notepad', 'calc', 'chrome', 'vscode', 'excel')."
            },
            "arguments": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional list of command-line arguments to pass to the application."
            },
            "wait_seconds": {
                "type": "number",
                "default": 1.5,
                "description": "Seconds to wait for the window to appear (default: 1.5s)."
            }
        },
        "required": ["app_name"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_window_manager()
        app_name = str(args.get("app_name", "")).strip()
        cmd_args = args.get("arguments")
        wait = float(args.get("wait_seconds", 1.5))

        if not app_name:
            return ToolResult(success=False, data=None, error="No app_name specified.")

        res = await mgr.open_application(app_name, args=cmd_args, wait_seconds=wait)
        if not res.get("success"):
            return ToolResult(success=False, data=res, error=res.get("error", "Failed to launch application"))

        return ToolResult(success=True, data=res)

class FocusWindowTool(BaseTool):
    """
    Brings a window to the foreground by title or process name.
    """
    name = "focus_window"
    description = "Bring an open window to the foreground and focus it by title regex or application name."
    parameters = {
        "type": "object",
        "properties": {
            "window_pattern": {
                "type": "string",
                "description": "Title, keyword, or process name of the window to focus (e.g. 'Notepad', 'Visual Studio Code', 'Chrome')."
            }
        },
        "required": ["window_pattern"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_window_manager()
        pattern = str(args.get("window_pattern", "")).strip()
        if not pattern:
            return ToolResult(success=False, data=None, error="No window_pattern specified.")

        res = mgr.focus_window(pattern)
        if not res.get("success"):
            return ToolResult(success=False, data=None, error=res.get("error", "Failed to focus window"))

        return ToolResult(success=True, data=res)

class CloseWindowTool(BaseTool):
    """
    Closes a window gracefully or force terminates its process.
    """
    name = "close_window"
    description = "Gracefully close a window (sends WM_CLOSE) or force terminate its process."
    parameters = {
        "type": "object",
        "properties": {
            "window_pattern": {
                "type": "string",
                "description": "Title, keyword, or process name of the window to close."
            },
            "force": {
                "type": "boolean",
                "default": False,
                "description": "Whether to force-kill the underlying process immediately."
            }
        },
        "required": ["window_pattern"]
    }
    risk_level = ActionRiskLevel.DESTRUCTIVE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_window_manager()
        pattern = str(args.get("window_pattern", "")).strip()
        force = bool(args.get("force", False))

        if not pattern:
            return ToolResult(success=False, data=None, error="No window_pattern specified.")

        res = mgr.close_window(pattern, force=force)
        if not res.get("success"):
            return ToolResult(success=False, data=None, error=res.get("error", "Failed to close window"))

        return ToolResult(success=True, data=res)

class ResizeWindowTool(BaseTool):
    """
    Resizes and moves a window to exact pixel coordinates.
    """
    name = "resize_window"
    description = "Resize and reposition an open window to specified pixel dimensions and screen coordinates."
    parameters = {
        "type": "object",
        "properties": {
            "window_pattern": {"type": "string", "description": "Title or process name of the window to resize."},
            "width": {"type": "integer", "description": "Target window width in pixels."},
            "height": {"type": "integer", "description": "Target window height in pixels."},
            "left": {"type": "integer", "description": "Optional target X position (pixels from left of screen)."},
            "top": {"type": "integer", "description": "Optional target Y position (pixels from top of screen)."}
        },
        "required": ["window_pattern", "width", "height"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_window_manager()
        pattern = str(args.get("window_pattern", "")).strip()
        w = int(args.get("width", 800))
        h = int(args.get("height", 600))
        left = args.get("left")
        top = args.get("top")

        res = mgr.set_window_geometry(
            pattern=pattern,
            width=w,
            height=h,
            left=int(left) if left is not None else None,
            top=int(top) if top is not None else None
        )
        if not res.get("success"):
            return ToolResult(success=False, data=None, error=res.get("error", "Failed to resize window"))

        return ToolResult(success=True, data=res)

class SetWindowStateTool(BaseTool):
    """
    Sets window state: minimize, maximize, restore, or hide.
    """
    name = "set_window_state"
    description = "Change window state: 'minimize', 'maximize', 'restore', or 'hide'."
    parameters = {
        "type": "object",
        "properties": {
            "window_pattern": {"type": "string", "description": "Title or process name of the window."},
            "state": {"type": "string", "enum": ["minimize", "maximize", "restore", "hide", "show"], "description": "Target window state."}
        },
        "required": ["window_pattern", "state"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_window_manager()
        pattern = str(args.get("window_pattern", "")).strip()
        st = str(args.get("state", "restore")).strip()

        res = mgr.set_window_state(pattern, st)
        if not res.get("success"):
            return ToolResult(success=False, data=None, error=res.get("error", "Failed to set window state"))

        return ToolResult(success=True, data=res)

class ListOpenWindowsTool(BaseTool):
    """
    Lists all visible windows currently open on the desktop.
    """
    name = "list_open_windows"
    description = "List all visible top-level windows on the desktop with process names, PIDs, bounds, and monitor IDs."
    parameters = {
        "type": "object",
        "properties": {
            "include_invisible": {"type": "boolean", "default": False, "description": "Include hidden/background tool windows."}
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_window_manager()
        include_invis = bool(args.get("include_invisible", False))
        wins = mgr.list_windows(include_invisible=include_invis)
        
        data = [w.__dict__ for w in wins]
        clean_data = SensitiveDataRedactor.redact_dict({"windows": data, "count": len(data)})
        return ToolResult(success=True, data=clean_data)

class SaveWorkspaceTool(BaseTool):
    """
    Snapshots the current multi-window desktop layout into SQLite episodic memory.
    """
    name = "save_workspace"
    description = "Snapshot the spatial arrangement and bounds of all open windows into episodic memory under a friendly name (e.g. 'dev', 'research', 'writing')."
    parameters = {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Name for the workspace layout (e.g. 'dev_mode', 'finance_layout')."},
            "description": {"type": "string", "description": "Optional description of what this workspace is used for."}
        },
        "required": ["name"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_window_manager()
        name = str(args.get("name", "")).strip()
        desc = str(args.get("description", "")).strip()

        if not name:
            return ToolResult(success=False, data=None, error="No workspace name provided.")

        res = mgr.save_workspace_layout(name, description=desc)
        return ToolResult(success=True, data=res)

class RestoreWorkspaceTool(BaseTool):
    """
    Restores a saved multi-window desktop layout from memory: launches missing apps and repositions all windows.
    """
    name = "restore_workspace"
    description = "Restore a saved workspace layout by name: opens any missing applications and moves all windows back to their saved coordinates."
    parameters = {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Name of the workspace layout to restore (e.g. 'dev_mode', 'finance_layout')."}
        },
        "required": ["name"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_window_manager()
        name = str(args.get("name", "")).strip()

        if not name:
            return ToolResult(success=False, data=None, error="No workspace name provided.")

        res = await mgr.restore_workspace_layout(name)
        if not res.get("success"):
            return ToolResult(success=False, data=None, error=res.get("error", "Failed to restore workspace"))

        return ToolResult(success=True, data=res)

class MoveWindowToMonitorTool(BaseTool):
    """
    Moves an open window to a specific display monitor.
    """
    name = "move_window_to_monitor"
    description = "Move a window to a specific monitor display (1 = primary monitor, 2 = secondary monitor)."
    parameters = {
        "type": "object",
        "properties": {
            "window_pattern": {"type": "string", "description": "Title or process name of the window."},
            "monitor_index": {"type": "integer", "default": 1, "description": "Target monitor index (1 = primary, 2 = secondary)."}
        },
        "required": ["window_pattern"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_window_manager()
        pattern = str(args.get("window_pattern", "")).strip()
        mon_idx = int(args.get("monitor_index", 1))

        res = mgr.move_to_monitor(pattern, monitor_index=mon_idx)
        if not res.get("success"):
            return ToolResult(success=False, data=None, error=res.get("error", "Failed to move window to monitor"))

        return ToolResult(success=True, data=res)
