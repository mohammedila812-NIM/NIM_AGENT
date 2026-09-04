"""
subagent_runner.py
------------------
NIM JARVIS Desktop Subagent Runner.

Mirrors the NIM_Web subagent architecture (subagent-runner.ts) but for
local desktop automation. Each subagent is a specialized async worker that:
  1. Receives a focused sub-task and a domain-locked tool allowlist
  2. Runs a mini agentic loop (LLM + tools)
  3. Publishes findings to the shared Blackboard
  4. Stops when budget is exhausted or goal is satisfied

Agent Types:
  - "research"    → web_search, read_url, browser_research (read-only)
  - "perception"  → capture_screen, ocr, get_active_window, locate_ui_element
  - "system"      → run_command, file ops, process management
  - "document"    → generate_document, read_file, write_file
  - "coordinator" → no tools; synthesizes findings from blackboard

Usage::

    runner = SubAgentRunner(blackboard=bb, llm_client=client)
    await runner.run_parallel([
        SubAgentTask(name="find-py-files", agent_type="system",
                     instruction="List all .py files in the project"),
        SubAgentTask(name="check-imports", agent_type="system",
                     instruction="Check for missing imports in main.py"),
    ])
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from src.agents.blackboard import Blackboard, Finding, get_blackboard
from src.agents.specialists import SPECIALIST_PROFILES, SpecialistProfile

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tool Allowlists per agent type (domain-locked)
# ---------------------------------------------------------------------------

AGENT_TOOL_ALLOWLISTS: Dict[str, List[str]] = {
    "research": [
        "web_search",
        "read_url",
        "browser_research",
        "capture_screen_region",
        "ocr_screen_text",
    ],
    "perception": [
        "get_active_window_info",
        "capture_screen_region",
        "ocr_screen_text",
        "locate_ui_element_visual",
        "list_monitors",
        "calibrate_screen_coordinates",
        "grounded_mouse_click",
        "save_coord_anchor",
        "get_coord_anchor",
        "verify_action_result",
    ],
    "system": [
        "run_command",
        "get_system_info",
        "list_directory",
        "search_files",
        "read_file",
        "write_file",
        "set_clipboard",
        "get_clipboard",
        "get_processes",
        "kill_process",
        "undo_last_action",
    ],
    "document": [
        "generate_document",
        "read_file",
        "write_file",
        "convert_file",
        "analyze_spreadsheet",
        "list_directory",
    ],
    "coordinator": [],  # Coordinator synthesizes from blackboard, no direct tools
    "actuation": [
        "mouse_click",
        "grounded_mouse_click",
        "locate_ui_element_visual",
        "keyboard_type",
        "keyboard_shortcut",
        "scroll",
        "drag_and_drop",
        "capture_screen_region",
        "verify_action_result",
        "get_active_window_info",
    ],
}


# ---------------------------------------------------------------------------
# SubAgentTask
# ---------------------------------------------------------------------------

@dataclass
class SubAgentTask:
    """Defines a unit of work for a single subagent."""
    name: str                         # human-readable task name
    instruction: str                  # the focused sub-task prompt
    agent_type: str = "system"        # one of AGENT_TOOL_ALLOWLISTS keys
    token_budget: int = 20_000        # max tokens this worker may consume
    timeout_seconds: float = 120.0    # max wall-clock time
    metadata: Dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])


@dataclass
class SubAgentResult:
    """Result from a single subagent run."""
    task_id: str
    task_name: str
    agent_type: str
    success: bool
    findings: List[Finding]
    error: Optional[str] = None
    tokens_used: int = 0
    duration_seconds: float = 0.0


# ---------------------------------------------------------------------------
# SubAgent worker
# ---------------------------------------------------------------------------

class SubAgent:
    """
    A single specialized worker agent.
    Runs a minimal agentic loop: LLM call → tool execution → publish finding.
    """

    def __init__(
        self,
        task: SubAgentTask,
        blackboard: Blackboard,
        tool_registry,
        llm_client,
        on_finding: Optional[Callable[[Finding], None]] = None,
    ):
        self.task = task
        self.blackboard = blackboard
        self.tool_registry = tool_registry
        self.llm_client = llm_client
        self.on_finding = on_finding
        self.agent_id = f"{task.agent_type}-{task.id}"
        self._allowlist = AGENT_TOOL_ALLOWLISTS.get(task.agent_type, [])

    def _get_allowed_tools(self) -> List[Any]:
        """Return only the tools in this agent's allowlist."""
        all_tools = self.tool_registry.list_tools()
        if not self._allowlist:
            return []
        return [t for t in all_tools if t.name in self._allowlist]

    def _build_system_prompt(self) -> str:
        """Build a focused system prompt for this agent type."""
        # Find matching specialist profile for richer prompt
        profile: Optional[SpecialistProfile] = next(
            (p for p in SPECIALIST_PROFILES if p.id == self.task.agent_type), None
        )
        base = (
            f"You are a NIM JARVIS {self.task.agent_type} subagent.\n"
            f"Your ONLY job: {self.task.instruction}\n\n"
            f"Rules:\n"
            f"- Stay strictly within your domain. Do NOT attempt tasks outside your scope.\n"
            f"- Complete the sub-task efficiently and publish results.\n"
            f"- When done, summarize findings concisely.\n"
        )
        if profile:
            base += f"\nSpecialty guidance: {profile.system_prompt_addon}"
        return base

    async def run(self) -> SubAgentResult:
        """Execute the subagent task and return a result."""
        start = time.time()
        task = self.task
        findings: List[Finding] = []

        logger.info(
            "SubAgent[%s] starting task '%s' (budget=%d tokens, timeout=%.0fs)",
            self.agent_id, task.name, task.token_budget, task.timeout_seconds
        )

        # Check budget before starting
        if not self.blackboard.check_worker_budget(task.token_budget):
            err = f"Token budget exhausted. SubAgent '{task.name}' cannot start."
            logger.warning(err)
            return SubAgentResult(
                task_id=task.id, task_name=task.name, agent_type=task.agent_type,
                success=False, findings=[], error=err,
            )

        try:
            allowed_tools = self._get_allowed_tools()
            system_prompt = self._build_system_prompt()
            tool_defs = [t.to_tool_definition() for t in allowed_tools]

            # Run agentic mini-loop (max 8 iterations to prevent runaway)
            messages = [{"role": "user", "content": task.instruction}]
            tokens_used = 0
            max_iters = 8

            from src.tools.base import ToolContext
            ctx = ToolContext(task_id=task.id, session_id=self.agent_id)

            for iteration in range(max_iters):
                elapsed = time.time() - start
                if elapsed > task.timeout_seconds:
                    logger.warning("SubAgent[%s] timed out after %.1fs", self.agent_id, elapsed)
                    break

                if self.blackboard.budget_exhausted:
                    logger.info("SubAgent[%s] stopping: global budget exhausted", self.agent_id)
                    break

                # LLM call
                response = await self.llm_client.generate(
                    messages=messages,
                    system=system_prompt,
                    tools=tool_defs if tool_defs else None,
                    max_tokens=min(4096, task.token_budget - tokens_used),
                )

                tokens_used += response.get("usage", {}).get("total_tokens", 500)

                content = response.get("content", "")
                tool_calls = response.get("tool_calls", [])

                # If no tool calls, we're done — publish final answer as finding
                if not tool_calls:
                    finding = self.blackboard.publish(
                        topic=f"{task.agent_type}_result",
                        content=content,
                        agent_id=self.agent_id,
                        agent_type=task.agent_type,
                        metadata={"task": task.name, "iteration": iteration},
                    )
                    findings.append(finding)
                    if self.on_finding:
                        self.on_finding(finding)
                    break

                # Execute tool calls
                messages.append({"role": "assistant", "content": content or "", "tool_calls": tool_calls})

                for tc in tool_calls:
                    tc_id = tc.get("id") or f"call_{uuid.uuid4().hex[:8]}"
                    tool_name = tc.get("name") or tc.get("function", {}).get("name", "")
                    tool_args = tc.get("arguments") or tc.get("function", {}).get("arguments", {})

                    if tool_name not in self._allowlist and self._allowlist:
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "name": tool_name,
                            "content": f"ERROR: Tool '{tool_name}' not in allowlist for {task.agent_type} agent."
                        })
                        continue

                    result = await self.tool_registry.execute_tool(tool_name, tool_args, ctx)
                    result_content = result.to_output_str()

                    # Publish intermediate finding for important results
                    if result.success and result.data:
                        finding = self.blackboard.publish(
                            topic=f"{tool_name}_result",
                            content=result.data,
                            agent_id=self.agent_id,
                            agent_type=task.agent_type,
                            metadata={"task": task.name, "tool": tool_name},
                        )
                        findings.append(finding)
                        if self.on_finding:
                            self.on_finding(finding)

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "name": tool_name,
                        "content": result_content
                    })

        except asyncio.TimeoutError:
            err = f"SubAgent '{task.name}' timed out"
            logger.warning(err)
            return SubAgentResult(
                task_id=task.id, task_name=task.name, agent_type=task.agent_type,
                success=False, findings=findings, error=err,
                duration_seconds=time.time() - start,
            )
        except Exception as exc:
            logger.error("SubAgent[%s] error: %s", self.agent_id, exc, exc_info=True)
            return SubAgentResult(
                task_id=task.id, task_name=task.name, agent_type=task.agent_type,
                success=False, findings=findings, error=str(exc),
                tokens_used=0, duration_seconds=time.time() - start,
            )

        duration = time.time() - start
        logger.info(
            "SubAgent[%s] done in %.2fs, %d findings published",
            self.agent_id, duration, len(findings)
        )
        return SubAgentResult(
            task_id=task.id, task_name=task.name, agent_type=task.agent_type,
            success=True, findings=findings,
            tokens_used=tokens_used, duration_seconds=duration,
        )


# ---------------------------------------------------------------------------
# SubAgentRunner
# ---------------------------------------------------------------------------

@dataclass
class ParallelRunnerOptions:
    """Options for parallel subagent execution."""
    max_concurrent: int = 4          # max workers running simultaneously
    fail_fast: bool = False          # stop all workers if one fails
    collect_all_findings: bool = True  # wait for all to finish before returning


class SubAgentRunner:
    """
    Orchestrates multiple subagents, running them in parallel.

    Usage::

        runner = SubAgentRunner(
            blackboard=bb,
            tool_registry=get_tool_registry(),
            llm_client=llm,
        )
        results = await runner.run_parallel([
            SubAgentTask("files", "List all Python files", agent_type="system"),
            SubAgentTask("screen", "Find the Submit button", agent_type="perception"),
        ])
    """

    def __init__(
        self,
        blackboard: Optional[Blackboard] = None,
        tool_registry=None,
        llm_client=None,
        on_finding: Optional[Callable[[Finding], None]] = None,
    ):
        self.blackboard = blackboard or get_blackboard()
        self.tool_registry = tool_registry
        self.llm_client = llm_client
        self.on_finding = on_finding

    async def run_single(self, task: SubAgentTask) -> SubAgentResult:
        """Run a single subagent task."""
        agent = SubAgent(
            task=task,
            blackboard=self.blackboard,
            tool_registry=self.tool_registry,
            llm_client=self.llm_client,
            on_finding=self.on_finding,
        )
        return await agent.run()

    async def run_parallel(
        self,
        tasks: List[SubAgentTask],
        options: Optional[ParallelRunnerOptions] = None,
    ) -> List[SubAgentResult]:
        """
        Run multiple subagent tasks in parallel with concurrency control.
        Returns a list of results in the same order as the input tasks.
        """
        opts = options or ParallelRunnerOptions()
        semaphore = asyncio.Semaphore(opts.max_concurrent)
        results: List[Optional[SubAgentResult]] = [None] * len(tasks)
        cancelled = False

        async def run_with_sem(idx: int, task: SubAgentTask) -> None:
            nonlocal cancelled
            if cancelled:
                return
            async with semaphore:
                if cancelled:
                    return
                result = await self.run_single(task)
                results[idx] = result
                if opts.fail_fast and not result.success:
                    cancelled = True
                    logger.warning(
                        "SubAgentRunner: fail_fast triggered by '%s'", task.name
                    )

        await asyncio.gather(*[
            run_with_sem(i, task) for i, task in enumerate(tasks)
        ])

        return [r for r in results if r is not None]

    async def run_sequential(
        self,
        tasks: List[SubAgentTask],
    ) -> List[SubAgentResult]:
        """Run subagent tasks one after another."""
        results = []
        for task in tasks:
            result = await self.run_single(task)
            results.append(result)
            if not result.success:
                logger.warning("Sequential runner: task '%s' failed, continuing.", task.name)
        return results

    def synthesize_findings(self, results: List[SubAgentResult]) -> Dict[str, Any]:
        """
        Merge all findings from multiple subagent results into a summary dict.
        Groups findings by topic.
        """
        by_topic: Dict[str, List[Any]] = {}
        for result in results:
            for finding in result.findings:
                by_topic.setdefault(finding.topic, []).append(finding.content)

        return {
            "goal": self.blackboard.goal,
            "total_findings": sum(len(r.findings) for r in results),
            "by_topic": by_topic,
            "agent_results": [
                {
                    "task": r.task_name,
                    "type": r.agent_type,
                    "success": r.success,
                    "findings": len(r.findings),
                    "duration_s": round(r.duration_seconds, 2),
                    "error": r.error,
                }
                for r in results
            ],
        }
