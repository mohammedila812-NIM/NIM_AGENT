"""
subagent_tools.py
-----------------
Tool interface for NIM JARVIS Desktop subagent system.

Exposes SubAgentRunner and Blackboard to the main agent loop as callable tools:
  - spawn_subagent          → run a single specialized subagent
  - run_parallel_subagents  → run multiple subagents in parallel
  - get_subagent_blackboard → inspect current blackboard state
  - clear_blackboard        → reset the blackboard for a new task
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from src.security.guard import ActionRiskLevel
from src.tools.base import BaseTool, ToolContext, ToolResult
from src.agents.blackboard import new_blackboard, get_blackboard, Finding
from src.agents.subagent_runner import SubAgentRunner, SubAgentTask, ParallelRunnerOptions

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tool: Spawn Single Subagent
# ---------------------------------------------------------------------------

class SpawnSubagentTool(BaseTool):
    name = "spawn_subagent"
    description = (
        "Spawn a specialized subagent to handle a focused sub-task. "
        "The subagent runs its own mini agentic loop with a domain-locked tool allowlist. "
        "Agent types: 'system' (file/shell ops), 'research' (web/browser), "
        "'perception' (screen/UI), 'document' (docs/spreadsheets), 'actuation' (mouse/keyboard)."
    )
    parameters = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Short descriptive name for this sub-task (e.g. 'find-config-files').",
            },
            "instruction": {
                "type": "string",
                "description": "Clear, focused instruction for the subagent to execute.",
            },
            "agent_type": {
                "type": "string",
                "enum": ["system", "research", "perception", "document", "actuation", "coordinator"],
                "description": "Type of specialist agent to spawn.",
                "default": "system",
            },
            "token_budget": {
                "type": "integer",
                "description": "Max tokens this subagent may use. Default: 20000.",
                "default": 20000,
            },
            "timeout_seconds": {
                "type": "number",
                "description": "Max wall-clock time in seconds. Default: 120.",
                "default": 120,
            },
        },
        "required": ["name", "instruction"],
    }
    risk_level = ActionRiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            task = SubAgentTask(
                name=str(args["name"]),
                instruction=str(args["instruction"]),
                agent_type=str(args.get("agent_type", "system")),
                token_budget=int(args.get("token_budget", 20_000)),
                timeout_seconds=float(args.get("timeout_seconds", 120.0)),
            )

            # Get tool registry and LLM client from context metadata
            tool_registry = context.metadata.get("tool_registry")
            llm_client = context.metadata.get("llm_client")

            if not tool_registry or not llm_client:
                return ToolResult(
                    success=False, data=None,
                    error="Tool registry or LLM client not available in context."
                )

            bb = get_blackboard()
            runner = SubAgentRunner(
                blackboard=bb,
                tool_registry=tool_registry,
                llm_client=llm_client,
            )

            result = await runner.run_single(task)
            return ToolResult(success=result.success, data={
                "task": result.task_name,
                "agent_type": result.agent_type,
                "success": result.success,
                "findings_count": len(result.findings),
                "findings": [f.to_dict() for f in result.findings],
                "error": result.error,
                "duration_seconds": round(result.duration_seconds, 2),
                "tokens_used": result.tokens_used,
            }, error=result.error)

        except Exception as exc:
            logger.error("SpawnSubagentTool error: %s", exc, exc_info=True)
            return ToolResult(success=False, data=None, error=str(exc))


# ---------------------------------------------------------------------------
# Tool: Run Parallel Subagents
# ---------------------------------------------------------------------------

class RunParallelSubagentsTool(BaseTool):
    name = "run_parallel_subagents"
    description = (
        "Run multiple specialized subagents in parallel to solve a complex task faster. "
        "Each subagent handles one focused sub-task with its own domain-locked tools. "
        "Results are merged into a combined findings summary."
    )
    parameters = {
        "type": "object",
        "properties": {
            "tasks": {
                "type": "array",
                "description": "List of sub-tasks to run in parallel.",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Task name."},
                        "instruction": {"type": "string", "description": "Task instruction."},
                        "agent_type": {
                            "type": "string",
                            "enum": ["system", "research", "perception", "document", "actuation"],
                            "default": "system",
                        },
                        "token_budget": {"type": "integer", "default": 15000},
                        "timeout_seconds": {"type": "number", "default": 90},
                    },
                    "required": ["name", "instruction"],
                },
            },
            "max_concurrent": {
                "type": "integer",
                "description": "Max subagents running simultaneously. Default: 4.",
                "default": 4,
            },
            "fail_fast": {
                "type": "boolean",
                "description": "Stop all agents if one fails. Default: false.",
                "default": False,
            },
        },
        "required": ["tasks"],
    }
    risk_level = ActionRiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            tasks_raw = args.get("tasks", [])
            if not tasks_raw:
                return ToolResult(success=False, data=None, error="No tasks provided.")

            tasks = [
                SubAgentTask(
                    name=str(t["name"]),
                    instruction=str(t["instruction"]),
                    agent_type=str(t.get("agent_type", "system")),
                    token_budget=int(t.get("token_budget", 15_000)),
                    timeout_seconds=float(t.get("timeout_seconds", 90.0)),
                )
                for t in tasks_raw
            ]

            tool_registry = context.metadata.get("tool_registry")
            llm_client = context.metadata.get("llm_client")

            if not tool_registry or not llm_client:
                return ToolResult(
                    success=False, data=None,
                    error="Tool registry or LLM client not available in context."
                )

            bb = get_blackboard()
            runner = SubAgentRunner(
                blackboard=bb,
                tool_registry=tool_registry,
                llm_client=llm_client,
            )

            opts = ParallelRunnerOptions(
                max_concurrent=int(args.get("max_concurrent", 4)),
                fail_fast=bool(args.get("fail_fast", False)),
            )

            results = await runner.run_parallel(tasks, options=opts)
            summary = runner.synthesize_findings(results)

            return ToolResult(success=True, data=summary)

        except Exception as exc:
            logger.error("RunParallelSubagentsTool error: %s", exc, exc_info=True)
            return ToolResult(success=False, data=None, error=str(exc))


# ---------------------------------------------------------------------------
# Tool: Get Subagent Blackboard
# ---------------------------------------------------------------------------

class GetSubagentBlackboardTool(BaseTool):
    name = "get_subagent_blackboard"
    description = (
        "Get the current state of the subagent blackboard — all findings, goal, "
        "completion status, and token budget. Use to inspect what subagents have found."
    )
    parameters = {
        "type": "object",
        "properties": {
            "topic_filter": {
                "type": "string",
                "description": "If provided, only return findings with this topic.",
            },
        },
        "required": [],
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            bb = get_blackboard()
            topic = args.get("topic_filter")
            if topic:
                findings = [f.to_dict() for f in bb.get_findings(topic=topic)]
                data = {
                    "goal": bb.goal,
                    "topic_filter": topic,
                    "finding_count": len(findings),
                    "findings": findings,
                }
            else:
                data = bb.to_dict()
            return ToolResult(success=True, data=data)
        except Exception as exc:
            return ToolResult(success=False, data=None, error=str(exc))


# ---------------------------------------------------------------------------
# Tool: Clear Blackboard
# ---------------------------------------------------------------------------

class ClearBlackboardTool(BaseTool):
    name = "clear_blackboard"
    description = (
        "Reset the subagent blackboard — clear all findings, reset token budget. "
        "Call this before starting a new multi-agent task."
    )
    parameters = {
        "type": "object",
        "properties": {
            "new_goal": {
                "type": "string",
                "description": "Optional new goal description for the next task.",
                "default": "",
            },
            "max_tokens": {
                "type": "integer",
                "description": "Token budget for the new task. Default: 200000.",
                "default": 200000,
            },
        },
        "required": [],
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            goal = str(args.get("new_goal", ""))
            max_tokens = int(args.get("max_tokens", 200_000))
            bb = new_blackboard(goal=goal, max_tokens=max_tokens)
            return ToolResult(success=True, data={
                "status": "blackboard_cleared",
                "new_goal": goal,
                "max_tokens": max_tokens,
            })
        except Exception as exc:
            return ToolResult(success=False, data=None, error=str(exc))


# ---------------------------------------------------------------------------
# Registry helper
# ---------------------------------------------------------------------------

def register_subagent_tools(registry) -> None:
    """Register all subagent tools into the given UnifiedToolRegistry."""
    tools = [
        SpawnSubagentTool(),
        RunParallelSubagentsTool(),
        GetSubagentBlackboardTool(),
        ClearBlackboardTool(),
    ]
    for tool in tools:
        registry.register(tool)
    logger.info("Registered %d subagent tools.", len(tools))
