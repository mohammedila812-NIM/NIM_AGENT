import os
import platform
import psutil
from typing import Any, Dict, Optional
from .base import BaseTool, ToolContext, ToolResult
from src.security.guard import ActionRiskLevel

class GetClipboardTool(BaseTool):
    name = "get_clipboard"
    description = "Read the current text content from the system clipboard."
    parameters = {"type": "object", "properties": {}}
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            import pyautogui
            # Using tkinter or pyperclip / ctypes fallback
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            clipboard_text = root.clipboard_get()
            root.destroy()
            return ToolResult(success=True, data={"clipboard_text": clipboard_text})
        except Exception as e:
            return ToolResult(success=True, data={"clipboard_text": "", "note": "Clipboard empty or not accessible."})

class SetClipboardTool(BaseTool):
    name = "set_clipboard"
    description = "Copy text onto the system clipboard."
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Text to set on clipboard."}
        },
        "required": ["text"]
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        text = str(args.get("text", ""))
        try:
            import tkinter as tk
            root = tk.Tk()
            root.withdraw()
            root.clipboard_clear()
            root.clipboard_append(text)
            root.update()
            root.destroy()
            return ToolResult(success=True, data={"status": "Copied to clipboard", "length": len(text)})
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to set clipboard: {str(e)}")

class NotifyUserTool(BaseTool):
    name = "notify_user"
    description = "Display a native desktop toast notification to the user."
    parameters = {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Notification title."},
            "message": {"type": "string", "description": "Notification message."}
        },
        "required": ["title", "message"]
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        title = str(args.get("title", "NIM JARVIS"))
        message = str(args.get("message", ""))
        try:
            if platform.system() == "Windows":
                # Safely escape single quotes for PowerShell literal string encapsulation
                escaped_title = title.replace("'", "''").replace("`", "``").replace("$", "`$")
                escaped_msg = message.replace("'", "''").replace("`", "``").replace("$", "`$")
                import subprocess
                ps_script = f"""
                [reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null
                $notify = new-object system.windows.forms.notifyicon
                $notify.icon = [system.drawing.systemicons]::Information
                $notify.visible = $true
                $notify.showballoontip(5000, '{escaped_title}', '{escaped_msg}', [system.windows.forms.tooltipicon]::Info)
                """
                subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script], creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0)

            return ToolResult(success=True, data={"notified": True, "title": title, "message": message})
        except Exception as e:
            return ToolResult(success=True, data={"notified": False, "error": str(e)})

class GetSystemInfoTool(BaseTool):
    name = "get_system_info"
    description = "Retrieve system hardware and OS status (CPU load, RAM usage, disk space)."
    parameters = {"type": "object", "properties": {}}
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage(os.path.abspath("."))
            return ToolResult(
                success=True,
                data={
                    "os": f"{platform.system()} {platform.release()} ({platform.machine()})",
                    "cpu_percent": psutil.cpu_percent(interval=0.1),
                    "cpu_cores": psutil.cpu_count(logical=True),
                    "ram_total_gb": round(mem.total / (1024**3), 2),
                    "ram_available_gb": round(mem.available / (1024**3), 2),
                    "ram_used_percent": mem.percent,
                    "disk_total_gb": round(disk.total / (1024**3), 2),
                    "disk_free_gb": round(disk.free / (1024**3), 2),
                    "disk_used_percent": disk.percent
                }
            )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to get system info: {str(e)}")
