from typing import Any, Dict
from .base import BaseTool, ToolContext, ToolResult
from src.security.guard import ActionRiskLevel
from src.security.snapshot import get_snapshot_manager

class UndoLastActionTool(BaseTool):
    name = "undo_last_action"
    description = "Revert the most recent destructive file action (file deletion, overwrite, move, or creation)."
    parameters = {"type": "object", "properties": {}}
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        mgr = get_snapshot_manager()
        res = mgr.undo_last_action()
        return ToolResult(
            success=bool(res.get("success", False)),
            data=res,
            error=None if res.get("success") else str(res.get("message"))
        )

class ListUndoHistoryTool(BaseTool):
    name = "list_undo_history"
    description = "List all recent reversible file actions and their snapshot IDs."
    parameters = {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "Number of history items to return (default: 15).", "default": 15}
        }
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        limit = int(args.get("limit", 15))
        mgr = get_snapshot_manager()
        snapshots = mgr.list_snapshots(limit=limit)
        return ToolResult(success=True, data={"snapshots": snapshots, "count": len(snapshots)})

class RestoreSnapshotTool(BaseTool):
    name = "restore_snapshot"
    description = "Restore a specific historical snapshot by its snapshot_id."
    parameters = {
        "type": "object",
        "properties": {
            "snapshot_id": {"type": "string", "description": "The snapshot ID to restore (e.g. 'snap_1720000000_abcd1234')."}
        },
        "required": ["snapshot_id"]
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        snapshot_id = str(args.get("snapshot_id", "")).strip()
        mgr = get_snapshot_manager()
        res = mgr.restore_snapshot(snapshot_id)
        return ToolResult(
            success=bool(res.get("success", False)),
            data=res,
            error=None if res.get("success") else str(res.get("message"))
        )
