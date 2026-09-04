"""
screen_coord_tools.py
---------------------
Advanced screen coordinate tools for NIM JARVIS.

Integrates CoordinateCalibrator with:
  - DPI-aware, calibrated mouse click (GroundedMouseClickTool)
  - Gemini vision-based UI element location → click (LocateAndClickUIElementTool)
  - Visual element bounding box inspection (LocateUIElementVisualTool)
  - Named anchor save/get/list (SaveCoordAnchorTool, GetCoordAnchorTool, ListCoordAnchorsTool)
  - Monitor listing (ListMonitorsTool)
  - Coordinate calibration helper (CalibrateCoordinatesTool)
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import time
from typing import Any, Dict, List, Optional

import pyautogui

from src.security.guard import ActionRiskLevel
from src.tools.base import BaseTool, ToolContext, ToolResult
from src.perception.coord_calibrator import (
    CalibratedPoint,
    CoordAnchor,
    get_calibrator,
    get_anchor_store,
    list_monitors,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _take_screenshot_b64(monitor_index: int = 1) -> tuple[str, int, int]:
    """Capture a monitor screenshot and return (base64_png, width, height)."""
    import mss
    from PIL import Image

    with mss.mss() as sct:
        monitors = sct.monitors
        idx = min(monitor_index, len(monitors) - 1)
        mon = monitors[idx]
        raw = sct.grab(mon)
        img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return base64.b64encode(buf.getvalue()).decode(), img.width, img.height


def _gemini_locate_element(
    image_b64: str,
    element_description: str,
    api_key: str,
) -> Optional[List[float]]:
    """
    Call Gemini vision to locate a UI element and return
    [ymin, xmin, ymax, xmax] in 0–1000 normalized coords.
    Returns None on failure.
    """
    import httpx

    prompt = (
        f"You are a computer vision assistant. Look at this screenshot and find: "
        f'"{element_description}"\n\n'
        f"Return ONLY a JSON object with the bounding box of the element:\n"
        f'  {{"bbox": [ymin, xmin, ymax, xmax]}}\n'
        f"where coordinates are in 0–1000 range (0=top/left, 1000=bottom/right).\n"
        f"If not found, return: {{\"bbox\": null}}"
    )

    payload = {
        "contents": [{
            "parts": [
                {
                    "inline_data": {
                        "mime_type": "image/png",
                        "data": image_b64,
                    }
                },
                {"text": prompt},
            ]
        }],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 200},
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    try:
        resp = httpx.post(url, json=payload, timeout=30)
        resp.raise_for_status()
        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:-1])
        data = json.loads(text)
        return data.get("bbox")
    except Exception as exc:
        logger.warning("Gemini element locate failed: %s", exc)
        return None


def _get_gemini_key() -> Optional[str]:
    """Retrieve Gemini API key from OS SecretStore, env vars, or local config."""
    try:
        from src.security.secrets import get_secret_store
        store = get_secret_store()
        key = store.get_key("gemini")
        if key:
            return key
    except Exception:
        pass

    try:
        import os
        for k in ["GEMINI_API_KEY", "NIM_GEMINI_KEY", "NIM_GEMINI_API_KEY", "GOOGLE_API_KEY"]:
            if k in os.environ and os.environ[k].strip():
                return os.environ[k].strip()

        # Try local secrets config
        import pathlib
        nim_dir = pathlib.Path.home() / ".nim_jarvis"
        secrets_file = nim_dir / "secrets.json"
        if secrets_file.exists():
            data = json.loads(secrets_file.read_text())
            return data.get("gemini_api_key") or data.get("GEMINI_API_KEY") or data.get("gemini")
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Tool: List Monitors
# ---------------------------------------------------------------------------

class ListMonitorsTool(BaseTool):
    name = "list_monitors"
    description = (
        "List all connected monitors with their index, resolution, position, and DPI scale. "
        "Use to identify which monitor_index to use for coordinate operations."
    )
    parameters = {
        "type": "object",
        "properties": {},
        "required": [],
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            monitors = list_monitors()
            return ToolResult(success=True, data=monitors)
        except Exception as exc:
            return ToolResult(success=False, data=None, error=str(exc))


# ---------------------------------------------------------------------------
# Tool: Calibrate Coordinates (set viewer size)
# ---------------------------------------------------------------------------

class CalibrateCoordinatesTool(BaseTool):
    name = "calibrate_screen_coordinates"
    description = (
        "Initialize the coordinate calibrator for a monitor by setting the viewer "
        "display size. Must be called before using grounded_mouse_click with viewer coordinates. "
        "Set viewer_width and viewer_height to the pixel dimensions of your screenshot viewer window."
    )
    parameters = {
        "type": "object",
        "properties": {
            "viewer_width": {
                "type": "integer",
                "description": "Width in pixels of the screenshot viewer display area.",
            },
            "viewer_height": {
                "type": "integer",
                "description": "Height in pixels of the screenshot viewer display area.",
            },
            "monitor_index": {
                "type": "integer",
                "description": "Monitor index (1=primary, 2=secondary, etc.). Default: 1.",
                "default": 1,
            },
        },
        "required": ["viewer_width", "viewer_height"],
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            vw = int(args["viewer_width"])
            vh = int(args["viewer_height"])
            mon = int(args.get("monitor_index", 1))
            cal = get_calibrator(mon)
            cal.set_viewer_size(vw, vh)
            info = cal.monitor_info
            return ToolResult(success=True, data={
                "status": "calibrated",
                "viewer_size": f"{vw}x{vh}",
                "monitor_index": mon,
                "monitor_logical": f"{info.width}x{info.height}",
                "monitor_physical": f"{info.physical_width}x{info.physical_height}",
                "dpi_scale": info.dpi_scale,
            })
        except Exception as exc:
            return ToolResult(success=False, data=None, error=str(exc))


# ---------------------------------------------------------------------------
# Tool: Grounded Mouse Click (DPI-calibrated)
# ---------------------------------------------------------------------------

class GroundedMouseClickTool(BaseTool):
    name = "grounded_mouse_click"
    description = (
        "Perform a DPI-calibrated mouse click at a position in a screenshot viewer window. "
        "Converts viewer-pixel coordinates to exact physical screen coordinates, compensating "
        "for DPI scaling and multi-monitor offsets. "
        "calibrate_screen_coordinates must be called first to set the viewer size. "
        "Supports left/right/double click and optional move-only mode."
    )
    parameters = {
        "type": "object",
        "properties": {
            "viewer_x": {
                "type": "integer",
                "description": "X coordinate in the screenshot viewer window (pixels from left).",
            },
            "viewer_y": {
                "type": "integer",
                "description": "Y coordinate in the screenshot viewer window (pixels from top).",
            },
            "monitor_index": {
                "type": "integer",
                "description": "Monitor index (1=primary). Default: 1.",
                "default": 1,
            },
            "button": {
                "type": "string",
                "enum": ["left", "right", "double"],
                "description": "Mouse button to click. Default: left.",
                "default": "left",
            },
            "move_only": {
                "type": "boolean",
                "description": "If true, only move the mouse without clicking.",
                "default": False,
            },
            "label": {
                "type": "string",
                "description": "Optional label for this click (for logging/anchors).",
            },
        },
        "required": ["viewer_x", "viewer_y"],
    }
    risk_level = ActionRiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            vx = int(args["viewer_x"])
            vy = int(args["viewer_y"])
            mon = int(args.get("monitor_index", 1))
            button = str(args.get("button", "left"))
            move_only = bool(args.get("move_only", False))
            label = args.get("label")

            cal = get_calibrator(mon)
            if not cal.is_ready:
                return ToolResult(
                    success=False,
                    data=None,
                    error=(
                        "Coordinate calibrator not initialized. "
                        "Call calibrate_screen_coordinates first."
                    ),
                )

            point = cal.map(vx, vy, label=label)

            if move_only:
                pyautogui.moveTo(point.screen_x, point.screen_y, duration=0.15)
                action = "moved"
            elif button == "double":
                pyautogui.doubleClick(point.screen_x, point.screen_y)
                action = "double-clicked"
            elif button == "right":
                pyautogui.rightClick(point.screen_x, point.screen_y)
                action = "right-clicked"
            else:
                pyautogui.click(point.screen_x, point.screen_y)
                action = "clicked"

            return ToolResult(success=True, data={
                "action": action,
                "screen_x": point.screen_x,
                "screen_y": point.screen_y,
                "viewer_x": vx,
                "viewer_y": vy,
                "monitor": mon,
                "label": label,
            })
        except Exception as exc:
            logger.error("GroundedMouseClickTool error: %s", exc, exc_info=True)
            return ToolResult(success=False, data=None, error=str(exc),
                              risk_level=ActionRiskLevel.MODERATE)


# ---------------------------------------------------------------------------
# Tool: Locate UI Element Visually (Gemini Vision → bbox → click)
# ---------------------------------------------------------------------------

class LocateUIElementVisualTool(BaseTool):
    name = "locate_ui_element_visual"
    description = (
        "Use Gemini vision to find a UI element on screen by text description. "
        "Takes a screenshot, sends it to Gemini to get the bounding box, and returns "
        "the center screen coordinates. Optionally clicks the element. "
        "Works with DPI scaling and multi-monitor setups."
    )
    parameters = {
        "type": "object",
        "properties": {
            "element_description": {
                "type": "string",
                "description": (
                    "Natural-language description of the UI element to find. "
                    "Examples: 'Submit button', 'Search box', 'File menu item', "
                    "'Close window X button in top-right'."
                ),
            },
            "monitor_index": {
                "type": "integer",
                "description": "Monitor to capture and search (1=primary). Default: 1.",
                "default": 1,
            },
            "click": {
                "type": "boolean",
                "description": "If true, click the element after locating it. Default: false.",
                "default": False,
            },
            "button": {
                "type": "string",
                "enum": ["left", "right", "double"],
                "description": "Button to use if click=true. Default: left.",
                "default": "left",
            },
            "save_as_anchor": {
                "type": "string",
                "description": "If provided, save the found location as a named anchor.",
            },
        },
        "required": ["element_description"],
    }
    risk_level = ActionRiskLevel.MODERATE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        description = str(args["element_description"])
        mon = int(args.get("monitor_index", 1))
        do_click = bool(args.get("click", False))
        button = str(args.get("button", "left"))
        anchor_name = args.get("save_as_anchor")

        api_key = _get_gemini_key()
        if not api_key:
            return ToolResult(
                success=False, data=None,
                error="Gemini API key not found. Set GEMINI_API_KEY environment variable."
            )

        try:
            # Capture screenshot in thread pool (mss is sync)
            loop = asyncio.get_event_loop()
            img_b64, img_w, img_h = await loop.run_in_executor(
                None, _take_screenshot_b64, mon
            )

            # Ask Gemini to locate the element
            bbox = await loop.run_in_executor(
                None, _gemini_locate_element, img_b64, description, api_key
            )

            if not bbox:
                return ToolResult(
                    success=False, data=None,
                    error=f"Gemini could not locate '{description}' on screen."
                )

            # Map bbox → screen coords
            cal = get_calibrator(mon)
            point = cal.map_normalized_bbox(bbox, coord_range=1000, label=description)

            result_data: Dict[str, Any] = {
                "element_description": description,
                "bbox_normalized": bbox,
                "screen_x": point.screen_x,
                "screen_y": point.screen_y,
                "monitor": mon,
                "clicked": False,
            }

            # Optionally save anchor
            if anchor_name:
                store = get_anchor_store()
                store.save(CoordAnchor(
                    name=anchor_name,
                    screen_x=point.screen_x,
                    screen_y=point.screen_y,
                    monitor_index=mon,
                    description=description,
                ))
                result_data["anchor_saved"] = anchor_name

            # Optionally click
            if do_click:
                if button == "double":
                    pyautogui.doubleClick(point.screen_x, point.screen_y)
                elif button == "right":
                    pyautogui.rightClick(point.screen_x, point.screen_y)
                else:
                    pyautogui.click(point.screen_x, point.screen_y)
                result_data["clicked"] = True
                result_data["click_button"] = button

            return ToolResult(success=True, data=result_data)

        except Exception as exc:
            logger.error("LocateUIElementVisualTool error: %s", exc, exc_info=True)
            return ToolResult(success=False, data=None, error=str(exc),
                              risk_level=ActionRiskLevel.MODERATE)


# ---------------------------------------------------------------------------
# Tool: Save Coord Anchor
# ---------------------------------------------------------------------------

class SaveCoordAnchorTool(BaseTool):
    name = "save_coord_anchor"
    description = (
        "Save a named screen coordinate anchor for a UI element or location. "
        "Use this to bookmark frequently used screen positions (e.g. 'send_button', "
        "'taskbar_search'). Anchors persist between sessions."
    )
    parameters = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Unique anchor name (e.g. 'send_button', 'taskbar_search').",
            },
            "screen_x": {
                "type": "integer",
                "description": "Absolute screen X coordinate.",
            },
            "screen_y": {
                "type": "integer",
                "description": "Absolute screen Y coordinate.",
            },
            "monitor_index": {
                "type": "integer",
                "description": "Monitor index this anchor belongs to. Default: 1.",
                "default": 1,
            },
            "description": {
                "type": "string",
                "description": "Optional human-readable description of what this anchor points to.",
                "default": "",
            },
        },
        "required": ["name", "screen_x", "screen_y"],
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            anchor = CoordAnchor(
                name=str(args["name"]),
                screen_x=int(args["screen_x"]),
                screen_y=int(args["screen_y"]),
                monitor_index=int(args.get("monitor_index", 1)),
                description=str(args.get("description", "")),
            )
            get_anchor_store().save(anchor)
            return ToolResult(success=True, data={
                "saved": anchor.name,
                "screen_x": anchor.screen_x,
                "screen_y": anchor.screen_y,
            })
        except Exception as exc:
            return ToolResult(success=False, data=None, error=str(exc))


# ---------------------------------------------------------------------------
# Tool: Get Coord Anchor
# ---------------------------------------------------------------------------

class GetCoordAnchorTool(BaseTool):
    name = "get_coord_anchor"
    description = (
        "Retrieve a saved screen coordinate anchor by name. "
        "Returns the absolute screen coordinates for a previously saved anchor."
    )
    parameters = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The anchor name to retrieve.",
            },
            "click": {
                "type": "boolean",
                "description": "If true, click the anchor position after retrieving it.",
                "default": False,
            },
        },
        "required": ["name"],
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            name = str(args["name"])
            do_click = bool(args.get("click", False))
            anchor = get_anchor_store().get(name)
            if anchor is None:
                return ToolResult(
                    success=False, data=None,
                    error=f"Anchor '{name}' not found. Use list_coord_anchors to see all saved anchors."
                )
            result_data = anchor.to_dict()
            if do_click:
                pyautogui.click(anchor.screen_x, anchor.screen_y)
                result_data["clicked"] = True
            return ToolResult(success=True, data=result_data)
        except Exception as exc:
            return ToolResult(success=False, data=None, error=str(exc))


# ---------------------------------------------------------------------------
# Tool: List Coord Anchors
# ---------------------------------------------------------------------------

class ListCoordAnchorsTool(BaseTool):
    name = "list_coord_anchors"
    description = (
        "List all saved screen coordinate anchors. "
        "Returns all named positions that have been saved with save_coord_anchor."
    )
    parameters = {
        "type": "object",
        "properties": {},
        "required": [],
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            anchors = get_anchor_store().list()
            return ToolResult(success=True, data=[a.to_dict() for a in anchors])
        except Exception as exc:
            return ToolResult(success=False, data=None, error=str(exc))


# ---------------------------------------------------------------------------
# Tool: Delete Coord Anchor
# ---------------------------------------------------------------------------

class DeleteCoordAnchorTool(BaseTool):
    name = "delete_coord_anchor"
    description = "Delete a saved screen coordinate anchor by name."
    parameters = {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The anchor name to delete.",
            }
        },
        "required": ["name"],
    }
    risk_level = ActionRiskLevel.SAFE

    async def execute(self, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            name = str(args["name"])
            deleted = get_anchor_store().delete(name)
            if not deleted:
                return ToolResult(success=False, data=None,
                                  error=f"Anchor '{name}' not found.")
            return ToolResult(success=True, data={"deleted": name})
        except Exception as exc:
            return ToolResult(success=False, data=None, error=str(exc))


# ---------------------------------------------------------------------------
# Registry helper
# ---------------------------------------------------------------------------

def register_screen_coord_tools(registry) -> None:
    """Register all screen coordinate tools into the given UnifiedToolRegistry."""
    tools = [
        ListMonitorsTool(),
        CalibrateCoordinatesTool(),
        GroundedMouseClickTool(),
        LocateUIElementVisualTool(),
        SaveCoordAnchorTool(),
        GetCoordAnchorTool(),
        ListCoordAnchorsTool(),
        DeleteCoordAnchorTool(),
    ]
    for tool in tools:
        registry.register(tool)
    logger.info("Registered %d screen coordinate tools.", len(tools))
