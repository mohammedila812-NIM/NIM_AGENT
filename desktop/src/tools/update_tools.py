"""
System Update Tools for NIM_AGENT.
Allows the agent to check for updates and upgrade software from GitHub.
"""

from typing import Any, Dict
from src.security.guard import ActionRiskLevel
from src.tools.base import BaseTool, ToolContext, ToolResult
from src.updater.github_updater import get_github_updater


class CheckForUpdatesTool(BaseTool):
    name = "check_for_updates"
    description = "Checks GitHub for newer versions of NIM_AGENT software."
    parameters = {
        "type": "object",
        "properties": {},
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        updater = get_github_updater()
        info = await updater.check_for_updates()

        return ToolResult(
            success=True,
            data={
                "software_update": info.to_dict(),
            }
        )


class ApplyProjectUpdateTool(BaseTool):
    name = "apply_project_update"
    description = "Applies a project update from GitHub (Git pull or release bundle)."
    parameters = {
        "type": "object",
        "properties": {
            "mode": {
                "type": "string",
                "enum": ["auto", "git", "bundle"],
                "description": "Update mode. Defaults to auto."
            }
        }
    }
    risk_level = ActionRiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        updater = get_github_updater()
        mode = args.get("mode", "auto")

        if (mode == "git" or mode == "auto") and updater.is_git_clone():
            success, msg = updater.apply_git_update()
            return ToolResult(success=success, data={"mode": "git", "message": msg})
        else:
            info = await updater.check_for_updates()
            if not info.download_url:
                return ToolResult(success=False, error="No release download URL found.")
            success, msg = await updater.apply_bundle_update(info.download_url)
            return ToolResult(success=success, data={"mode": "bundle", "message": msg})

