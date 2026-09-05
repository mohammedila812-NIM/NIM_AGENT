"""
memory_tools.py
---------------
Unified ReAct Tools for Autonomous Session Memory & User Personalization.
Allows the agent to dynamically inspect past session context, lookup
auto-highlighted memories, and store user habits and preferences.
"""

from typing import Any, Dict, List, Optional
from src.agent.session_memory import get_session_memory
from src.agent.memory import get_memory_store
from src.security.guard import ActionRiskLevel
from .base import BaseTool, ToolContext, ToolResult


class RecallSessionMemoryTool(BaseTool):
    """Dynamically searches past session history and auto-highlighted key memories."""

    @property
    def name(self) -> str:
        return "recall_session_memory"

    @property
    def description(self) -> str:
        return (
            "Searches or retrieves past session context, recent task outcomes, touched files, "
            "and auto-highlighted important facts. Use this whenever you need to recall earlier "
            "details, previous decisions, or missing variables."
        )

    @property
    def parameters_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Optional search term or keyword to look for in past turns, files, or facts."
                },
                "last_n": {
                    "type": "integer",
                    "description": "Number of recent turns to inspect (default: 3).",
                    "default": 3
                },
                "get_summary": {
                    "type": "boolean",
                    "description": "If true, returns a full formatted summary of the active session with key highlights.",
                    "default": False
                }
            }
        }

    @property
    def risk_level(self) -> ActionRiskLevel:
        return ActionRiskLevel.SAFE

    async def execute(self, arguments: dict, context: ToolContext) -> ToolResult:
        session_mgr = get_session_memory()
        query = arguments.get("query", "").strip()
        last_n = arguments.get("last_n", 3)
        get_summary = arguments.get("get_summary", False)

        try:
            if get_summary:
                summary = session_mgr.get_session_summary(highlight_important=True)
                return ToolResult(
                    success=True,
                    data={"summary": summary, "message": "Retrieved session summary & key highlights."}
                )

            if query:
                results = session_mgr.search_memory(query, limit=last_n)
                if results:
                    return ToolResult(
                        success=True,
                        data={"query": query, "results": results, "count": len(results)}
                    )
                else:
                    return ToolResult(
                        success=True,
                        data={"query": query, "results": [], "message": f"No records found matching '{query}'."}
                    )

            # Default: return last N turns and active highlights
            recent_turns = [
                {
                    "turn_id": t.turn_id,
                    "goal": t.goal,
                    "outcome": t.final_answer[:160] if t.final_answer else "Completed",
                    "files": t.files_touched,
                    "entities": t.key_entities,
                }
                for t in session_mgr._turns[-last_n:]
            ]
            highlights = [
                {"category": h.category, "key": h.key, "value": h.value}
                for h in session_mgr._highlights[:6]
            ]
            return ToolResult(
                success=True,
                data={"recent_turns": recent_turns, "highlights": highlights}
            )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Memory recall error: {e}")


class SaveUserPreferenceTool(BaseTool):
    """Saves user habits, preferred settings, or explicit instructions into persistent memory."""

    @property
    def name(self) -> str:
        return "save_user_preference"

    @property
    def description(self) -> str:
        return "Saves a persistent user preference, habit, or configuration setting for future sessions."

    @property
    def parameters_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Preference key name (e.g. 'preferred_editor', 'output_format')."},
                "value": {"type": "string", "description": "Preference value or description."},
                "category": {"type": "string", "description": "Category (e.g. 'workflow', 'format', 'tools', 'schedule').", "default": "general"}
            },
            "required": ["key", "value"]
        }

    @property
    def risk_level(self) -> ActionRiskLevel:
        return ActionRiskLevel.SAFE

    async def execute(self, arguments: dict, context: ToolContext) -> ToolResult:
        key = arguments.get("key", "").strip()
        value = arguments.get("value", "").strip()
        category = arguments.get("category", "general").strip()

        if not key or not value:
            return ToolResult(success=False, data=None, error="Key and value are required.")

        try:
            mem_store = get_memory_store()
            mem_store.set_preference(key, value, category=category)
            return ToolResult(
                success=True,
                data={"key": key, "value": value, "category": category}
            )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to save preference: {e}")


class GetPersonalizationProfileTool(BaseTool):
    """Retrieves all stored user preferences and personalization profile."""

    @property
    def name(self) -> str:
        return "get_personalization_profile"

    @property
    def description(self) -> str:
        return "Retrieves the user's saved personalization profile, learned habits, and preferences."

    @property
    def parameters_schema(self) -> dict:
        return {"type": "object", "properties": {}}

    @property
    def risk_level(self) -> ActionRiskLevel:
        return ActionRiskLevel.SAFE

    async def execute(self, arguments: dict, context: ToolContext) -> ToolResult:
        try:
            from src.personalization.engine import get_personalization_engine
            engine = get_personalization_engine()
            profile = engine.get_profile_summary()
            return ToolResult(
                success=True,
                data=profile
            )
        except Exception as e:
            return ToolResult(success=False, data=None, error=f"Failed to retrieve profile: {e}")


def get_memory_tools() -> List[BaseTool]:
    """Returns the suite of memory and personalization tools."""
    return [
        RecallSessionMemoryTool(),
        SaveUserPreferenceTool(),
        GetPersonalizationProfileTool(),
    ]
