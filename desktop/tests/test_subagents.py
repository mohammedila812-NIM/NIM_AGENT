import pytest
import asyncio
from src.agents.blackboard import Blackboard, Finding, TokenBudget, new_blackboard
from src.agents.subagent_runner import (
    SubAgentRunner,
    SubAgentTask,
    SubAgentResult,
    ParallelRunnerOptions,
    AGENT_TOOL_ALLOWLISTS,
)
from src.tools.subagent_tools import (
    GetSubagentBlackboardTool,
    ClearBlackboardTool,
)
from src.tools.base import ToolContext

def test_token_budget():
    budget = TokenBudget(max_tokens=1000)
    assert budget.consume(400) is True
    assert budget.remaining == 600
    assert budget.is_exhausted is False
    assert budget.consume(700) is False # Over budget
    assert budget.remaining == 600

def test_blackboard_publish_and_subscribe():
    bb = Blackboard(goal="Test multi-agent search")
    received = []
    bb.subscribe(lambda f: received.append(f))

    f1 = bb.publish(topic="file_discovery", content=["a.py", "b.py"], agent_id="system-1", agent_type="system")
    assert bb.finding_count == 1
    assert len(received) == 1
    assert received[0].topic == "file_discovery"

    findings = bb.get_findings(topic="file_discovery")
    assert len(findings) == 1
    assert findings[0].content == ["a.py", "b.py"]

    # Goal satisfaction
    assert bb.is_goal_satisfied() is True

def test_blackboard_clear():
    bb = Blackboard(goal="Old goal")
    bb.publish(topic="data", content="123")
    assert bb.finding_count == 1

    bb.clear()
    assert bb.finding_count == 0
    assert bb.is_goal_satisfied() is False

@pytest.mark.asyncio
async def test_subagent_runner_parallel_mock():
    bb = Blackboard(goal="Parallel Test")
    
    # Mock LLM Client
    class MockLLM:
        async def generate(self, messages, system, tools=None, max_tokens=4096):
            return {
                "content": "Task completed successfully with findings.",
                "tool_calls": [],
                "usage": {"total_tokens": 150}
            }
            
    # Mock Registry
    class MockRegistry:
        def list_tools(self):
            return []
        async def execute_tool(self, name, args, ctx):
            pass

    runner = SubAgentRunner(blackboard=bb, tool_registry=MockRegistry(), llm_client=MockLLM())
    tasks = [
        SubAgentTask(name="task1", instruction="Search docs", agent_type="research"),
        SubAgentTask(name="task2", instruction="Inspect UI", agent_type="perception"),
    ]

    results = await runner.run_parallel(tasks)
    assert len(results) == 2
    assert all(r.success for r in results)
    assert bb.finding_count == 2

    summary = runner.synthesize_findings(results)
    assert summary["total_findings"] == 2

@pytest.mark.asyncio
async def test_subagent_tools_blackboard_inspection():
    bb = new_blackboard(goal="Inspect test")
    bb.publish(topic="telemetry", content={"status": "optimal"})

    ctx = ToolContext(task_id="test_ctx")
    get_tool = GetSubagentBlackboardTool()
    res = await get_tool.execute({}, ctx)
    assert res.success is True
    assert res.data["finding_count"] == 1

    clear_tool = ClearBlackboardTool()
    res = await clear_tool.execute({"new_goal": "Next Mission"}, ctx)
    assert res.success is True
    assert res.data["new_goal"] == "Next Mission"
