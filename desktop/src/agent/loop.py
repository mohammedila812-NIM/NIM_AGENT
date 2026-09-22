"""
NIM_AGENT Core Agent Orchestrator & ReAct Execution Loop.
Features:
- Multi-Turn Session Scratchpad (deterministic recall of files, windows, and context)
- Manus / Claude-style Autonomous Visual Grounding & Reflection Loop
- Code-Free Extensible Skills Engine integration
- Robust tool calling, streaming SSE, and human-in-the-loop approvals
"""

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncGenerator, Callable, Dict, List, Optional, Set

from src.config import AgentConfig, APP_DIR
from src.llm.client import LLMClient
from src.llm.router import ModelRouter
from src.llm.types import ChatMessage, ChatCompletionRequest, ToolCall
from src.tools.base import ToolContext, ToolResult
from src.tools.registry import UnifiedToolRegistry, get_tool_registry
from src.perception.window_manager import WindowManager
from src.perception.excel import SpreadsheetAnalyzer

# Tool imports
from src.tools.file_tools import (
    ReadFileTool,
    WriteFileTool,
    MoveFileTool,
    DeleteFileTool,
    ListDirectoryTool,
    SearchFilesTool,
    DiffFilesTool
)
from src.tools.shell_tools import RunCommandTool
from src.tools.doc_tools import GenerateDocumentTool
from src.tools.system_tools import (
    GetClipboardTool,
    SetClipboardTool,
    NotifyUserTool,
    GetSystemInfoTool
)
from src.tools.undo_tools import UndoLastActionTool, ListUndoHistoryTool, RestoreSnapshotTool
from src.tools.web_tools import WebSearchTool, ReadUrlTool
from src.tools.perception_tools import (
    AnalyzeSpreadsheetTool,
    GetActiveWindowInfoTool,
    CaptureScreenRegionTool,
    OcrScreenTextTool,
    VerifyActionResultTool,
    VisionDescribeImageTool
)
from src.tools.actuation_tools import (
    ClickElementTool,
    ClickCoordinateTool,
    TypeTextTool,
    SendHotkeyTool,
    DragAndDropTool,
    ScrollWheelTool
)
from src.tools.window_tools import (
    OpenApplicationTool,
    FocusWindowTool,
    CloseWindowTool,
    ResizeWindowTool,
    SetWindowStateTool,
    ListOpenWindowsTool,
    SaveWorkspaceTool,
    RestoreWorkspaceTool,
    MoveWindowToMonitorTool
)
from src.tools.scheduler_tools import (
    ScheduleTaskTool,
    ListScheduledTasksTool,
    CancelScheduledTaskTool,
    PauseSchedulerTool,
    ResumeSchedulerTool
)
from src.tools.email_tools import (
    ReadEmailsTool,
    SendEmailTool,
    ReplyEmailTool,
    SearchEmailsTool,
    TrackEmailReplyTool
)
from src.tools.process_tools import (
    ListProcessesTool,
    GetProcessDetailsTool,
    KillProcessTool,
    RestartProcessTool,
    MonitorProcessBaselineTool
)
from src.tools.converter_tools import (
    ConvertFileTool,
    CompressArchiveTool,
    ExtractArchiveTool,
    RenderDocumentPreviewTool
)
from src.tools.voice_tools import (
    SpeakTextTool,
    ListenVoiceTool,
    ToggleVoiceInputTool,
    SetVoicePersonaTool
)
from src.tools.update_tools import (
    CheckForUpdatesTool,
    ApplyProjectUpdateTool
)
from src.bridge.proxy_tools import BrowserResearchTool
from src.skills.manager import (
    get_skill_manager,
    ListSkillsTool,
    ReadSkillTool,
    RunSkillScriptTool
)
from .prompts import SYSTEM_PROMPT, INTENT_CLASSIFICATION_PROMPT
from .state import TaskState, AgentStep, TaskStatus
from .memory import get_memory_store
from src.agents.specialists import SpecialistRouter
from src.security.guard import ActionRiskLevel, SecurityGuard

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Multi-Turn Session Scratchpad
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SessionScratchpad:
    """
    Maintains compact, deterministic memory of created files, active windows,
    and conversational context across multi-turn tasks.
    """
    active_files: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    active_windows: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    recent_tasks: List[Dict[str, Any]] = field(default_factory=list)
    recent_dialogue: List[Dict[str, str]] = field(default_factory=list)

    def record_file(self, path: str, purpose: str = "Created/Modified"):
        norm_path = os.path.normpath(path)
        self.active_files[norm_path] = {
            "path": norm_path,
            "filename": os.path.basename(norm_path),
            "purpose": purpose,
            "timestamp": time.time()
        }

    def record_window(self, app_name: str, pid: Optional[int] = None, title: Optional[str] = None):
        self.active_windows[app_name] = {
            "app_name": app_name,
            "pid": pid,
            "title": title or app_name,
            "timestamp": time.time()
        }

    def record_task_turn(self, user_goal: str, assistant_summary: str):
        self.recent_tasks.append({
            "goal": user_goal,
            "summary": assistant_summary,
            "timestamp": time.time()
        })
        self.recent_dialogue.append({"role": "user", "content": user_goal})
        self.recent_dialogue.append({"role": "assistant", "content": assistant_summary})
        if len(self.recent_tasks) > 8:
            self.recent_tasks = self.recent_tasks[-8:]
        if len(self.recent_dialogue) > 12:
            self.recent_dialogue = self.recent_dialogue[-12:]

    def clear(self):
        self.active_files.clear()
        self.active_windows.clear()
        self.recent_tasks.clear()
        self.recent_dialogue.clear()

    def format_scratchpad_prompt(self) -> str:
        if not self.active_files and not self.active_windows and not self.recent_tasks:
            return ""

        lines = ["[ACTIVE SESSION SCRATCHPAD]"]
        if self.active_files:
            lines.append("• Recent Files & Artifacts (refer to these if the user mentions 'that file', 'the sheet', etc.):")
            for p, info in list(self.active_files.items())[-5:]:
                lines.append(f"  - {info['filename']} ({info['path']}) -> {info['purpose']}")
        if self.active_windows:
            lines.append("• Active Applications:")
            for app, win in list(self.active_windows.items())[-5:]:
                lines.append(f"  - {win['app_name']} (PID: {win['pid']}, Title: '{win['title']}')")
        if self.recent_tasks:
            lines.append("• Prior Goals in this Session:")
            for t in self.recent_tasks[-3:]:
                lines.append(f"  - User: \"{t['goal']}\" -> Result: {t['summary'][:120]}")
        return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Agent Orchestrator
# ─────────────────────────────────────────────────────────────────────────────

class AgentOrchestrator:
    """
    Main Agent Orchestrator for NIM_AGENT.
    Executes the ReAct Loop (Think -> Act -> Observe -> Repeat) natively across the OS,
    enhanced with reflective visual verification and code-free skills.
    """

    def __init__(
        self,
        config: Optional[AgentConfig] = None,
        tool_registry: Optional[UnifiedToolRegistry] = None
    ):
        self.config = config or AgentConfig()
        self.tool_registry = tool_registry or get_tool_registry()
        self.model_router = ModelRouter(
            primary_provider_id=self.config.provider_id,
            primary_model=self.config.model
        )
        self.memory_store = get_memory_store()
        self.scratchpad = SessionScratchpad()
        self.skill_manager = get_skill_manager()
        self._cancel_event = asyncio.Event()
        self.is_busy: bool = False
        self._register_default_tools()

    def cancel_current_task(self) -> bool:
        """Signals cancellation to stop the current LLM generation and tool executions immediately."""
        if self.is_busy:
            self._cancel_event.set()
            logger.info("Task cancellation signal received.")
            return True
        return False

    def reset_session(self) -> None:
        """Clears multi-turn session scratchpad for a clean slate."""
        self.scratchpad.clear()
        logger.info("Session scratchpad cleared.")

    def _register_default_tools(self):
        """Registers all built-in desktop tools."""
        tools = [
            ReadFileTool(),
            WriteFileTool(),
            MoveFileTool(),
            DeleteFileTool(),
            ListDirectoryTool(),
            SearchFilesTool(),
            DiffFilesTool(),
            RunCommandTool(),
            GenerateDocumentTool(),
            GetClipboardTool(),
            SetClipboardTool(),
            NotifyUserTool(),
            GetSystemInfoTool(),
            UndoLastActionTool(),
            ListUndoHistoryTool(),
            RestoreSnapshotTool(),
            WebSearchTool(),
            ReadUrlTool(),
            AnalyzeSpreadsheetTool(),
            GetActiveWindowInfoTool(),
            CaptureScreenRegionTool(),
            OcrScreenTextTool(),
            VerifyActionResultTool(),
            VisionDescribeImageTool(),
            ClickElementTool(),
            ClickCoordinateTool(),
            TypeTextTool(),
            SendHotkeyTool(),
            DragAndDropTool(),
            ScrollWheelTool(),
            OpenApplicationTool(),
            FocusWindowTool(),
            CloseWindowTool(),
            ResizeWindowTool(),
            SetWindowStateTool(),
            ListOpenWindowsTool(),
            SaveWorkspaceTool(),
            RestoreWorkspaceTool(),
            MoveWindowToMonitorTool(),
            ScheduleTaskTool(),
            ListScheduledTasksTool(),
            CancelScheduledTaskTool(),
            PauseSchedulerTool(),
            ResumeSchedulerTool(),
            ReadEmailsTool(),
            SendEmailTool(),
            ReplyEmailTool(),
            SearchEmailsTool(),
            TrackEmailReplyTool(),
            ListProcessesTool(),
            GetProcessDetailsTool(),
            KillProcessTool(),
            RestartProcessTool(),
            MonitorProcessBaselineTool(),
            ConvertFileTool(),
            CompressArchiveTool(),
            ExtractArchiveTool(),
            RenderDocumentPreviewTool(),
            SpeakTextTool(),
            ListenVoiceTool(),
            ToggleVoiceInputTool(),
            SetVoicePersonaTool(),
            CheckForUpdatesTool(),
            ApplyProjectUpdateTool(),
            BrowserResearchTool(),
            ListSkillsTool(),
            ReadSkillTool(),
            RunSkillScriptTool(),
        ]
        for t in tools:
            self.tool_registry.register(t)

    @staticmethod
    def _route_temperature(route, fallback: float) -> float:
        return route.provider.default_temperature if route.provider.default_temperature is not None else fallback

    async def classify_intent(self, user_goal: str) -> str:
        """Classifies intent as 'agent' or 'chat' to save unnecessary tool overhead."""
        route = self.model_router.get_route(task_type="intent")
        client = LLMClient(base_url=route.provider.base_url, api_key=route.provider.api_key)

        messages = [
            ChatMessage(role="system", content=INTENT_CLASSIFICATION_PROMPT),
            ChatMessage(role="user", content=user_goal)
        ]
        req = ChatCompletionRequest(
            model=route.model,
            messages=messages,
            temperature=self._route_temperature(route, 0.0),
            max_tokens=150,
            stream=False
        )

        try:
            full_resp = ""
            async for ev in client.stream_chat(req):
                if ev.event_type == "content":
                    full_resp += ev.data

            data = json.loads(full_resp.strip())
            return data.get("intent", "agent")
        except Exception:
            return "agent"

    async def execute_task(
        self,
        goal: str,
        task_id: Optional[str] = None,
        hitl_callback: Optional[Callable[[str, Dict[str, Any]], Any]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Executes a user goal through the enhanced ReAct agent loop.
        Yields live event dictionaries for CLI, GUI, and WebSocket listeners.
        """
        t_id = task_id or f"task_{uuid.uuid4().hex[:8]}"
        self._cancel_event.clear()
        self.is_busy = True
        session_approved_tools: Set[str] = set()
        created_artifacts: List[str] = []
        reflection_done = False
        execution_step_count = 0

        state = TaskState(task_id=t_id, goal=goal, status=TaskStatus.RUNNING)
        try:
            yield {"event": "task_started", "task_id": t_id, "goal": goal}

            # 1. Match Specialist Profile
            specialist = SpecialistRouter.match_specialist(goal)
            system_content = f"{SYSTEM_PROMPT}\n\n[Active Specialist Profile: {specialist.name}]\n{specialist.system_prompt_addon}"

            # 2. Inject Skills matching the goal
            matched_skills = self.skill_manager.match_skills(goal)
            if matched_skills:
                skills_section = ["\n[ACTIVATED SKILLS]"]
                for s in matched_skills:
                    skills_section.append(f"• Skill: {s.name} - {s.description}")
                    skills_section.append(f"Guidelines:\n{s.instructions}\n")
                    yield {"event": "skill_activated", "skill": s.name, "description": s.description}
                system_content += "\n" + "\n".join(skills_section)

            # 3. Inject Session Scratchpad (multi-turn context)
            scratchpad_prompt = self.scratchpad.format_scratchpad_prompt()
            if scratchpad_prompt:
                system_content += f"\n\n{scratchpad_prompt}"

            # 4. Intent Check
            intent = await self.classify_intent(goal)
            yield {"event": "intent_classified", "intent": intent, "specialist": specialist.id}

            # 5. Build ReAct loop messages with recent conversation context
            messages: List[ChatMessage] = [ChatMessage(role="system", content=system_content)]

            # Carry forward the last 2 multi-turn interactions for natural context
            for prev in self.scratchpad.recent_dialogue[-4:]:
                messages.append(ChatMessage(role=prev["role"], content=prev["content"]))

            messages.append(ChatMessage(role="user", content=goal))

            route = self.model_router.get_route(task_type="planning")
            client = LLMClient(base_url=route.provider.base_url, api_key=route.provider.api_key)
            tools = self.tool_registry.get_tool_definitions() if intent == "agent" else None

            iteration = 0
            while iteration < self.config.max_iterations:
                if self._cancel_event.is_set():
                    state.status = TaskStatus.CANCELLED
                    yield {"event": "task_cancelled", "task_id": t_id, "message": "Task cancelled by user"}
                    return

                iteration += 1
                yield {"event": "iteration_start", "iteration": iteration}

                # Sliding window context compression: Keep system, first user goal, and last 12 messages
                if len(messages) > 16:
                    messages = [messages[0], messages[1]] + messages[-14:]

                req = ChatCompletionRequest(
                    model=route.model,
                    messages=messages,
                    tools=tools,
                    temperature=self._route_temperature(route, self.config.temperature),
                    max_tokens=self.config.max_tokens,
                    stream=True
                )

                accumulated_reasoning = ""
                accumulated_content = ""
                emitted_tool_calls: List[ToolCall] = []

                async for stream_ev in client.stream_chat(req):
                    if self._cancel_event.is_set():
                        state.status = TaskStatus.CANCELLED
                        yield {"event": "task_cancelled", "task_id": t_id, "message": "Task cancelled by user"}
                        return

                    if stream_ev.event_type == "reasoning":
                        accumulated_reasoning += stream_ev.data
                        yield {"event": "reasoning_chunk", "delta": stream_ev.data}
                    elif stream_ev.event_type == "content":
                        accumulated_content += stream_ev.data
                        yield {"event": "content_chunk", "delta": stream_ev.data}
                    elif stream_ev.event_type == "tool_call":
                        emitted_tool_calls.append(stream_ev.data)
                    elif stream_ev.event_type == "usage":
                        u = stream_ev.data
                        p_tok = int(u.get("prompt_tokens", 0))
                        c_tok = int(u.get("completion_tokens", 0))
                        state.prompt_tokens += p_tok
                        state.completion_tokens += c_tok
                        state.estimated_usd_cost = round(((state.prompt_tokens + state.completion_tokens) / 1_000_000) * 0.15, 6)
                    elif stream_ev.event_type == "error":
                        yield {"event": "error", "message": stream_ev.data}
                        state.status = TaskStatus.FAILED
                        state.error = stream_ev.data
                        return

                if self._cancel_event.is_set():
                    state.status = TaskStatus.CANCELLED
                    yield {"event": "task_cancelled", "task_id": t_id, "message": "Task cancelled by user"}
                    return

                # Append assistant response
                assistant_msg = ChatMessage(
                    role="assistant",
                    content=accumulated_content or None,
                    reasoning_content=accumulated_reasoning or None,
                    tool_calls=emitted_tool_calls if emitted_tool_calls else None
                )
                messages.append(assistant_msg)

                # ─────────────────────────────────────────────────────────────
                # Reflective Verification & Self-Correction Loop (Manus / Claude Style)
                # ─────────────────────────────────────────────────────────────
                if not emitted_tool_calls:
                    # If this is the first completion pass and tools were executed, perform autonomous verification
                    if not reflection_done and execution_step_count > 0:
                        reflection_done = True
                        audit_reports = []
                        has_critical_error = False

                        # 1. Deterministic quality audit of all created artifacts
                        for fpath in created_artifacts:
                            p = Path(fpath)
                            if not p.exists():
                                continue
                            ext = p.suffix.lower()
                            if ext in [".xlsx", ".xls", ".csv"]:
                                try:
                                    res = SpreadsheetAnalyzer.analyze_file(str(p))
                                    if res.get("success"):
                                        errs = res.get("errors_detected", 0)
                                        err_list = res.get("error_cells", [])
                                        f_count = res.get("formulas_detected", 0)
                                        dims = res.get("dimensions", {})
                                        if errs > 0:
                                            has_critical_error = True
                                            audit_reports.append(
                                                f"❌ BROKEN FORMULAS in {p.name}: {errs} error cell(s) detected: {err_list}. "
                                                f"You must fix these broken formulas before finishing."
                                            )
                                            yield {"event": "artifact_audit_result", "path": str(p), "success": False, "errors": errs, "details": err_list}
                                        else:
                                            audit_reports.append(
                                                f"✓ VERIFIED {p.name}: {f_count} active formula(s) verified, 0 errors, {dims.get('rows', 0)} rows x {dims.get('columns', 0)} cols."
                                            )
                                            yield {"event": "artifact_audit_result", "path": str(p), "success": True, "formulas": f_count, "dimensions": dims}
                                except Exception as e:
                                    logger.warning("Spreadsheet audit warning: %s", e)

                            elif ext == ".py":
                                try:
                                    code = p.read_text(encoding="utf-8", errors="replace")
                                    compile(code, str(p), "exec")
                                    audit_reports.append(f"✓ VERIFIED {p.name}: Python syntax is 100% valid.")
                                    yield {"event": "artifact_audit_result", "path": str(p), "success": True, "type": "python_syntax_valid"}
                                except SyntaxError as se:
                                    has_critical_error = True
                                    audit_reports.append(f"❌ SYNTAX ERROR in {p.name}: line {se.lineno}: {se.msg}")
                                    yield {"event": "artifact_audit_result", "path": str(p), "success": False, "error": str(se)}
                            else:
                                if p.stat().st_size > 0:
                                    audit_reports.append(f"✓ VERIFIED {p.name}: Generated file size is {p.stat().st_size} bytes.")
                                    yield {"event": "artifact_audit_result", "path": str(p), "success": True, "bytes": p.stat().st_size}

                        # 2. Automatic Presentation: Open spreadsheet or document for immediate user viewing
                        for fpath in created_artifacts:
                            p = Path(fpath)
                            if p.exists() and p.suffix.lower() in [".xlsx", ".xls", ".csv", ".docx", ".pdf", ".pptx"]:
                                try:
                                    wm = WindowManager()
                                    app_kind = "excel" if p.suffix.lower() in [".xlsx", ".xls", ".csv"] else "explorer"
                                    yield {"event": "artifact_presentation", "path": str(p), "app": app_kind}
                                    if p.suffix.lower() in [".xlsx", ".xls", ".csv"]:
                                        await wm.open_application("excel", args=[str(p)], wait_seconds=1.0)
                                        self.scratchpad.record_window("EXCEL.EXE", title=p.name)
                                except Exception as e:
                                    logger.warning("Auto presentation warning: %s", e)

                        audit_summary_str = "\n".join(audit_reports) if audit_reports else "All operations checked."

                        if has_critical_error:
                            critique_prompt = (
                                f"[Autonomous Quality Gate FAILED]:\n{audit_summary_str}\n\n"
                                f"You MUST use tools to fix the errors listed above before presenting your final answer to the user."
                            )
                        else:
                            critique_prompt = (
                                f"[Self-Reflection & Quality Verification Passed]:\n{audit_summary_str}\n\n"
                                "1. Confirm all user requirements were fully satisfied.\n"
                                "2. If completed to the highest production standard, summarize your results cleanly and concisely."
                            )

                        messages.append(ChatMessage(role="user", content=critique_prompt))
                        yield {"event": "verification_reflection_start", "message": "Autonomous quality inspection complete.", "audit": audit_summary_str}
                        continue

                    # Final conclusion
                    state.status = TaskStatus.COMPLETED
                    state.final_answer = accumulated_content
                    yield {
                        "event": "task_completed",
                        "final_answer": accumulated_content,
                        "task_id": t_id,
                        "tokens": state.prompt_tokens + state.completion_tokens,
                        "cost_usd": state.estimated_usd_cost,
                        "artifacts": created_artifacts
                    }

                    # Record in persistent and session scratchpad memory
                    self.memory_store.record_task(
                        task_id=t_id,
                        goal=goal,
                        summary=accumulated_content[:200] if accumulated_content else "Completed",
                        status="completed",
                        steps_count=len(state.steps),
                        tokens=state.prompt_tokens + state.completion_tokens
                    )
                    self.scratchpad.record_task_turn(goal, accumulated_content[:300] if accumulated_content else "Completed")
                    return

                # Execute emitted tool calls
                for tc in emitted_tool_calls:
                    if self._cancel_event.is_set():
                        state.status = TaskStatus.CANCELLED
                        yield {"event": "task_cancelled", "task_id": t_id, "message": "Task cancelled by user"}
                        return

                    tool_name = tc.name
                    try:
                        tool_args = json.loads(tc.arguments) if isinstance(tc.arguments, str) else tc.arguments
                    except Exception:
                        tool_args = {}

                    execution_step_count += 1
                    yield {"event": "tool_call_start", "tool": tool_name, "args": tool_args}

                    # Human-In-The-Loop Approval check
                    calculated_risk = SecurityGuard.evaluate_tool_call(tool_name, tool_args)
                    user_approved = False
                    if calculated_risk in [ActionRiskLevel.DESTRUCTIVE, ActionRiskLevel.CRITICAL]:
                        if tool_name in session_approved_tools:
                            user_approved = True
                        elif hitl_callback:
                            yield {"event": "approval_required", "tool": tool_name, "args": tool_args, "risk": calculated_risk.value}
                            res_fut = hitl_callback(tool_name, tool_args)
                            approval_val = await res_fut if asyncio.iscoroutine(res_fut) or isinstance(res_fut, asyncio.Future) else res_fut

                            is_approved = False
                            if isinstance(approval_val, str):
                                is_approved = approval_val.lower() in ["y", "yes", "a", "always"]
                                if approval_val.lower() in ["a", "always"]:
                                    session_approved_tools.add(tool_name)
                            else:
                                is_approved = bool(approval_val)

                            if not is_approved:
                                obs_str = (
                                    f"Action cancelled: Operator denied permission to execute tool '{tool_name}'. "
                                    f"Do NOT retry this exact action. Please pivot and propose an alternative safe approach or inform the user."
                                )
                                messages.append(ChatMessage(role="tool", content=obs_str, tool_call_id=tc.id, name=tool_name))
                                yield {"event": "tool_call_denied", "tool": tool_name, "reason": "Operator denied permission"}
                                continue
                            user_approved = True
                        else:
                            obs_str = (
                                f"Action blocked: Tool '{tool_name}' requires explicit operator approval before execution, "
                                f"but no approval handler was available."
                            )
                            messages.append(ChatMessage(role="tool", content=obs_str, tool_call_id=tc.id, name=tool_name))
                            yield {"event": "tool_call_denied", "tool": tool_name, "reason": "Explicit operator approval required"}
                            continue

                    # Execute tool
                    context = ToolContext(task_id=t_id, user_approved=user_approved)
                    t_res: ToolResult = await self.tool_registry.execute_tool(tool_name, tool_args, context)

                    # Track artifacts and files created
                    if tool_name in ["write_file", "generate_document", "convert_file"]:
                        target_path = tool_args.get("file_path") or tool_args.get("path") or tool_args.get("target_path") or tool_args.get("output_path")
                        if target_path:
                            norm = os.path.normpath(str(target_path))
                            if norm not in created_artifacts:
                                created_artifacts.append(norm)
                            self.scratchpad.record_file(norm, purpose=f"Created by {tool_name}")

                    elif tool_name == "open_application":
                        app_name = tool_args.get("app_name", "")
                        win_pid = t_res.data.get("pid") if isinstance(t_res.data, dict) else None
                        self.scratchpad.record_window(app_name, pid=win_pid)

                    # Append tool result step
                    obs_str = t_res.to_output_str()
                    messages.append(ChatMessage(
                        role="tool",
                        content=obs_str,
                        tool_call_id=tc.id,
                        name=tool_name
                    ))
                    yield {
                        "event": "tool_call_result",
                        "tool": tool_name,
                        "success": t_res.success,
                        "result": obs_str[:500],
                        "risk": t_res.risk_level.value
                    }

                    step = AgentStep(
                        index=len(state.steps) + 1,
                        reasoning=accumulated_reasoning,
                        tool_name=tool_name,
                        tool_args=tool_args,
                        tool_result=obs_str[:1000],
                        success=t_res.success
                    )
                    state.steps.append(step)

        finally:
            self.is_busy = False
            yield {"event": "task_finished", "task_id": t_id, "status": state.status.value}
