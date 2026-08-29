import os
from typing import Any, Dict, List, Optional
from .base import BaseTool, ToolContext, ToolResult
from src.perception.actuation import ActuationEngine
from src.security.guard import ActionRiskLevel
from src.security.redaction import SensitiveDataRedactor

# Shared singleton instance
_actuation_engine: Optional[ActuationEngine] = None

def get_actuation_engine() -> ActuationEngine:
    global _actuation_engine
    if _actuation_engine is None:
        _actuation_engine = ActuationEngine()
    return _actuation_engine

class ClickElementTool(BaseTool):
    """
    Hybrid UIA + Vision Element Clicker.
    Attempts resolution-independent Windows UIAutomation element lookup first,
    falling back to Vision LLM coordinate grounding, followed by closed-loop verification.
    """
    name = "click_element"
    description = (
        "Click a UI element by name, label, or automation ID (e.g. 'Save', 'File', 'Submit', 'OK', 'Close'). "
        "Uses Windows UIAutomation tree first, falls back to AI Vision grounding if custom UI, "
        "and automatically verifies that the click produced a visual state change."
    )
    parameters = {
        "type": "object",
        "properties": {
            "element_name": {
                "type": "string",
                "description": "Name, button text, or automation ID of the target element (e.g. 'Save', 'Start', 'Minimize')."
            },
            "window_title": {
                "type": "string",
                "description": "Optional title of the window containing the element to restrict search scope."
            },
            "button": {
                "type": "string",
                "enum": ["left", "right", "middle"],
                "default": "left",
                "description": "Mouse button to click (default: left)."
            },
            "double_click": {
                "type": "boolean",
                "default": False,
                "description": "Whether to perform a double-click."
            },
            "verify_change": {
                "type": "boolean",
                "default": True,
                "description": "Whether to verify that the click produced a visual screen change."
            }
        },
        "required": ["element_name"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_actuation_engine()
        el_name = str(args.get("element_name", "")).strip()
        win_title = args.get("window_title")
        btn = str(args.get("button", "left"))
        double = bool(args.get("double_click", False))
        verify = bool(args.get("verify_change", True))

        if not el_name:
            return ToolResult(success=False, data=None, error="No element_name provided.")

        # 1. Resolve Target via Hybrid 3-Tier Model
        target = await engine.resolve_target(element_name=el_name, window_title=win_title)
        if not target.found:
            return ToolResult(
                success=False,
                data={"element_name": el_name, "error": target.error},
                error=f"Element '{el_name}' not found: {target.error}"
            )

        # 2. Click with Closed-Loop Verification
        action = await engine.click(
            x=target.center_x,
            y=target.center_y,
            button=btn,
            double=double,
            verify=verify
        )

        return ToolResult(
            success=action.success,
            data={
                "element_name": target.element_name,
                "source_tier": target.source_tier,
                "clicked_x": target.center_x,
                "clicked_y": target.center_y,
                "control_type": target.control_type,
                "verified_change": action.verified_change,
                "diff_score": action.diff_score,
                "message": action.message,
                "before_image": action.before_image_path,
                "after_image": action.after_image_path
            }
        )

class ClickCoordinateTool(BaseTool):
    """
    Direct Coordinate Click Tool with DPI Scaling and Closed-Loop Verification.
    """
    name = "click_coordinate"
    description = (
        "Click a specific (x, y) screen pixel coordinate with DPI scaling and closed-loop visual change verification. "
        "Use when explicit coordinates are known from screenshot reasoning or OCR."
    )
    parameters = {
        "type": "object",
        "properties": {
            "x": {"type": "integer", "description": "X screen coordinate."},
            "y": {"type": "integer", "description": "Y screen coordinate."},
            "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"},
            "double_click": {"type": "boolean", "default": False},
            "verify_change": {"type": "boolean", "default": True}
        },
        "required": ["x", "y"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_actuation_engine()
        try:
            x = int(args.get("x", 0))
            y = int(args.get("y", 0))
        except (ValueError, TypeError):
            return ToolResult(success=False, data=None, error="Invalid (x, y) coordinates.")

        btn = str(args.get("button", "left"))
        double = bool(args.get("double_click", False))
        verify = bool(args.get("verify_change", True))

        action = await engine.click(x=x, y=y, button=btn, double=double, verify=verify)
        return ToolResult(
            success=action.success,
            data={
                "x": x,
                "y": y,
                "button": btn,
                "double_click": double,
                "verified_change": action.verified_change,
                "diff_score": action.diff_score,
                "message": action.message
            }
        )

class TypeTextTool(BaseTool):
    """
    Humanized Text Typing Tool.
    """
    name = "type_text"
    description = (
        "Type text into the currently focused input field or window with human-like keystroke intervals. "
        "Supports optional pre-clearing of text (Ctrl+A -> Backspace) and pressing Enter after typing."
    )
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Text to type into the active input."},
            "interval_ms": {"type": "integer", "default": 25, "description": "Delay between keystrokes in ms (default: 25)."},
            "clear_first": {"type": "boolean", "default": False, "description": "Select all and clear existing text before typing."},
            "press_enter": {"type": "boolean", "default": False, "description": "Press Enter after typing."}
        },
        "required": ["text"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_actuation_engine()
        text = str(args.get("text", ""))
        interval = int(args.get("interval_ms", 25))
        clear = bool(args.get("clear_first", False))
        press_enter = bool(args.get("press_enter", False))

        action = await engine.type_text(text=text, interval_ms=interval, clear_first=clear, press_enter=press_enter)
        return ToolResult(
            success=action.success,
            data={
                "characters_typed": len(text),
                "clear_first": clear,
                "press_enter": press_enter,
                "message": action.message
            }
        )

class SendHotkeyTool(BaseTool):
    """
    Keyboard Shortcut & Modifier Tool.
    """
    name = "send_hotkey"
    description = (
        "Send a keyboard shortcut combination to the active window. "
        "Examples: 'ctrl+c', 'ctrl+v', 'alt+f4', 'win+d', 'ctrl+shift+p', 'ctrl+s', 'enter', 'esc', 'tab'."
    )
    parameters = {
        "type": "object",
        "properties": {
            "keys": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of key names to press simultaneously (e.g. ['ctrl', 'c'] or ['alt', 'f4'])."
            },
            "hotkey_string": {
                "type": "string",
                "description": "Optional hotkey shorthand string (e.g. 'ctrl+shift+p' or 'win+r')."
            }
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_actuation_engine()
        keys = args.get("keys")
        hotkey_str = args.get("hotkey_string")

        target_keys = hotkey_str if hotkey_str else keys
        if not target_keys:
            return ToolResult(success=False, data=None, error="No keys or hotkey_string provided.")

        action = await engine.send_hotkey(target_keys)
        return ToolResult(
            success=action.success,
            data={"keys": target_keys, "message": action.message}
        )

class DragAndDropTool(BaseTool):
    """
    Smooth Mouse Drag and Drop Tool.
    """
    name = "drag_and_drop"
    description = "Perform a smooth mouse drag and drop operation between two screen coordinates."
    parameters = {
        "type": "object",
        "properties": {
            "start_x": {"type": "integer", "description": "Starting X screen coordinate."},
            "start_y": {"type": "integer", "description": "Starting Y screen coordinate."},
            "end_x": {"type": "integer", "description": "Destination X screen coordinate."},
            "end_y": {"type": "integer", "description": "Destination Y screen coordinate."},
            "duration_seconds": {"type": "number", "default": 0.5, "description": "Duration of drag motion in seconds."}
        },
        "required": ["start_x", "start_y", "end_x", "end_y"]
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_actuation_engine()
        try:
            sx = int(args.get("start_x", 0))
            sy = int(args.get("start_y", 0))
            ex = int(args.get("end_x", 0))
            ey = int(args.get("end_y", 0))
        except (ValueError, TypeError):
            return ToolResult(success=False, data=None, error="Invalid start or end coordinates.")

        duration = float(args.get("duration_seconds", 0.5))
        action = await engine.drag_and_drop(start_x=sx, start_y=sy, end_x=ex, end_y=ey, duration=duration)
        return ToolResult(
            success=action.success,
            data={
                "start": [sx, sy],
                "end": [ex, ey],
                "verified_change": action.verified_change,
                "diff_score": action.diff_score,
                "message": action.message
            }
        )

class ScrollWheelTool(BaseTool):
    """
    Mouse Scroll Wheel Tool.
    """
    name = "scroll_wheel"
    description = "Scroll the mouse wheel up, down, left, or right at the current or specified screen position."
    parameters = {
        "type": "object",
        "properties": {
            "clicks": {"type": "integer", "default": 5, "description": "Number of scroll clicks/ticks (default: 5)."},
            "direction": {"type": "string", "enum": ["up", "down", "left", "right"], "default": "down"},
            "x": {"type": "integer", "description": "Optional X coordinate to move cursor before scrolling."},
            "y": {"type": "integer", "description": "Optional Y coordinate to move cursor before scrolling."}
        }
    }
    risk_level = ActionRiskLevel.SAFE
    origin = "desktop"

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        engine = get_actuation_engine()
        clicks = int(args.get("clicks", 5))
        direction = str(args.get("direction", "down"))
        x = args.get("x")
        y = args.get("y")
        x_val = int(x) if x is not None else None
        y_val = int(y) if y is not None else None

        action = await engine.scroll(clicks=clicks, direction=direction, x=x_val, y=y_val)
        return ToolResult(
            success=action.success,
            data={"clicks": clicks, "direction": direction, "message": action.message}
        )
