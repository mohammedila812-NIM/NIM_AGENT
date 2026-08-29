import os
import pytest
from unittest.mock import MagicMock, patch

from src.perception.process_monitor import ProcessMonitor, ProcessSummaryItem, ProcessCheckpoint
from src.tools.process_tools import (
    ListProcessesTool,
    GetProcessDetailsTool,
    KillProcessTool,
    RestartProcessTool,
    MonitorProcessBaselineTool,
    get_process_monitor
)
from src.tools.base import ToolContext
from src.security.guard import SecurityGuard, ActionRiskLevel

@pytest.fixture
def process_monitor():
    return ProcessMonitor()

def test_list_and_filter_processes(process_monitor):
    # Test listing real processes
    procs = process_monitor.list_processes(sort_by="ram", limit=10)
    assert len(procs) > 0
    assert procs[0].ram_mb >= 0.0

    # Test filtering
    python_procs = process_monitor.list_processes(filter_name="python", limit=5)
    assert len(python_procs) > 0
    assert "python" in python_procs[0].name.lower()

def test_get_process_details_current(process_monitor):
    cur_pid = os.getpid()
    details = process_monitor.get_process_details(cur_pid)
    assert details["success"] is True
    assert details["pid"] == cur_pid
    assert "python" in details["name"].lower()
    assert details["memory"]["rss_ram_mb"] > 0

def test_process_baseline_learning(process_monitor):
    import uuid
    app_name = f"test_app_{uuid.uuid4().hex[:6]}.exe"
    # Record baseline samples
    process_monitor.memory_store.record_process_metric(app_name, ram_mb=100.0, cpu_percent=5.0)
    process_monitor.memory_store.record_process_metric(app_name, ram_mb=200.0, cpu_percent=15.0)

    base = process_monitor.memory_store.get_process_baseline(app_name)
    assert base is not None
    assert base["sample_count"] == 2
    assert base["avg_ram_mb"] == 150.0
    assert base["max_ram_mb"] == 200.0
    assert base["min_ram_mb"] == 100.0

def test_safe_kill_and_checkpoint_mock(process_monitor):
    mock_proc = MagicMock()
    mock_proc.pid = 9999
    mock_proc.name.return_value = "dummy_notepad.exe"
    mock_proc.exe.return_value = "C:\\Windows\\notepad.exe"
    mock_proc.cmdline.return_value = ["C:\\Windows\\notepad.exe", "test.txt"]
    mock_proc.cwd.return_value = "C:\\"

    with patch.object(process_monitor, "_resolve_process", return_value=mock_proc):
        res = process_monitor.kill_process(9999)
        assert res["success"] is True
        assert "dummy_notepad.exe" in res["name"]
        mock_proc.terminate.assert_called_once()

@pytest.mark.asyncio
async def test_process_tools():
    ctx = ToolContext(task_id="test_proc_ctx")

    # 1. ListProcessesTool
    list_tool = ListProcessesTool()
    res_list = await list_tool.execute({"limit": 5}, ctx)
    assert res_list.success is True
    assert len(res_list.data["processes"]) > 0

    # 2. GetProcessDetailsTool
    details_tool = GetProcessDetailsTool()
    res_details = await details_tool.execute({"pid_or_name": str(os.getpid())}, ctx)
    assert res_details.success is True
    assert res_details.data["pid"] == os.getpid()

    # 3. MonitorProcessBaselineTool
    baseline_tool = MonitorProcessBaselineTool()
    res_base = await baseline_tool.execute({}, ctx)
    assert res_base.success is True
    assert "baselines" in res_base.data

    # 4. RestartProcessTool (mock checkpoint)
    restart_tool = RestartProcessTool()
    with patch("src.tools.process_tools.get_process_monitor") as mock_get_mon:
        mock_mon = MagicMock()
        mock_mon.restart_process.return_value = {"success": True, "restarted_name": "notepad.exe", "new_pid": 8888}
        mock_get_mon.return_value = mock_mon

        res_restart = await restart_tool.execute({"checkpoint_id_or_name": "notepad.exe"}, ctx)
        assert res_restart.success is True
        assert res_restart.data["new_pid"] == 8888

def test_security_guard_kill_process():
    # User process -> DESTRUCTIVE
    assert SecurityGuard.evaluate_tool_call("kill_process", {"pid_or_name": "notepad.exe"}) == ActionRiskLevel.DESTRUCTIVE

    # Protected OS process -> CRITICAL
    assert SecurityGuard.evaluate_tool_call("kill_process", {"pid_or_name": "explorer.exe"}) == ActionRiskLevel.CRITICAL
    assert SecurityGuard.evaluate_tool_call("kill_process", {"pid_or_name": "svchost.exe"}) == ActionRiskLevel.CRITICAL
    assert SecurityGuard.evaluate_tool_call("kill_process", {"pid_or_name": "csrss.exe"}) == ActionRiskLevel.CRITICAL
