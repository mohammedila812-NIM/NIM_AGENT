import asyncio
import json
import logging
import uuid
from typing import Any, AsyncGenerator, Callable, Dict, List, Optional
from src.config import AgentConfig
from src.llm.client import LLMClient
from src.llm.router import ModelRouter
from src.llm.types import (
    ChatMessage,
    ChatCompletionRequest,
    ToolCall
)
from src.security.guard import ActionRiskLevel
from src.tools.base import ToolContext
from src.tools.registry import UnifiedToolRegistry, get_tool_registry
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
from src.tools.undo_tools import (
    UndoLastActionTool,
    ListUndoHistoryTool,
    RestoreSnapshotTool
)
from src.tools.web_tools import (
    WebSearchTool,
    ReadUrlTool
)
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
from src.bridge.proxy_tools import BrowserResearchTool
from .prompts import SYSTEM_PROMPT, INTENT_CLASSIFICATION_PROMPT
from .state import TaskState, AgentStep, TaskStatus
from .memory import get_memory_store

logger = logging.getLogger(__name__)

from src.agents.specialists import SpecialistRouter
from src.security.guard import SecurityGuard

class AgentOrchestrator:
    """
    Main Agent Orchestrator for NIM JARVIS Desktop.
    Executes the ReAct Loop (Think -> Act -> Observe -> Repeat) natively across the OS.
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
        self._cancel_event = asyncio.Event()
        self._register_default_tools()

    def cancel_current_task(self):
        """Signals cancellation to stop the current LLM generation and tool executions immediately."""
        self._cancel_event.set()
        logger.info("Task cancellation signal received.")

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
            BrowserResearchTool(),
        ]
        for t in tools:
            self.tool_registry.register(t)

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
            temperature=0.0,
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
        Executes a user goal through the ReAct agent loop.
        Yields live event dictionaries for the CLI and UI listeners.
        """
        t_id = task_id or f"task_{uuid.uuid4().hex[:8]}"
        self._cancel_event.clear()
        state = TaskState(task_id=t_id, goal=goal, status=TaskStatus.RUNNING)
        yield {"event": "task_started", "task_id": t_id, "goal": goal}

        # 1. Match Specialist Agent Profile
        specialist = SpecialistRouter.match_specialist(goal)
        system_content = f"{SYSTEM_PROMPT}\n\n[Active Specialist Profile: {specialist.name}]\n{specialist.system_prompt_addon}"

        # 2. Intent check
        intent = await self.classify_intent(goal)
        yield {"event": "intent_classified", "intent": intent, "specialist": specialist.id}

        # 3. Setup ReAct loop messages
        messages: List[ChatMessage] = [
            ChatMessage(role="system", content=system_content),
            ChatMessage(role="user", content=goal)
        ]

        route = self.model_router.get_route(task_type="planning")
        client = LLMClient(base_url=route.provider.base_url, api_key=route.provider.api_key)
        tools = self.tool_registry.get_tool_definitions() if intent == "agent" else None

        iteration = 0
        while iteration < self.config.max_iterations:
            if self._cancel_event.is_set():
                state.status = TaskStatus.CANCELLED
                yield {"event": "task_cancelled", "task_id": t_id, "message": "Task cancelled by user (Escape)"}
                return

            iteration += 1
            yield {"event": "iteration_start", "iteration": iteration}

            # Sliding window context compression: Keep system prompt, user goal, and last 12 turns
            if len(messages) > 14:
                messages = [messages[0], messages[1]] + messages[-12:]

            req = ChatCompletionRequest(
                model=route.model,
                messages=messages,
                tools=tools,
                temperature=self.config.temperature,
                max_tokens=self.config.max_tokens,
                stream=True
            )

            accumulated_reasoning = ""
            accumulated_content = ""
            emitted_tool_calls: List[ToolCall] = []

            async for stream_ev in client.stream_chat(req):
                if self._cancel_event.is_set():
                    state.status = TaskStatus.CANCELLED
                    yield {"event": "task_cancelled", "task_id": t_id, "message": "Task cancelled by user (Escape)"}
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
                yield {"event": "task_cancelled", "task_id": t_id, "message": "Task cancelled by user (Escape)"}
                return

            # Append assistant turn
            assistant_msg = ChatMessage(
                role="assistant",
                content=accumulated_content or None,
                reasoning_content=accumulated_reasoning or None,
                tool_calls=emitted_tool_calls if emitted_tool_calls else None
            )
            messages.append(assistant_msg)

            # If no tool calls were made, the agent finished its reasoning/answer
            if not emitted_tool_calls:
                state.status = TaskStatus.COMPLETED
                state.final_answer = accumulated_content
                yield {
                    "event": "task_completed",
                    "final_answer": accumulated_content,
                    "task_id": t_id,
                    "tokens": state.prompt_tokens + state.completion_tokens,
                    "cost_usd": state.estimated_usd_cost
                }
                self.memory_store.record_task(
                    task_id=t_id,
                    goal=goal,
                    summary=accumulated_content[:200] if accumulated_content else "Completed",
                    status="completed",
                    steps_count=len(state.steps),
                    tokens=state.prompt_tokens + state.completion_tokens
                )
                return

            # Execute tool calls
            for tc in emitted_tool_calls:
                if self._cancel_event.is_set():
                    state.status = TaskStatus.CANCELLED
                    yield {"event": "task_cancelled", "task_id": t_id, "message": "Task cancelled by user (Escape)"}
                    return

                tool_name = tc.name
                try:
                    tool_args = json.loads(tc.arguments) if isinstance(tc.arguments, str) else tc.arguments
                except Exception:
                    tool_args = {}

                yield {"event": "tool_call_start", "tool": tool_name, "args": tool_args}

                # Dynamic Risk Evaluation via SecurityGuard
                calculated_risk = SecurityGuard.evaluate_tool_call(tool_name, tool_args)
                if calculated_risk in [ActionRiskLevel.DESTRUCTIVE, ActionRiskLevel.CRITICAL] and hitl_callback:
                    res_fut = hitl_callback(tool_name, tool_args)
                    approved = await res_fut if asyncio.iscoroutine(res_fut) or isinstance(res_fut, asyncio.Future) else bool(res_fut)
                    if not approved:
                        obs_str = f"Action cancelled: User denied permission to execute {tool_name}."
                        messages.append(ChatMessage(role="tool", content=obs_str, tool_call_id=tc.id, name=tool_name))
                        yield {"event": "tool_call_denied", "tool": tool_name}
                        continue

                # Execute tool
                context = ToolContext(task_id=t_id)
                result = await self.tool_registry.execute_tool(tool_name, tool_args, context)
                obs_str = result.to_output_str()

                # Truncate individual tool observations to 4,000 characters to prevent context window explosion
                if len(obs_str) > 4000:
                    obs_str = obs_str[:4000] + f"\n... [Output truncated from {len(obs_str)} chars to 4000 chars for context preservation]"

                step = AgentStep(
                    index=len(state.steps) + 1,
                    reasoning=accumulated_reasoning,
                    tool_name=tool_name,
                    tool_args=tool_args,
                    tool_result=obs_str,
                    snapshot_id=result.snapshot_id,
                    success=result.success
                )
                state.add_step(step)

                yield {
                    "event": "tool_call_result",
                    "tool": tool_name,
                    "success": result.success,
                    "result": obs_str,
                    "snapshot_id": result.snapshot_id
                }

                # Feed observation back into dialogue
                messages.append(ChatMessage(
                    role="tool",
                    content=obs_str,
                    tool_call_id=tc.id,
                    name=tool_name
                ))

        state.status = TaskStatus.FAILED
        yield {"event": "task_completed", "final_answer": "Max iterations reached without resolution.", "task_id": t_id}
