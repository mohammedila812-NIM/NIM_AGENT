import pytest
from unittest.mock import AsyncMock, patch
from src.agent.loop import AgentOrchestrator
from src.llm.types import StreamEvent, ToolCall
from src.tools.base import ToolContext
from src.tools.file_tools import WriteFileTool, ReadFileTool

@pytest.mark.asyncio
async def test_agent_orchestrator_mock_flow():
    orchestrator = AgentOrchestrator()

    # Mock classify intent to return "agent"
    with patch.object(orchestrator, "classify_intent", new=AsyncMock(return_value="agent")):
        # Mock client stream_chat to first yield a tool call, then yield final completion
        step1_events = [
            StreamEvent(event_type="reasoning", data="Thinking: I will get system info."),
            StreamEvent(
                event_type="tool_call",
                data=ToolCall(
                    id="call_mock_1",
                    function={"name": "get_system_info", "arguments": "{}"}
                )
            ),
            StreamEvent(event_type="done", data={})
        ]

        step2_events = [
            StreamEvent(event_type="content", data="System info retrieved: CPU and RAM look healthy!"),
            StreamEvent(event_type="done", data={})
        ]

        call_count = 0
        async def mock_stream_chat(req):
            nonlocal call_count
            call_count += 1
            events = step1_events if call_count == 1 else step2_events
            for ev in events:
                yield ev

        with patch("src.agent.loop.LLMClient.stream_chat", side_effect=mock_stream_chat):
            collected_events = []
            async for ev in orchestrator.execute_task("Check system performance"):
                collected_events.append(ev)

            event_types = [e.get("event") for e in collected_events]
            assert "task_started" in event_types
            assert "intent_classified" in event_types
            assert "tool_call_start" in event_types
            assert "tool_call_result" in event_types
            assert "task_completed" in event_types

            # Verify tool execution occurred
            tool_result_event = next(e for e in collected_events if e.get("event") == "tool_call_result")
            assert tool_result_event["tool"] == "get_system_info"
            assert tool_result_event["success"] is True

            final_event = next(e for e in collected_events if e.get("event") == "task_completed")
            assert "System info retrieved" in final_event["final_answer"]

@pytest.mark.asyncio
async def test_agent_orchestrator_cancellation():
    orchestrator = AgentOrchestrator()

    with patch.object(orchestrator, "classify_intent", new=AsyncMock(return_value="agent")):
        async def mock_infinite_stream(req):
            for i in range(10):
                yield StreamEvent(event_type="reasoning", data=f"Thinking step {i}...")

        with patch("src.agent.loop.LLMClient.stream_chat", side_effect=mock_infinite_stream):
            collected = []
            async for ev in orchestrator.execute_task("Long running task"):
                collected.append(ev)
                if ev.get("event") == "reasoning_chunk":
                    # Trigger ESC / cancel signal
                    orchestrator.cancel_current_task()

            event_types = [e.get("event") for e in collected]
            assert "task_cancelled" in event_types

