import asyncio
import ctypes
import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    import win32api
    import win32con
    import win32gui
    import win32process
    HAS_WIN32 = True
except ImportError:
    HAS_WIN32 = False

import psutil

logger = logging.getLogger(__name__)

# Common Windows application friendly aliases
COMMON_APP_ALIASES: Dict[str, str] = {
    "notepad": "notepad.exe",
    "calc": "calc.exe",
    "calculator": "calc.exe",
    "chrome": "chrome.exe",
    "google chrome": "chrome.exe",
    "edge": "msedge.exe",
    "microsoft edge": "msedge.exe",
    "vscode": "code.cmd",
    "vs code": "code.cmd",
    "code": "code.cmd",
    "terminal": "wt.exe",
    "windows terminal": "wt.exe",
    "explorer": "explorer.exe",
    "file explorer": "explorer.exe",
    "excel": "excel.exe",
    "word": "winword.exe",
    "powerpoint": "powerpnt.exe",
    "cmd": "cmd.exe",
    "command prompt": "cmd.exe",
    "powershell": "powershell.exe",
    "taskmgr": "taskmgr.exe",
    "task manager": "taskmgr.exe",
    "paint": "mspaint.exe",
    "control panel": "control.exe",
    "settings": "ms-settings:",
}

@dataclass
class WindowInfo:
    hwnd: int
    title: str
    process_name: str
    pid: int
    bounds: Dict[str, int]
    is_minimized: bool = False
    is_maximized: bool = False
    is_visible: bool = True
    monitor_index: int = 1

class WindowManager:
    """
    Intelligent Windows Application Launcher and Workspace Window Manager.
    Controls window focus, geometry, state, multi-monitor movement, and
    serializes/restores multi-app spatial layouts via SQLite memory.
    """

    def __init__(self):
        from src.agent.memory import get_memory_store
        self.memory_store = get_memory_store()

    # -------------------------------------------------------------------------
    # 1. App Launcher with Auto-Aliases
    # -------------------------------------------------------------------------

    @staticmethod
    def _query_registry_app_path(name: str) -> Optional[str]:
        """Queries Windows App Paths registry for installed application executables."""
        if os.name != "nt":
            return None
        try:
            import winreg
            clean = name.lower().strip()
            candidates = [clean, f"{clean}.exe"] if not clean.endswith(".exe") else [clean]
            for root in [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER]:
                for cand in candidates:
                    for subkey in [
                        rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{cand}",
                        rf"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\{cand}",
                    ]:
                        try:
                            with winreg.OpenKey(root, subkey) as k:
                                val, _ = winreg.QueryValueEx(k, "")
                                if val and os.path.exists(val):
                                    return val
                        except Exception:
                            pass
        except Exception:
            pass
        return None

    def resolve_app_executable(self, name_or_path: str) -> str:
        """Resolves a friendly application alias via registry, PATH, or Office standard directories."""
        clean = name_or_path.strip().lower()
        target = COMMON_APP_ALIASES.get(clean, clean)

        # 1. Direct which on PATH
        which_path = shutil.which(target) or shutil.which(clean) or shutil.which(f"{clean}.exe") or shutil.which(f"{clean}.cmd")
        if which_path:
            return which_path

        # 2. Windows App Paths registry lookup (Excel, Word, Chrome, Edge, etc.)
        reg_path = self._query_registry_app_path(target) or self._query_registry_app_path(clean)
        if reg_path:
            return reg_path

        # 3. Standard Program Files search for Office applications
        if clean in ["excel", "excel.exe", "word", "winword", "winword.exe", "powerpoint", "powerpnt", "powerpnt.exe"]:
            for drive in ["C:", "D:"]:
                for base in [
                    rf"{drive}\Program Files\Microsoft Office\root\Office16",
                    rf"{drive}\Program Files (x86)\Microsoft Office\root\Office16",
                    rf"{drive}\Program Files\Microsoft Office\Office16",
                    rf"{drive}\Program Files (x86)\Microsoft Office\Office16",
                    rf"{drive}\Program Files\Microsoft Office\Office15",
                ]:
                    cand = os.path.join(base, target if target.endswith(".exe") else f"{target}.exe")
                    if os.path.exists(cand):
                        return cand

        # 4. Standard Chrome / Edge search
        if clean in ["chrome", "google chrome"]:
            for p in [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
            ]:
                if os.path.exists(p):
                    return p

        return target

    async def open_application(
        self,
        name_or_path: str,
        args: Optional[List[str]] = None,
        wait_seconds: float = 1.5
    ) -> Dict[str, Any]:
        """
        Launches an application by friendly alias, registry path, or Windows shell start.
        """
        executable = self.resolve_app_executable(name_or_path)
        proc = None
        launched = False
        last_err = None

        # Method 1: Direct Popen if path exists
        if os.path.isabs(executable) and os.path.exists(executable):
            try:
                cmd = [executable] + (args or [])
                proc = subprocess.Popen(
                    cmd,
                    shell=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
                )
                launched = True
            except Exception as e:
                last_err = e

        # Method 2: os.startfile (Windows Shell Verb resolution)
        if not launched and os.name == "nt":
            try:
                target_to_start = executable if os.path.exists(executable) else name_or_path
                os.startfile(target_to_start)
                launched = True
            except Exception as e:
                last_err = e

        # Method 3: cmd.exe /c start "" "<target>"
        if not launched and os.name == "nt":
            try:
                arg_str = " ".join(args) if args else ""
                subprocess.Popen(
                    f'cmd.exe /c start "" "{executable}" {arg_str}',
                    shell=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
                launched = True
            except Exception as e:
                last_err = e

        # Method 4: Ultron Start Menu search fallback via keystrokes
        if not launched:
            try:
                import pyautogui
                pyautogui.press("win")
                await asyncio.sleep(0.6)
                pyautogui.write(name_or_path, interval=0.04)
                await asyncio.sleep(0.8)
                pyautogui.press("enter")
                launched = True
            except Exception as e:
                last_err = e

        if not launched:
            return {"success": False, "app_name": name_or_path, "error": str(last_err or "Unknown launch failure")}

        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)

        # Match newly opened or existing window
        matched_win = None
        clean_name = Path(name_or_path).stem.lower()
        all_wins = self.list_windows()
        for w in all_wins:
            if clean_name in w.process_name.lower() or clean_name in w.title.lower():
                matched_win = w
                break

        if matched_win:
            try:
                self.focus_window(matched_win.hwnd)
            except Exception:
                pass

        return {
            "success": True,
            "app_name": name_or_path,
            "executable": executable,
            "pid": proc.pid if proc else (matched_win.pid if matched_win else None),
            "window": matched_win.__dict__ if matched_win else None,
            "message": f"Launched '{name_or_path}' successfully"
        }

    # -------------------------------------------------------------------------
    # 2. Window Enumeration & Search
    # -------------------------------------------------------------------------

    def list_windows(self, include_invisible: bool = False) -> List[WindowInfo]:
        """Lists top-level windows on the desktop."""
        if not HAS_WIN32:
            return []

        windows: List[WindowInfo] = []

        def enum_callback(hwnd, _):
            if not win32gui.IsWindow(hwnd):
                return True

            is_vis = bool(win32gui.IsWindowVisible(hwnd))
            if not is_vis and not include_invisible:
                return True

            title = win32gui.GetWindowText(hwnd).strip()
            if not title and not include_invisible:
                return True

            # Filter out tooltips / zero-size overlays
            rect = win32gui.GetWindowRect(hwnd)
            left, top, right, bottom = rect
            width = right - left
            height = bottom - top
            if width <= 10 or height <= 10:
                return True

            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            proc_name = "unknown"
            try:
                p = psutil.Process(pid)
                proc_name = p.name()
            except Exception:
                pass

            # Ignore shell trays and internal worker windows
            if proc_name.lower() in ["shellexperiencehost.exe", "searchhost.exe"] and not include_invisible:
                return True

            # Determine minimized/maximized state
            placement = win32gui.GetWindowPlacement(hwnd)
            show_cmd = placement[1] if placement else win32con.SW_SHOWNORMAL
            is_min = (show_cmd == win32con.SW_SHOWMINIMIZED)
            is_max = (show_cmd == win32con.SW_SHOWMAXIMIZED)

            # Determine monitor index (simple primary vs secondary detection)
            mon_idx = 1
            if left < 0 or left >= 1920:
                mon_idx = 2

            windows.append(WindowInfo(
                hwnd=hwnd,
                title=title,
                process_name=proc_name,
                pid=pid,
                bounds={"left": left, "top": top, "right": right, "bottom": bottom, "width": width, "height": height},
                is_minimized=is_min,
                is_maximized=is_max,
                is_visible=is_vis,
                monitor_index=mon_idx
            ))
            return True

        try:
            win32gui.EnumWindows(enum_callback, None)
        except Exception as e:
            logger.debug("EnumWindows error: %s", e)

        return windows

    def find_window(self, pattern: Union[int, str]) -> Optional[WindowInfo]:
        """Finds a window by HWND integer or title/process substring regex."""
        if isinstance(pattern, int):
            for w in self.list_windows(include_invisible=True):
                if w.hwnd == pattern:
                    return w
            return None

        clean_pat = str(pattern).strip().lower()
        all_wins = self.list_windows()
        # 1. Exact match on title or process
        for w in all_wins:
            if clean_pat == w.title.lower() or clean_pat == w.process_name.lower() or clean_pat == Path(w.process_name).stem.lower():
                return w
        # 2. Substring match
        for w in all_wins:
            if clean_pat in w.title.lower() or clean_pat in w.process_name.lower():
                return w
        return None

    # -------------------------------------------------------------------------
    # 3. Focus, Close, Resize, State Control
    # -------------------------------------------------------------------------

    def focus_window(self, pattern: Union[int, str]) -> Dict[str, Any]:
        """Brings the target window to the foreground reliably."""
        if not HAS_WIN32:
            return {"success": False, "error": "Win32 API not available"}

        target = self.find_window(pattern)
        if not target:
            return {"success": False, "error": f"Window matching '{pattern}' not found"}

        hwnd = target.hwnd
        try:
            # Restore if minimized
            if target.is_minimized:
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)

            # Bypass Windows focus stealing lock using AttachThreadInput
            fore_hwnd = win32gui.GetForegroundWindow()
            if fore_hwnd != hwnd:
                fore_tid, _ = win32process.GetWindowThreadProcessId(fore_hwnd)
                cur_tid = win32api.GetCurrentThreadId()
                win32process.AttachThreadInput(cur_tid, fore_tid, True)
                try:
                    win32gui.BringWindowToTop(hwnd)
                    win32gui.SetForegroundWindow(hwnd)
                finally:
                    win32process.AttachThreadInput(cur_tid, fore_tid, False)
            else:
                win32gui.BringWindowToTop(hwnd)
                win32gui.SetForegroundWindow(hwnd)

            return {
                "success": True,
                "hwnd": hwnd,
                "title": target.title,
                "process_name": target.process_name,
                "message": f"Focused window: '{target.title}'"
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to focus window: {e}"}

    def close_window(self, pattern: Union[int, str], force: bool = False) -> Dict[str, Any]:
        """Closes target window gracefully via WM_CLOSE or force terminates."""
        if not HAS_WIN32:
            return {"success": False, "error": "Win32 API not available"}

        target = self.find_window(pattern)
        if not target:
            return {"success": False, "error": f"Window matching '{pattern}' not found"}

        hwnd = target.hwnd
        try:
            if force:
                p = psutil.Process(target.pid)
                p.terminate()
                return {"success": True, "title": target.title, "message": f"Force terminated process '{target.process_name}' (PID: {target.pid})"}

            # Graceful WM_CLOSE message
            win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            return {"success": True, "title": target.title, "message": f"Sent close signal to '{target.title}'"}
        except Exception as e:
            return {"success": False, "error": f"Failed to close window: {e}"}

    def set_window_geometry(
        self,
        pattern: Union[int, str],
        width: int,
        height: int,
        left: Optional[int] = None,
        top: Optional[int] = None
    ) -> Dict[str, Any]:
        """Resizes and positions the target window."""
        if not HAS_WIN32:
            return {"success": False, "error": "Win32 API not available"}

        target = self.find_window(pattern)
        if not target:
            return {"success": False, "error": f"Window matching '{pattern}' not found"}

        hwnd = target.hwnd
        cur_bounds = target.bounds
        target_left = left if left is not None else cur_bounds["left"]
        target_top = top if top is not None else cur_bounds["top"]

        try:
            # Restore if maximized/minimized before resizing
            if target.is_maximized or target.is_minimized:
                win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)

            win32gui.MoveWindow(hwnd, target_left, target_top, width, height, True)
            return {
                "success": True,
                "title": target.title,
                "bounds": {"left": target_left, "top": target_top, "width": width, "height": height},
                "message": f"Resized '{target.title}' to {width}x{height} at ({target_left}, {target_top})"
            }
        except Exception as e:
            return {"success": False, "error": f"Failed to resize window: {e}"}

    def set_window_state(self, pattern: Union[int, str], state: str) -> Dict[str, Any]:
        """Sets window state: 'minimize', 'maximize', or 'restore'."""
        if not HAS_WIN32:
            return {"success": False, "error": "Win32 API not available"}

        target = self.find_window(pattern)
        if not target:
            return {"success": False, "error": f"Window matching '{pattern}' not found"}

        hwnd = target.hwnd
        cmd_map = {
            "minimize": win32con.SW_MINIMIZE,
            "maximize": win32con.SW_MAXIMIZE,
            "restore": win32con.SW_RESTORE,
            "hide": win32con.SW_HIDE,
            "show": win32con.SW_SHOW
        }

        st = state.strip().lower()
        if st not in cmd_map:
            return {"success": False, "error": f"Invalid state '{state}'. Choose from: minimize, maximize, restore, hide, show"}

        try:
            win32gui.ShowWindow(hwnd, cmd_map[st])
            return {"success": True, "title": target.title, "state": st, "message": f"Set '{target.title}' to {st}"}
        except Exception as e:
            return {"success": False, "error": f"Failed to set window state: {e}"}

    def move_to_monitor(self, pattern: Union[int, str], monitor_index: int = 1) -> Dict[str, Any]:
        """Moves window to the specified monitor (1 = primary, 2 = secondary)."""
        target = self.find_window(pattern)
        if not target:
            return {"success": False, "error": f"Window matching '{pattern}' not found"}

        # Basic multi-monitor coordinate offsets (Assuming standard 1920x1080 layouts)
        offset_x = 0 if monitor_index == 1 else 1920
        return self.set_window_geometry(
            pattern=target.hwnd,
            left=offset_x + 100,
            top=100,
            width=target.bounds.get("width", 1200),
            height=target.bounds.get("height", 800)
        )

    # -------------------------------------------------------------------------
    # 4. Memory-Aware Workspace Snapshots
    # -------------------------------------------------------------------------

    def save_workspace_layout(self, name: str, description: str = "") -> Dict[str, Any]:
        """
        Snapshots all currently open visible windows and their coordinates
        into episodic SQLite memory.
        """
        all_wins = self.list_windows()
        windows_data = []

        for w in all_wins:
            if not w.is_minimized and w.title:
                windows_data.append({
                    "title": w.title,
                    "process_name": w.process_name,
                    "bounds": w.bounds,
                    "is_maximized": w.is_maximized,
                    "monitor_index": w.monitor_index
                })

        self.memory_store.save_workspace(
            name=name,
            description=description or f"Workspace snapshot with {len(windows_data)} windows",
            windows=windows_data
        )

        return {
            "success": True,
            "workspace_name": name,
            "saved_windows_count": len(windows_data),
            "windows": windows_data,
            "message": f"Saved workspace layout '{name}' ({len(windows_data)} apps)"
        }

    async def restore_workspace_layout(self, name: str) -> Dict[str, Any]:
        """
        Restores a saved workspace layout from memory: launches any missing apps,
        repositions all windows to their exact saved coordinates, and restores window states.
        """
        workspace = self.memory_store.get_workspace(name)
        if not workspace:
            return {"success": False, "error": f"Workspace layout '{name}' not found in memory"}

        saved_windows = workspace.get("windows", [])
        restored_count = 0

        for win_data in saved_windows:
            proc_name = win_data.get("process_name", "")
            title = win_data.get("title", "")
            bounds = win_data.get("bounds", {})

            # 1. Check if window already exists
            existing = self.find_window(title) or self.find_window(proc_name)
            if not existing and proc_name:
                # Launch the app
                await self.open_application(proc_name, wait_seconds=1.2)
                existing = self.find_window(proc_name)

            # 2. Position the window
            if existing and bounds:
                w = bounds.get("width", 1000)
                h = bounds.get("height", 700)
                left = bounds.get("left", 50)
                top = bounds.get("top", 50)
                self.set_window_geometry(existing.hwnd, width=w, height=h, left=left, top=top)

                if win_data.get("is_maximized"):
                    self.set_window_state(existing.hwnd, "maximize")

                restored_count += 1

        return {
            "success": True,
            "workspace_name": name,
            "restored_count": restored_count,
            "total_saved": len(saved_windows),
            "message": f"Restored workspace layout '{name}' ({restored_count}/{len(saved_windows)} windows positioned)"
        }
