"""
Lightweight animation utilities for the NIM JARVIS HUD.

CustomTkinter/Tkinter have no built-in tweening, easing, or alpha-blended
drawing. This module fills that gap with dependency-free helpers:
  - easing curves (so motion accelerates/decelerates instead of snapping)
  - a hex color interpolator (used to fake "glow"/"fade" against a known bg)
  - Tween: animate a value from A to B once, over N ms
  - Loop: repeat a 0->1->0 cycle forever (breathing/pulse effects)

Everything here runs on Tk's own event loop via `.after()` — never drive
these from a background thread, and always call `.cancel()` / `.stop()`
before destroying the widget they're attached to.
"""
import math
from typing import Callable, Optional


# ---- Easing -----------------------------------------------------------

def ease_out_cubic(t: float) -> float:
    """Fast start, gentle stop. The default 'this just settled into place' feel."""
    t = max(0.0, min(1.0, t))
    return 1 - pow(1 - t, 3)


def ease_in_out_sine(t: float) -> float:
    """Smooth accelerate/decelerate. Good for looping breathing/pulse motion."""
    t = max(0.0, min(1.0, t))
    return -(math.cos(math.pi * t) - 1) / 2


# ---- Color --------------------------------------------------------------

def _hex_to_rgb(color: str):
    color = color.lstrip("#")
    return tuple(int(color[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_color(c1: str, c2: str, t: float) -> str:
    """Interpolate between two '#rrggbb' colors. t=0 -> c1, t=1 -> c2."""
    r1, g1, b1 = _hex_to_rgb(c1)
    r2, g2, b2 = _hex_to_rgb(c2)
    r = round(lerp(r1, r2, t))
    g = round(lerp(g1, g2, t))
    b = round(lerp(b1, b2, t))
    return f"#{r:02x}{g:02x}{b:02x}"


# ---- Drivers --------------------------------------------------------------

class Tween:
    """Animate once from 0->1 (eased) over `duration_ms`, firing `on_update(t)` each frame."""

    def __init__(self, widget, duration_ms: int, on_update: Callable[[float], None],
                 easing: Callable[[float], float] = ease_out_cubic,
                 on_done: Optional[Callable[[], None]] = None, fps: int = 60):
        self.widget = widget
        self.duration_ms = max(1, duration_ms)
        self.on_update = on_update
        self.easing = easing
        self.on_done = on_done
        self.interval = max(1, int(1000 / fps))
        self._elapsed = 0
        self._job = None
        self._cancelled = False

    def start(self) -> "Tween":
        self._elapsed = 0
        self._cancelled = False
        self._tick()
        return self

    def cancel(self):
        self._cancelled = True
        if self._job is not None:
            try:
                self.widget.after_cancel(self._job)
            except Exception:
                pass
            self._job = None

    def _tick(self):
        if self._cancelled:
            return
        self._elapsed += self.interval
        t = min(1.0, self._elapsed / self.duration_ms)
        try:
            self.on_update(self.easing(t))
        except Exception:
            # Widget was likely destroyed mid-animation — stop quietly.
            self.cancel()
            return
        if t >= 1.0:
            if self.on_done:
                self.on_done()
            return
        self._job = self.widget.after(self.interval, self._tick)


class Loop:
    """Repeat a 0->1->0 ping-pong cycle forever (or 0->1 if ping_pong=False). For idle 'breathing' motion."""

    def __init__(self, widget, period_ms: int, on_update: Callable[[float], None],
                 easing: Callable[[float], float] = ease_in_out_sine, fps: int = 30,
                 ping_pong: bool = True):
        self.widget = widget
        self.period_ms = max(1, period_ms)
        self.on_update = on_update
        self.easing = easing
        self.interval = max(1, int(1000 / fps))
        self.ping_pong = ping_pong
        self._elapsed = 0
        self._job = None
        self._running = False

    def start(self) -> "Loop":
        self._running = True
        self._elapsed = 0
        self._tick()
        return self

    def stop(self):
        self._running = False
        if self._job is not None:
            try:
                self.widget.after_cancel(self._job)
            except Exception:
                pass
            self._job = None

    def _tick(self):
        if not self._running:
            return
        self._elapsed = (self._elapsed + self.interval) % self.period_ms
        t = self._elapsed / self.period_ms
        if self.ping_pong:
            t = t * 2 if t < 0.5 else 2 - t * 2
        try:
            self.on_update(self.easing(t))
        except Exception:
            self.stop()
            return
        self._job = self.widget.after(self.interval, self._tick)
