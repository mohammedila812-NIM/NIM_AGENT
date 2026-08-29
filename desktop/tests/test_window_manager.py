import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.perception.window_manager import WindowManager, WindowInfo
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
from src.tools.base import ToolContext
from src.security.guard import SecurityGuard, ActionRiskLevel

@pytest.fixture
def window_manager(tmp_path):
    wm = WindowManager()
    return wm

def test_resolve_app_executable(window_manager):
    # Test built-in aliases
    assert "notepad" in window_manager.resolve_app_executable("notepad").lower()
    assert "calc" in window_manager.resolve_app_executable("calc").lower()
    assert "code" in window_manager.resolve_app_executable("vscode").lower()

def test_workspace_save_and_retrieve(window_manager):
    sample_windows = [
        WindowInfo(hwnd=101, title="Editor - main.py", process_name="code.exe", pid=1234, bounds={"left": 0, "top": 0, "width": 960, "height": 1080}, is_maximized=False),
        WindowInfo(hwnd=102, title="Google Chrome", process_name="chrome.exe", pid=5678, bounds={"left": 960, "top": 0, "width": 960, "height": 1080}, is_maximized=False),
    ]

    with patch.object(window_manager, "list_windows", return_value=sample_windows):
        res = window_manager.save_workspace_layout("dev_setup", description="Split coding layout")
        assert res["success"] is True
        assert res["saved_windows_count"] == 2

    # Retrieve from memory store
    saved = window_manager.memory_store.get_workspace("dev_setup")
    assert saved is not None
    assert saved["name"] == "dev_setup"
    assert len(saved["windows"]) == 2
    assert saved["windows"][0]["process_name"] == "code.exe"

    # List layouts
    all_workspaces = window_manager.memory_store.list_workspaces()
    assert any(w["name"] == "dev_setup" for w in all_workspaces)

@pytest.mark.asyncio
async def test_restore_workspace_layout(window_manager):
    # Save a test workspace
    test_windows = [
        {"title": "Notepad", "process_name": "notepad.exe", "bounds": {"left": 100, "top": 100, "width": 800, "height": 600}, "is_maximized": False}
    ]
    window_manager.memory_store.save_workspace("test_mode", "Test desc", test_windows)

    # Mock finding and resizing window
    with patch.object(window_manager, "find_window") as mock_find, \
         patch.object(window_manager, "set_window_geometry") as mock_resize:
        
        mock_find.return_value = WindowInfo(
            hwnd=999, title="Untitled - Notepad", process_name="notepad.exe",
            pid=1111, bounds={"left": 0, "top": 0, "width": 500, "height": 500}
        )
        mock_resize.return_value = {"success": True}

        res = await window_manager.restore_workspace_layout("test_mode")
        assert res["success"] is True
        assert res["restored_count"] == 1
        mock_resize.assert_called_once_with(999, width=800, height=600, left=100, top=100)

@pytest.mark.asyncio
async def test_open_application_tool():
    tool = OpenApplicationTool()
    ctx = ToolContext(task_id="test_win_1")

    with patch("src.tools.window_tools.get_window_manager") as mock_get_mgr:
        mock_mgr = MagicMock()
        mock_mgr.open_application = AsyncMock(return_value={
            "success": True, "app_name": "notepad", "executable": "notepad.exe", "pid": 4321
        })
        mock_get_mgr.return_value = mock_mgr

        res = await tool.execute({"app_name": "notepad"}, ctx)
        assert res.success is True
        assert res.data["app_name"] == "notepad"
        assert res.data["pid"] == 4321

@pytest.mark.asyncio
async def test_focus_and_resize_tools():
    focus_tool = FocusWindowTool()
    resize_tool = ResizeWindowTool()
    ctx = ToolContext(task_id="test_win_2")

    with patch("src.tools.window_tools.get_window_manager") as mock_get_mgr:
        mock_mgr = MagicMock()
        mock_mgr.focus_window = MagicMock(return_value={"success": True, "hwnd": 123, "title": "Chrome"})
        mock_mgr.set_window_geometry = MagicMock(return_value={"success": True, "bounds": {"width": 1200, "height": 800}})
        mock_get_mgr.return_value = mock_mgr

        res_focus = await focus_tool.execute({"window_pattern": "Chrome"}, ctx)
        assert res_focus.success is True
        assert res_focus.data["title"] == "Chrome"

        res_resize = await resize_tool.execute({"window_pattern": "Chrome", "width": 1200, "height": 800}, ctx)
        assert res_resize.success is True
        assert res_resize.data["bounds"]["width"] == 1200

@pytest.mark.asyncio
async def test_list_and_state_tools():
    list_tool = ListOpenWindowsTool()
    state_tool = SetWindowStateTool()
    ctx = ToolContext(task_id="test_win_3")

    with patch("src.tools.window_tools.get_window_manager") as mock_get_mgr:
        mock_mgr = MagicMock()
        mock_mgr.list_windows = MagicMock(return_value=[
            WindowInfo(hwnd=1, title="VS Code", process_name="code.exe", pid=10, bounds={"left": 0, "top": 0, "width": 800, "height": 600})
        ])
        mock_mgr.set_window_state = MagicMock(return_value={"success": True, "state": "maximize"})
        mock_get_mgr.return_value = mock_mgr

        res_list = await list_tool.execute({}, ctx)
        assert res_list.success is True
        assert res_list.data["count"] == 1

        res_state = await state_tool.execute({"window_pattern": "VS Code", "state": "maximize"}, ctx)
        assert res_state.success is True
        assert res_state.data["state"] == "maximize"

def test_security_guard_close_window():
    # Closing normal user app
    assert SecurityGuard.evaluate_tool_call("close_window", {"window_pattern": "Notepad"}) == ActionRiskLevel.MODERATE
    # Force kill
    assert SecurityGuard.evaluate_tool_call("close_window", {"window_pattern": "Notepad", "force": True}) == ActionRiskLevel.DESTRUCTIVE
    # Critical system process
    assert SecurityGuard.evaluate_tool_call("close_window", {"window_pattern": "explorer.exe"}) == ActionRiskLevel.CRITICAL
