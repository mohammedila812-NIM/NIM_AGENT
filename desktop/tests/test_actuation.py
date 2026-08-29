import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.perception.actuation import ActuationEngine, ActuationTargetResult, ActuationActionResult
from src.tools.actuation_tools import (
    ClickElementTool,
    ClickCoordinateTool,
    TypeTextTool,
    SendHotkeyTool,
    DragAndDropTool,
    ScrollWheelTool
)
from src.tools.base import ToolContext
from src.security.guard import SecurityGuard, ActionRiskLevel

@pytest.fixture
def actuation_engine():
    return ActuationEngine()

@pytest.mark.asyncio
async def test_resolve_target_coordinates(actuation_engine):
    # Tier 3: Explicit coordinates
    res = await actuation_engine.resolve_target(x=500, y=300)
    assert res.found is True
    assert res.source_tier == "coordinate"
    assert res.center_x == 500
    assert res.center_y == 300

@pytest.mark.asyncio
async def test_resolve_target_uia(actuation_engine):
    # Mock UIA find
    with patch.object(actuation_engine, "find_element_via_uia") as mock_uia:
        mock_uia.return_value = ActuationTargetResult(
            found=True,
            source_tier="uia",
            center_x=200,
            center_y=150,
            element_name="Save",
            control_type="Button"
        )
        res = await actuation_engine.resolve_target(element_name="Save")
        assert res.found is True
        assert res.source_tier == "uia"
        assert res.center_x == 200
        assert res.center_y == 150

@pytest.mark.asyncio
async def test_resolve_target_vision_fallback(actuation_engine):
    # When UIA returns not found, should fallback to vision
    with patch.object(actuation_engine, "find_element_via_uia") as mock_uia, \
         patch.object(actuation_engine, "find_element_via_vision", new_callable=AsyncMock) as mock_vision:
        
        mock_uia.return_value = ActuationTargetResult(found=False, source_tier="uia")
        mock_vision.return_value = ActuationTargetResult(
            found=True,
            source_tier="vision",
            center_x=800,
            center_y=450,
            element_name="Custom Canvas Button"
        )

        res = await actuation_engine.resolve_target(element_name="Custom Canvas Button")
        assert res.found is True
        assert res.source_tier == "vision"
        assert res.center_x == 800
        assert res.center_y == 450

@pytest.mark.asyncio
async def test_click_element_tool():
    tool = ClickElementTool()
    ctx = ToolContext(task_id="test_actuation_1")

    with patch("src.tools.actuation_tools.get_actuation_engine") as mock_get_engine:
        mock_engine = MagicMock()
        mock_engine.resolve_target = AsyncMock(return_value=ActuationTargetResult(
            found=True,
            source_tier="uia",
            center_x=320,
            center_y=240,
            element_name="Submit",
            control_type="Button"
        ))
        mock_engine.click = AsyncMock(return_value=ActuationActionResult(
            success=True,
            action_type="click",
            target_x=320,
            target_y=240,
            verified_change=True,
            diff_score=0.15,
            message="Clicked left button at (320, 240)"
        ))
        mock_get_engine.return_value = mock_engine

        res = await tool.execute({"element_name": "Submit"}, ctx)
        assert res.success is True
        assert res.data["element_name"] == "Submit"
        assert res.data["clicked_x"] == 320
        assert res.data["verified_change"] is True

@pytest.mark.asyncio
async def test_click_coordinate_tool():
    tool = ClickCoordinateTool()
    ctx = ToolContext(task_id="test_actuation_2")

    with patch("src.tools.actuation_tools.get_actuation_engine") as mock_get_engine:
        mock_engine = MagicMock()
        mock_engine.click = AsyncMock(return_value=ActuationActionResult(
            success=True,
            action_type="click",
            target_x=100,
            target_y=200,
            verified_change=True,
            diff_score=0.08,
            message="Clicked left button at (100, 200)"
        ))
        mock_get_engine.return_value = mock_engine

        res = await tool.execute({"x": 100, "y": 200, "double_click": True}, ctx)
        assert res.success is True
        assert res.data["x"] == 100
        assert res.data["y"] == 200
        assert res.data["double_click"] is True

@pytest.mark.asyncio
async def test_type_text_tool():
    tool = TypeTextTool()
    ctx = ToolContext(task_id="test_actuation_3")

    with patch("src.tools.actuation_tools.get_actuation_engine") as mock_get_engine:
        mock_engine = MagicMock()
        mock_engine.type_text = AsyncMock(return_value=ActuationActionResult(
            success=True,
            action_type="type_text",
            message="Typed 13 characters and pressed Enter"
        ))
        mock_get_engine.return_value = mock_engine

        res = await tool.execute({"text": "Hello JARVIS!", "press_enter": True, "clear_first": True}, ctx)
        assert res.success is True
        assert res.data["characters_typed"] == 13
        assert res.data["press_enter"] is True

@pytest.mark.asyncio
async def test_send_hotkey_tool():
    tool = SendHotkeyTool()
    ctx = ToolContext(task_id="test_actuation_4")

    with patch("src.tools.actuation_tools.get_actuation_engine") as mock_get_engine:
        mock_engine = MagicMock()
        mock_engine.send_hotkey = AsyncMock(return_value=ActuationActionResult(
            success=True,
            action_type="hotkey",
            message="Dispatched hotkey: ctrl+c"
        ))
        mock_get_engine.return_value = mock_engine

        res = await tool.execute({"hotkey_string": "ctrl+c"}, ctx)
        assert res.success is True
        assert res.data["keys"] == "ctrl+c"

@pytest.mark.asyncio
async def test_drag_and_drop_tool():
    tool = DragAndDropTool()
    ctx = ToolContext(task_id="test_actuation_5")

    with patch("src.tools.actuation_tools.get_actuation_engine") as mock_get_engine:
        mock_engine = MagicMock()
        mock_engine.drag_and_drop = AsyncMock(return_value=ActuationActionResult(
            success=True,
            action_type="drag_and_drop",
            target_x=400,
            target_y=400,
            verified_change=True,
            diff_score=0.22,
            message="Dragged from (100, 100) to (400, 400)"
        ))
        mock_get_engine.return_value = mock_engine

        res = await tool.execute({"start_x": 100, "start_y": 100, "end_x": 400, "end_y": 400}, ctx)
        assert res.success is True
        assert res.data["start"] == [100, 100]
        assert res.data["end"] == [400, 400]

@pytest.mark.asyncio
async def test_scroll_wheel_tool():
    tool = ScrollWheelTool()
    ctx = ToolContext(task_id="test_actuation_6")

    with patch("src.tools.actuation_tools.get_actuation_engine") as mock_get_engine:
        mock_engine = MagicMock()
        mock_engine.scroll = AsyncMock(return_value=ActuationActionResult(
            success=True,
            action_type="scroll",
            message="Scrolled down by 5 clicks"
        ))
        mock_get_engine.return_value = mock_engine

        res = await tool.execute({"clicks": 5, "direction": "down"}, ctx)
        assert res.success is True
        assert res.data["direction"] == "down"

def test_security_guard_actuation_risk():
    # Safe hotkey
    assert SecurityGuard.evaluate_tool_call("send_hotkey", {"keys": ["ctrl", "c"]}) == ActionRiskLevel.SAFE

    # Destructive / Close hotkeys
    assert SecurityGuard.evaluate_tool_call("send_hotkey", {"hotkey_string": "alt+f4"}) == ActionRiskLevel.MODERATE
    assert SecurityGuard.evaluate_tool_call("send_hotkey", {"hotkey_string": "ctrl+w"}) == ActionRiskLevel.MODERATE

    # Safe vs destructive element clicks
    assert SecurityGuard.evaluate_tool_call("click_element", {"element_name": "Submit"}) == ActionRiskLevel.SAFE
    assert SecurityGuard.evaluate_tool_call("click_element", {"element_name": "Delete Database"}) == ActionRiskLevel.MODERATE
