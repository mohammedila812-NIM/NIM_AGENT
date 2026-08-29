import asyncio
import ctypes
import logging
import math
import os
import random
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union

from PIL import Image
import pyautogui

from src.perception.screen import ScreenCaptureEngine
from src.perception.verify import ActionVerifier
from src.perception.window import WindowInspector
from src.security.redaction import SensitiveDataRedactor

logger = logging.getLogger(__name__)

# Configure PyAutoGUI safety settings
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

@dataclass
class ActuationTargetResult:
    found: bool
    source_tier: str  # "uia", "vision", "coordinate", or "none"
    center_x: int = 0
    center_y: int = 0
    bounds: Dict[str, int] = field(default_factory=dict)
    element_name: str = ""
    control_type: str = ""
    error: Optional[str] = None

@dataclass
class ActuationActionResult:
    success: bool
    action_type: str
    target_x: Optional[int] = None
    target_y: Optional[int] = None
    verified_change: bool = False
    diff_score: float = 0.0
    before_image_path: Optional[str] = None
    after_image_path: Optional[str] = None
    message: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

class ActuationEngine:
    """
    Hybrid GUI Actuation Engine for NIM JARVIS Desktop.
    Provides resolution-independent UIA element targeting, fallback vision grounding,
    DPI-scaled bezier mouse movement, humanized keyboard input, and closed-loop verification.
    """

    def __init__(self):
        self.screen_engine = ScreenCaptureEngine()
        self._ensure_dpi_awareness()

    def _safe_cursor_guard(self):
        """Prevents PyAutoGUI FailSafeException if cursor is resting in any screen corner."""
        try:
            cur_x, cur_y = pyautogui.position()
            sw, sh = pyautogui.size()
            is_corner = (
                (cur_x <= 2 and cur_y <= 2) or
                (cur_x <= 2 and cur_y >= sh - 3) or
                (cur_x >= sw - 3 and cur_y <= 2) or
                (cur_x >= sw - 3 and cur_y >= sh - 3)
            )
            if is_corner:
                # Safely disengage cursor from corner to center
                import ctypes
                ctypes.windll.user32.SetCursorPos(sw // 2, sh // 2)
        except Exception:
            pass

    def _ensure_dpi_awareness(self):
        """Ensures process is DPI aware for pixel-perfect coordinates."""
        if os.name == "nt":
            try:
                ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
            except Exception:
                try:
                    ctypes.windll.shcore.SetProcessDpiAwareness(2)
                except Exception:
                    pass

    def get_screen_size(self) -> Tuple[int, int]:
        """Returns primary screen dimensions (width, height)."""
        return pyautogui.size()

    # -------------------------------------------------------------------------
    # Tier 1: Windows UIAutomation (UIA) Search
    # -------------------------------------------------------------------------

    def find_element_via_uia(
        self,
        element_name: str,
        window_title: Optional[str] = None,
        control_type: Optional[str] = None
    ) -> ActuationTargetResult:
        """
        Searches the Windows UIAutomation accessibility tree for an element
        matching the name, automation id, or control type.
        """
        clean_target = element_name.strip().lower()
        if not clean_target:
            return ActuationTargetResult(found=False, source_tier="none", error="Empty element target name")

        try:
            from pywinauto import Desktop
            app_desktop = Desktop(backend="uia")

            # Determine target window handle
            hwnd = None
            if window_title:
                win_wrapper = app_desktop.window(title_re=f"(?i).*{re.escape(window_title)}.*")
                if win_wrapper.exists():
                    hwnd = win_wrapper.handle
            
            if not hwnd:
                fg_info = WindowInspector.get_foreground_window_info()
                hwnd = fg_info.get("hwnd")

            if not hwnd:
                return ActuationTargetResult(found=False, source_tier="uia", error="No active window found")

            # Inspect UI tree elements
            elements = WindowInspector.inspect_ui_tree(hwnd, max_depth=4)
            for el in elements:
                name = str(el.get("name", "")).strip().lower()
                auto_id = str(el.get("automation_id", "")).strip().lower()
                c_type = str(el.get("control_type", "")).strip().lower()

                # Filter by control_type if requested
                if control_type and control_type.lower() not in c_type:
                    continue

                if clean_target in name or clean_target in auto_id or (name and name in clean_target):
                    b = el.get("bounds", {})
                    w, h = b.get("width", 0), b.get("height", 0)
                    left, top = b.get("left", 0), b.get("top", 0)
                    if w > 0 and h > 0:
                        cx = left + w // 2
                        cy = top + h // 2
                        return ActuationTargetResult(
                            found=True,
                            source_tier="uia",
                            center_x=cx,
                            center_y=cy,
                            bounds=b,
                            element_name=el.get("name", element_name),
                            control_type=el.get("control_type", "")
                        )

            # Secondary deep traversal using pywinauto wrapper if basic tree missed it
            try:
                target_win = app_desktop.window(handle=hwnd)
                ctrls = target_win.descendants()
                for c in ctrls[:80]:  # Limit search breadth
                    txt = (c.window_text() or "").lower()
                    c_id = (c.automation_id() or "").lower()
                    if clean_target in txt or clean_target in c_id:
                        rect = c.rectangle()
                        cx = (rect.left + rect.right) // 2
                        cy = (rect.top + rect.bottom) // 2
                        return ActuationTargetResult(
                            found=True,
                            source_tier="uia",
                            center_x=cx,
                            center_y=cy,
                            bounds={"left": rect.left, "top": rect.top, "width": rect.width(), "height": rect.height()},
                            element_name=c.window_text() or element_name,
                            control_type=c.friendly_class_name()
                        )
            except Exception:
                pass

        except Exception as e:
            logger.debug("UIA element search error: %s", e)

        return ActuationTargetResult(found=False, source_tier="uia", error=f"Element '{element_name}' not found in UIA tree")

    # -------------------------------------------------------------------------
    # Tier 2: Vision LLM Grounding Search
    # -------------------------------------------------------------------------

    async def find_element_via_vision(
        self,
        element_name: str,
        image_path: Optional[str] = None
    ) -> ActuationTargetResult:
        """
        Uses the Vision LLM (e.g. NVIDIA Vision) to identify the center pixel coordinate
        of an element when UIA accessibility is unavailable (e.g. Canvas, Games, Citrix).
        """
        try:
            from src.llm.vision import get_vision_client
            vision_client = get_vision_client()

            # Ensure image capture
            if not image_path or not os.path.exists(image_path):
                img = self.screen_engine.capture_full_screen()
                image_path = self.screen_engine.save_capture(img)
            else:
                img = Image.open(image_path)

            width, height = img.size
            prompt = (
                f"Identify the precise screen coordinates for the UI element: '{element_name}'.\n"
                f"Image resolution: {width}x{height}.\n"
                "Return ONLY a JSON block with the format: {\"found\": true, \"x\": <int_x>, \"y\": <int_y>, \"description\": \"...\"}"
            )

            res = await vision_client.describe_image(img, prompt=prompt, detail="high")
            if res.get("success"):
                desc = res.get("description", "")
                match = re.search(r"\{\s*\"found\"\s*:\s*true.*?\"x\"\s*:\s*(\d+).*?\"y\"\s*:\s*(\d+)", desc, re.DOTALL)
                if match:
                    x, y = int(match.group(1)), int(match.group(2))
                    return ActuationTargetResult(
                        found=True,
                        source_tier="vision",
                        center_x=x,
                        center_y=y,
                        element_name=element_name,
                        bounds={"left": x - 10, "top": y - 10, "width": 20, "height": 20}
                    )

        except Exception as e:
            logger.debug("Vision grounding element search error: %s", e)

        return ActuationTargetResult(found=False, source_tier="vision", error=f"Element '{element_name}' could not be grounded by Vision LLM")

    # -------------------------------------------------------------------------
    # Target Resolution (Hybrid 3-Tier)
    # -------------------------------------------------------------------------

    async def resolve_target(
        self,
        element_name: Optional[str] = None,
        x: Optional[int] = None,
        y: Optional[int] = None,
        window_title: Optional[str] = None
    ) -> ActuationTargetResult:
        """
        Resolves a target using the 3-Tier model:
        1. If explicit (x, y) provided -> Tier 3 Coordinate
        2. Else try Tier 1 Windows UIA tree
        3. Else fallback to Tier 2 Vision LLM Grounding
        """
        if x is not None and y is not None:
            return ActuationTargetResult(
                found=True,
                source_tier="coordinate",
                center_x=int(x),
                center_y=int(y),
                element_name=element_name or f"({x}, {y})"
            )

        if not element_name:
            return ActuationTargetResult(found=False, source_tier="none", error="Neither element_name nor (x, y) coordinates provided")

        # Tier 1: Windows UIAutomation
        uia_res = self.find_element_via_uia(element_name, window_title=window_title)
        if uia_res.found:
            return uia_res

        # Tier 2: Vision LLM Grounding
        vision_res = await self.find_element_via_vision(element_name)
        if vision_res.found:
            return vision_res

        return ActuationTargetResult(
            found=False,
            source_tier="none",
            error=f"Could not locate element '{element_name}' via UIA or Vision Grounding"
        )

    # -------------------------------------------------------------------------
    # Actuation Primitives (Mouse, Bezier Interpolation, Typing, Hotkeys)
    # -------------------------------------------------------------------------

    def move_mouse_smoothly(self, target_x: int, target_y: int, duration: float = 0.2):
        """Moves cursor to target using cubic bezier curve easing for natural human motion."""
        self._safe_cursor_guard()
        try:
            cur_x, cur_y = pyautogui.position()
            if cur_x == target_x and cur_y == target_y:
                return

            steps = max(10, int(duration * 60))
            # Control points for bezier curve
            ctrl_x = cur_x + (target_x - cur_x) * 0.5 + random.randint(-20, 20)
            ctrl_y = cur_y + (target_y - cur_y) * 0.5 + random.randint(-20, 20)

            for i in range(1, steps + 1):
                t = i / steps
                # Quadratic Bezier: B(t) = (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
                bx = (1 - t)**2 * cur_x + 2 * (1 - t) * t * ctrl_x + t**2 * target_x
                by = (1 - t)**2 * cur_y + 2 * (1 - t) * t * ctrl_y + t**2 * target_y
                pyautogui.moveTo(int(bx), int(by))
                time.sleep(duration / steps)

            pyautogui.moveTo(target_x, target_y)
        except Exception:
            try:
                pyautogui.moveTo(target_x, target_y)
            except Exception:
                pass

    async def click(
        self,
        x: int,
        y: int,
        button: str = "left",
        double: bool = False,
        verify: bool = True
    ) -> ActuationActionResult:
        """
        Performs mouse click at (x, y) with optional closed-loop perceptual verification.
        """
        self._safe_cursor_guard()
        before_img_path = None
        after_img_path = None
        verified = False
        diff_score = 0.0

        if verify:
            before_img = self.screen_engine.capture_full_screen()
            before_img_path = self.screen_engine.save_capture(before_img)

        # Move and Click
        self.move_mouse_smoothly(x, y, duration=0.15)
        try:
            if double:
                pyautogui.doubleClick(x, y, button=button)
            else:
                pyautogui.click(x, y, button=button)
        except Exception:
            # Direct win32 fallback if PyAutoGUI triggered corner failsafe
            try:
                import win32api
                import win32con
                win32api.SetCursorPos((x, y))
                down_evt = win32con.MOUSEEVENTF_RIGHTDOWN if button == "right" else win32con.MOUSEEVENTF_LEFTDOWN
                up_evt = win32con.MOUSEEVENTF_RIGHTUP if button == "right" else win32con.MOUSEEVENTF_LEFTUP
                win32api.mouse_event(down_evt, x, y, 0, 0)
                win32api.mouse_event(up_evt, x, y, 0, 0)
                if double:
                    time.sleep(0.05)
                    win32api.mouse_event(down_evt, x, y, 0, 0)
                    win32api.mouse_event(up_evt, x, y, 0, 0)
            except Exception as e:
                return ActuationActionResult(success=False, action_type="click", message=f"Click failed: {e}")

        await asyncio.sleep(0.3)  # Wait for UI reaction

        if verify:
            after_img = self.screen_engine.capture_full_screen()
            after_img_path = self.screen_engine.save_capture(after_img)
            diff_res = ActionVerifier.verify_screen_change(before_img, after_img)
            verified = diff_res.get("changed", False)
            diff_score = diff_res.get("diff_score", 0.0)

        action_desc = f"{'Double-clicked' if double else 'Clicked'} {button} button at ({x}, {y})"
        return ActuationActionResult(
            success=True,
            action_type="click",
            target_x=x,
            target_y=y,
            verified_change=verified,
            diff_score=diff_score,
            before_image_path=before_img_path,
            after_image_path=after_img_path,
            message=action_desc
        )

    async def type_text(
        self,
        text: str,
        interval_ms: int = 25,
        clear_first: bool = False,
        press_enter: bool = False
    ) -> ActuationActionResult:
        """
        Types text with human-like keystroke intervals into the currently focused input.
        """
        self._safe_cursor_guard()
        prev_fs = pyautogui.FAILSAFE
        try:
            pyautogui.FAILSAFE = False
            if clear_first:
                pyautogui.hotkey("ctrl", "a")
                time.sleep(0.05)
                pyautogui.press("backspace")
                time.sleep(0.05)

            interval_sec = max(0.005, interval_ms / 1000.0)
            for ch in text:
                pyautogui.write(ch)
                time.sleep(interval_sec + random.uniform(-0.005, 0.01))

            if press_enter:
                time.sleep(0.05)
                pyautogui.press("enter")
        except Exception as e:
            return ActuationActionResult(success=False, action_type="type_text", message=f"Typing failed: {e}")
        finally:
            pyautogui.FAILSAFE = prev_fs

        return ActuationActionResult(
            success=True,
            action_type="type_text",
            message=f"Typed {len(text)} characters" + (" and pressed Enter" if press_enter else "")
        )

    async def send_hotkey(self, keys: Union[List[str], str]) -> ActuationActionResult:
        """
        Dispatches keyboard shortcut (e.g. ['ctrl', 'c'] or 'ctrl+shift+p').
        """
        self._safe_cursor_guard()
        if isinstance(keys, str):
            key_list = [k.strip().lower() for k in keys.replace("+", " ").replace("-", " ").split()]
        else:
            key_list = [k.strip().lower() for k in keys]

        if not key_list:
            return ActuationActionResult(success=False, action_type="hotkey", message="No hotkey combinations specified")

        # Map friendly names to PyAutoGUI key constants
        key_map = {
            "control": "ctrl",
            "cmd": "win",
            "windows": "win",
            "super": "win",
            "return": "enter",
            "escape": "esc",
        }
        normalized = [key_map.get(k, k) for k in key_list]
        prev_fs = pyautogui.FAILSAFE
        try:
            pyautogui.FAILSAFE = False
            pyautogui.hotkey(*normalized)
        except Exception as e:
            return ActuationActionResult(success=False, action_type="hotkey", message=f"Hotkey failed: {e}")
        finally:
            pyautogui.FAILSAFE = prev_fs

        return ActuationActionResult(
            success=True,
            action_type="hotkey",
            message=f"Dispatched hotkey: {'+'.join(normalized)}"
        )

    async def drag_and_drop(
        self,
        start_x: int,
        start_y: int,
        end_x: int,
        end_y: int,
        duration: float = 0.5,
        verify: bool = True
    ) -> ActuationActionResult:
        """Performs smooth drag-and-drop between two coordinates."""
        before_img_path = None
        after_img_path = None
        verified = False
        diff_score = 0.0

        if verify:
            before_img = self.screen_engine.capture_full_screen()
            before_img_path = self.screen_engine.save_capture(before_img)

        self.move_mouse_smoothly(start_x, start_y, duration=0.15)
        pyautogui.mouseDown(button="left")
        time.sleep(0.1)
        self.move_mouse_smoothly(end_x, end_y, duration=duration)
        time.sleep(0.1)
        pyautogui.mouseUp(button="left")
        await asyncio.sleep(0.3)

        if verify:
            after_img = self.screen_engine.capture_full_screen()
            after_img_path = self.screen_engine.save_capture(after_img)
            diff_res = ActionVerifier.verify_screen_change(before_img, after_img)
            verified = diff_res.get("changed", False)
            diff_score = diff_res.get("diff_score", 0.0)

        return ActuationActionResult(
            success=True,
            action_type="drag_and_drop",
            target_x=end_x,
            target_y=end_y,
            verified_change=verified,
            diff_score=diff_score,
            before_image_path=before_img_path,
            after_image_path=after_img_path,
            message=f"Dragged from ({start_x}, {start_y}) to ({end_x}, {end_y})"
        )

    async def scroll(self, clicks: int, direction: str = "down", x: Optional[int] = None, y: Optional[int] = None) -> ActuationActionResult:
        """Scrolls mouse wheel at optional position."""
        if x is not None and y is not None:
            self.move_mouse_smoothly(x, y, duration=0.1)

        amount = abs(clicks) * (1 if direction.lower() in ["up", "right"] else -1)
        if direction.lower() in ["left", "right"]:
            pyautogui.hscroll(amount)
        else:
            pyautogui.scroll(amount)

        return ActuationActionResult(
            success=True,
            action_type="scroll",
            message=f"Scrolled {direction} by {abs(clicks)} clicks"
        )
