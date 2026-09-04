import asyncio
import logging
import os
import platform
import subprocess
from typing import Any, Dict, Optional
import psutil
from .base import BaseTool, ToolContext, ToolResult
from src.security.guard import ActionRiskLevel, SecurityGuard

logger = logging.getLogger(__name__)

class RunCommandTool(BaseTool):
    name = "run_command"
    description = "Execute a shell command (PowerShell on Windows, bash on Unix) with output capture and safety limits."
    parameters = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "The exact shell command to execute."},
            "cwd": {"type": "string", "description": "Working directory for the command (default: current directory).", "default": "."},
            "timeout_seconds": {"type": "integer", "description": "Command timeout in seconds (default: 30).", "default": 30}
        },
        "required": ["command"]
    }
    risk_level = ActionRiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        command = str(args.get("command", "")).strip()
        cwd = str(args.get("cwd", ".")).strip()
        timeout = int(args.get("timeout_seconds", 30))

        if not command:
            return ToolResult(success=False, data=None, error="No command provided.")

        risk, reason = SecurityGuard.evaluate_shell_command(command)
        if risk == ActionRiskLevel.CRITICAL:
            return ToolResult(success=False, data=None, error=f"Command blocked by Security Guard: {reason}", risk_level=risk)

        try:
            # Prevent nested powershell -Command wrapping issues
            clean_cmd = command
            if clean_cmd.startswith("powershell ") or clean_cmd.startswith("powershell.exe "):
                parts = clean_cmd.split("-Command", 1)
                if len(parts) == 2:
                    clean_cmd = parts[1].strip().strip('"').strip("'")

            # For multi-line scripts or complex syntax, execute via a temporary script
            if os.name == "nt" and ("\n" in clean_cmd or "@'" in clean_cmd or "`" in clean_cmd):
                import tempfile
                with tempfile.NamedTemporaryFile(suffix=".ps1", delete=False, mode="w", encoding="utf-8") as tf:
                    tf.write(clean_cmd)
                    temp_script_path = tf.name

                shell_cmd = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", temp_script_path]
            elif os.name == "nt":
                shell_cmd = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", clean_cmd]
            else:
                shell_cmd = ["bash", "-c", clean_cmd]

            process = await asyncio.create_subprocess_exec(
                *shell_cmd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=os.path.abspath(cwd)
            )

            try:
                stdout_data, stderr_data = await asyncio.wait_for(process.communicate(), timeout=timeout)
                stdout = stdout_data.decode("utf-8", errors="replace").strip()
                stderr = stderr_data.decode("utf-8", errors="replace").strip()
                exit_code = process.returncode

                # Truncate extremely long outputs
                if len(stdout) > 10000:
                    stdout = stdout[:10000] + "\n...[output truncated]..."

                return ToolResult(
                    success=(exit_code == 0),
                    data={
                        "exit_code": exit_code,
                        "stdout": stdout,
                        "stderr": stderr
                    },
                    error=stderr if exit_code != 0 and not stdout else None,
                    risk_level=risk
                )

            except asyncio.TimeoutError:
                try:
                    if platform.system() == "Windows":
                        subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)], capture_output=True)
                    else:
                        parent = psutil.Process(process.pid)
                        for child in parent.children(recursive=True):
                            child.kill()
                        parent.kill()
                except Exception:
                    process.kill()

                return ToolResult(
                    success=False,
                    data=None,
                    error=f"Command timed out after {timeout} seconds.",
                    risk_level=risk
                )
            finally:
                if 'temp_script_path' in locals() and os.path.exists(temp_script_path):
                    try:
                        os.remove(temp_script_path)
                    except Exception:
                        pass

        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to execute command: {str(e)}")
