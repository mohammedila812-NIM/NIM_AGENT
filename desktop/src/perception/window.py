import os
import sys
from typing import Any, Dict, List, Optional

if sys.platform == "win32":
    try:
        import win32con
        import win32gui
        import win32process
    except ImportError:
        win32con = win32gui = win32process = None
else:
    win32con = win32gui = win32process = None

class WindowInspector:
    """
    Inspects active desktop windows, process hierarchy, and UI Automation metadata.
    Detects virtual / remote desktop sessions where UI trees are absent.
    """

    @classmethod
    def get_foreground_window_info(cls) -> Dict[str, Any]:
        """Returns details about the currently active foreground window."""
        if os.name != "nt":
            return {"platform": sys.platform, "supported": False}

        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return {"hwnd": 0, "title": "", "process_name": "unknown", "is_valid": False}

        title = win32gui.GetWindowText(hwnd)
        rect = win32gui.GetWindowRect(hwnd)
        left, top, right, bottom = rect
        width = max(0, right - left)
        height = max(0, bottom - top)

        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        process_name = "unknown"
        try:
            import psutil
            p = psutil.Process(pid)
            process_name = p.name()
        except Exception:
            pass

        is_visible = bool(win32gui.IsWindowVisible(hwnd))
        is_minimized = bool(win32gui.IsIconic(hwnd))

        return {
            "hwnd": hwnd,
            "title": title,
            "process_name": process_name,
            "pid": pid,
            "bounds": {
                "left": left,
                "top": top,
                "right": right,
                "bottom": bottom,
                "width": width,
                "height": height
            },
            "is_visible": is_visible,
            "is_minimized": is_minimized,
            "is_valid": bool(hwnd and is_visible and width > 0 and height > 0)
        }

    @classmethod
    def list_visible_windows(cls) -> List[Dict[str, Any]]:
        """Lists all currently visible top-level desktop windows."""
        windows = []

        def enum_cb(hwnd, extra):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                rect = win32gui.GetWindowRect(hwnd)
                w = rect[2] - rect[0]
                h = rect[3] - rect[1]
                if title and w > 50 and h > 50:
                    _, pid = win32process.GetWindowThreadProcessId(hwnd)
                    windows.append({
                        "hwnd": hwnd,
                        "title": title,
                        "pid": pid,
                        "bounds": {"left": rect[0], "top": rect[1], "width": w, "height": h}
                    })
            return True

        if os.name == "nt":
            try:
                win32gui.EnumWindows(enum_cb, None)
            except Exception:
                pass

        return windows

    @classmethod
    def inspect_ui_tree(cls, hwnd: int) -> Dict[str, Any]:
        """
        Attempts to read UI Automation accessibility elements for a window.
        If no elements are returned, flags as a possible Citrix/RDP/VDI environment.
        """
        elements = []
        is_remote_vdi = False

        if os.name == "nt":
            try:
                # Basic child control enumeration
                def enum_child(child_hwnd, _):
                    c_title = win32gui.GetWindowText(child_hwnd)
                    c_class = win32gui.GetClassName(child_hwnd)
                    c_rect = win32gui.GetWindowRect(child_hwnd)
                    if win32gui.IsWindowVisible(child_hwnd):
                        elements.append({
                            "hwnd": child_hwnd,
                            "name": c_title,
                            "class_name": c_class,
                            "bounds": {"left": c_rect[0], "top": c_rect[1], "width": c_rect[2] - c_rect[0], "height": c_rect[3] - c_rect[1]}
                        })
                    return True

                win32gui.EnumChildWindows(hwnd, enum_child, None)

                # If a large top-level window has zero child controls, it is likely rendering via canvas / remote VDI
                rect = win32gui.GetWindowRect(hwnd)
                if len(elements) == 0 and (rect[2] - rect[0]) > 400 and (rect[3] - rect[1]) > 400:
                    is_remote_vdi = True

            except Exception:
                pass

        return {
            "hwnd": hwnd,
            "element_count": len(elements),
            "elements": elements[:50],  # cap at 50 to keep prompt compact
            "is_remote_or_canvas_rendered": is_remote_vdi,
            "accessibility_supported": len(elements) > 0
        }
