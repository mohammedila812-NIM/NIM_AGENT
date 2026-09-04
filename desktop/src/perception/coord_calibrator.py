"""
coord_calibrator.py
-------------------
DPI-aware screen coordinate calibration engine for NIM JARVIS.

Ported and significantly extended from the standalone screen-coord-tool.

Key features:
  - Multi-monitor support (offset-aware)
  - DPI scale detection via Windows LOGPIXELSX + per-monitor DPI
  - Viewer-image-click → physical screen coordinate mapping
  - Normalized bounding-box mapping (for Gemini vision [ymin,xmin,ymax,xmax])
  - Named anchor store (persist/restore UI element positions)
  - Thread-safe singleton calibrator per monitor

Usage:
    from src.perception.coord_calibrator import get_calibrator, CalibratedPoint

    cal = get_calibrator(monitor_index=1)
    cal.set_viewer_size(viewer_w=1280, viewer_h=720)

    # Map a click from a screenshot viewer
    point = cal.map(viewer_x=640, viewer_y=360, label="center")

    # Map a Gemini bbox [ymin,xmin,ymax,xmax] in 0-1000 space
    center = cal.map_normalized_bbox([200, 300, 400, 600], coord_range=1000)
"""

from __future__ import annotations

import ctypes
import json
import os
import sys
import threading
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import mss

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class MonitorInfo:
    """Raw monitor geometry from mss + DPI scale."""
    monitor_index: int
    left: int
    top: int
    width: int           # logical (OS-reported) pixels
    height: int
    dpi_scale: float     # e.g. 1.5 for 150% Windows scaling
    physical_width: int  # actual captured pixel count (width * dpi_scale)
    physical_height: int


@dataclass
class CalibratedPoint:
    """A fully resolved screen coordinate with traceability metadata."""
    screen_x: int         # absolute physical screen coords (pyautogui-ready)
    screen_y: int
    viewer_x: Optional[int] = None    # source viewer click (if applicable)
    viewer_y: Optional[int] = None
    monitor_index: int = 1
    label: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)

    def __str__(self) -> str:
        lbl = f" [{self.label}]" if self.label else ""
        return f"screen=({self.screen_x}, {self.screen_y}){lbl}"


@dataclass
class CoordAnchor:
    """A saved named screen position for a known UI element."""
    name: str
    screen_x: int
    screen_y: int
    monitor_index: int = 1
    description: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# DPI Detection
# ---------------------------------------------------------------------------

def get_primary_dpi_scale() -> float:
    """
    Detect the primary monitor DPI scale on Windows.
    Returns 1.0 on non-Windows or on error.
    """
    if sys.platform != "win32":
        return 1.0
    try:
        # Request per-monitor DPI awareness
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass
    try:
        hdc = ctypes.windll.user32.GetDC(0)
        logpx = ctypes.windll.gdi32.GetDeviceCaps(hdc, 88)  # LOGPIXELSX
        ctypes.windll.user32.ReleaseDC(0, hdc)
        return max(1.0, logpx / 96.0)
    except Exception:
        return 1.0


def get_dpi_for_monitor(monitor_index: int = 1) -> float:
    """
    Per-monitor DPI via Windows SetThreadDpiAwarenessContext.
    Falls back to primary DPI on older Windows or non-Windows.
    """
    if sys.platform != "win32":
        return 1.0
    try:
        with mss.mss() as sct:
            monitors = sct.monitors
            if monitor_index >= len(monitors):
                return get_primary_dpi_scale()
            mon = monitors[monitor_index]
            # Get a window handle for the monitor's top-left corner
            hwnd = ctypes.windll.user32.WindowFromPoint(
                ctypes.wintypes.POINT(mon["left"] + 1, mon["top"] + 1)
            )
            if hwnd:
                dpi = ctypes.windll.user32.GetDpiForWindow(hwnd)
                if dpi > 0:
                    return dpi / 96.0
    except Exception:
        pass
    return get_primary_dpi_scale()


# ---------------------------------------------------------------------------
# Monitor Query
# ---------------------------------------------------------------------------

def list_monitors() -> List[Dict]:
    """Return metadata for all connected monitors."""
    dpi = get_primary_dpi_scale()
    with mss.mss() as sct:
        result = []
        for i, mon in enumerate(sct.monitors):
            result.append({
                "index": i,
                "left": mon["left"],
                "top": mon["top"],
                "width": mon["width"],
                "height": mon["height"],
                "dpi_scale": dpi,
                "label": "All monitors" if i == 0 else f"Monitor {i}",
            })
        return result


def get_monitor_info(monitor_index: int = 1) -> MonitorInfo:
    """
    Capture monitor geometry and DPI info without grabbing pixels.
    Uses a tiny 1x1 mss grab just to get sct.monitors metadata.
    """
    dpi = get_dpi_for_monitor(monitor_index)
    with mss.mss() as sct:
        monitors = sct.monitors
        idx = min(monitor_index, len(monitors) - 1)
        mon = monitors[idx]
        # Physical pixels = logical * dpi (mss reports logical on DPI-aware process)
        # We estimate physical from a short grab
        tiny = {"left": mon["left"], "top": mon["top"], "width": 1, "height": 1}
        raw = sct.grab(tiny)
        # Scale factor embedded in mss raw size vs bbox
        # For full-monitor physical size: width*dpi_scale
        phys_w = int(round(mon["width"] * dpi))
        phys_h = int(round(mon["height"] * dpi))
        return MonitorInfo(
            monitor_index=idx,
            left=mon["left"],
            top=mon["top"],
            width=mon["width"],
            height=mon["height"],
            dpi_scale=dpi,
            physical_width=phys_w,
            physical_height=phys_h,
        )


# ---------------------------------------------------------------------------
# Anchor Store (persistent JSON)
# ---------------------------------------------------------------------------

_ANCHOR_DIR = Path.home() / ".nim_jarvis" / "coord_anchors"


class AnchorStore:
    """
    Persist named screen anchors (UI element positions) to disk as JSON.
    Thread-safe reads and writes.
    """

    def __init__(self, path: Path = _ANCHOR_DIR / "anchors.json"):
        self._path = path
        self._lock = threading.Lock()
        self._anchors: Dict[str, CoordAnchor] = {}
        self._load()

    def _load(self) -> None:
        try:
            if self._path.exists():
                data = json.loads(self._path.read_text(encoding="utf-8"))
                self._anchors = {k: CoordAnchor(**v) for k, v in data.items()}
        except Exception:
            self._anchors = {}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps({k: v.to_dict() for k, v in self._anchors.items()}, indent=2),
            encoding="utf-8"
        )
        tmp.replace(self._path)

    def save(self, anchor: CoordAnchor) -> None:
        with self._lock:
            self._anchors[anchor.name] = anchor
            self._save()

    def get(self, name: str) -> Optional[CoordAnchor]:
        with self._lock:
            return self._anchors.get(name)

    def list(self) -> List[CoordAnchor]:
        with self._lock:
            return list(self._anchors.values())

    def delete(self, name: str) -> bool:
        with self._lock:
            if name in self._anchors:
                del self._anchors[name]
                self._save()
                return True
            return False

    def clear(self) -> None:
        with self._lock:
            self._anchors.clear()
            self._save()


# ---------------------------------------------------------------------------
# Core Calibrator
# ---------------------------------------------------------------------------

class CoordinateCalibrator:
    """
    Maps viewer-image click coordinates → real physical screen coordinates.

    Handles:
      - DPI scaling (LOGPIXELSX / per-monitor DPI API)
      - Multi-monitor absolute offset
      - Viewer resize (call set_viewer_size after each resize)
      - Normalized bbox mapping (Gemini vision output [ymin,xmin,ymax,xmax])

    Example::

        cal = CoordinateCalibrator(monitor_index=1)
        cal.set_viewer_size(1280, 720)

        # Click in viewer window at (320, 180)
        pt = cal.map(320, 180, label="top-left-quarter")
        pyautogui.click(pt.screen_x, pt.screen_y)
    """

    def __init__(self, monitor_index: int = 1, force_dpi: Optional[float] = None):
        self.monitor_index = monitor_index
        self._info: MonitorInfo = get_monitor_info(monitor_index)
        if force_dpi is not None:
            self._info.dpi_scale = force_dpi
            self._info.physical_width = int(round(self._info.width * force_dpi))
            self._info.physical_height = int(round(self._info.height * force_dpi))

        self._viewer_w: Optional[int] = None
        self._viewer_h: Optional[int] = None
        self._history: List[CalibratedPoint] = []

    # ---- Configuration ----

    def set_viewer_size(self, viewer_w: int, viewer_h: int) -> None:
        """Update whenever the viewer/display widget is resized."""
        self._viewer_w = viewer_w
        self._viewer_h = viewer_h

    @property
    def is_ready(self) -> bool:
        return self._viewer_w is not None and self._viewer_h is not None

    @property
    def monitor_info(self) -> MonitorInfo:
        return self._info

    def refresh_monitor_info(self) -> None:
        """Re-query DPI and monitor geometry (e.g. after DPI change event)."""
        self._info = get_monitor_info(self.monitor_index)

    # ---- Mapping ----

    def map(
        self,
        viewer_x: int,
        viewer_y: int,
        label: Optional[str] = None,
    ) -> CalibratedPoint:
        """
        Map a click at (viewer_x, viewer_y) in a screenshot viewer window
        to an absolute screen coordinate usable by pyautogui/win32api.

        The displayed screenshot image may be a different size than the
        physical screen; we compensate for:
          1. The display scale (viewer size vs physical pixel count)
          2. DPI scaling (physical vs logical Windows coords)
          3. Monitor offset (for multi-monitor absolute positioning)
        """
        if not self.is_ready:
            raise RuntimeError(
                "Call set_viewer_size(w, h) before mapping coordinates."
            )

        si = self._info

        # Step 1: viewer pixels → physical screenshot pixels
        scale_x = si.physical_width / self._viewer_w
        scale_y = si.physical_height / self._viewer_h
        phys_x = viewer_x * scale_x
        phys_y = viewer_y * scale_y

        # Step 2: physical pixels → logical Windows coordinates (undo DPI)
        logical_x = phys_x / si.dpi_scale
        logical_y = phys_y / si.dpi_scale

        # Step 3: add monitor top-left offset (multi-monitor absolute)
        screen_x = int(round(logical_x)) + si.left
        screen_y = int(round(logical_y)) + si.top

        point = CalibratedPoint(
            screen_x=screen_x,
            screen_y=screen_y,
            viewer_x=viewer_x,
            viewer_y=viewer_y,
            monitor_index=self.monitor_index,
            label=label,
        )
        self._history.append(point)
        return point

    def map_normalized_bbox(
        self,
        bbox: List[float],
        coord_range: float = 1000.0,
        label: Optional[str] = None,
    ) -> CalibratedPoint:
        """
        Map a normalized bounding box (as returned by Gemini vision)
        to an absolute center screen coordinate.

        Args:
            bbox: [ymin, xmin, ymax, xmax] in 0..coord_range space.
            coord_range: the range the bbox values are expressed in (default 1000).
            label: optional label for the resulting point.

        Returns:
            CalibratedPoint at the center of the bounding box.
        """
        ymin, xmin, ymax, xmax = bbox
        norm_cx = ((xmin + xmax) / 2.0) / coord_range
        norm_cy = ((ymin + ymax) / 2.0) / coord_range

        si = self._info
        # Logical center on this monitor
        logical_x = int(round(norm_cx * si.width))
        logical_y = int(round(norm_cy * si.height))

        screen_x = logical_x + si.left
        screen_y = logical_y + si.top

        point = CalibratedPoint(
            screen_x=screen_x,
            screen_y=screen_y,
            viewer_x=None,
            viewer_y=None,
            monitor_index=self.monitor_index,
            label=label,
        )
        self._history.append(point)
        return point

    def map_fraction(
        self,
        fx: float,
        fy: float,
        label: Optional[str] = None,
    ) -> CalibratedPoint:
        """
        Map fractional (0.0–1.0) coordinates relative to this monitor.

        Args:
            fx: 0.0 = left edge, 1.0 = right edge of monitor
            fy: 0.0 = top edge, 1.0 = bottom edge of monitor
        """
        si = self._info
        screen_x = int(round(fx * si.width)) + si.left
        screen_y = int(round(fy * si.height)) + si.top
        point = CalibratedPoint(
            screen_x=screen_x,
            screen_y=screen_y,
            monitor_index=self.monitor_index,
            label=label,
        )
        self._history.append(point)
        return point

    # ---- History ----

    def history(self) -> List[CalibratedPoint]:
        return list(self._history)

    def clear_history(self) -> None:
        self._history.clear()

    def summary(self) -> List[dict]:
        return [p.to_dict() for p in self._history]


# ---------------------------------------------------------------------------
# Thread-safe singleton per monitor
# ---------------------------------------------------------------------------

_calibrators: Dict[int, CoordinateCalibrator] = {}
_cal_lock = threading.Lock()


def get_calibrator(monitor_index: int = 1) -> CoordinateCalibrator:
    """Return (or create) the singleton calibrator for a given monitor."""
    with _cal_lock:
        if monitor_index not in _calibrators:
            _calibrators[monitor_index] = CoordinateCalibrator(monitor_index)
        return _calibrators[monitor_index]


# Singleton anchor store
_anchor_store: Optional[AnchorStore] = None
_anchor_store_lock = threading.Lock()


def get_anchor_store() -> AnchorStore:
    global _anchor_store
    with _anchor_store_lock:
        if _anchor_store is None:
            _anchor_store = AnchorStore()
        return _anchor_store
