import math
import random
import sys
import threading
import time
from typing import Callable, List, Optional

import tkinter as tk
import customtkinter as ctk

from .theme import THEME
from .anim import Tween, Loop, lerp_color, ease_out_cubic
from .acrylic import apply_acrylic


class JarvisHUDOverlay:
    """
    Futuristic Floating Desktop HUD & Overlay for NIM JARVIS.
    Translucent, frameless, always-on-top interface with a live thought stream,
    a breathing reactor status glow, a reactive waveform, and instant desktop
    inspection tools.
    """

    # Visual/behavioral profile per agent state. Feeds the waveform + reactor glow.
    _MODES = {
        "idle":      {"color": THEME["accent_glow"],   "status": "ONLINE",    "amp": 0.18},
        "listening": {"color": THEME["accent_green"],  "status": "LISTENING", "amp": 0.55},
        "thinking":  {"color": THEME["accent_amber"],  "status": "THINKING",  "amp": 0.35},
        "speaking":  {"color": THEME["accent_cyan"],   "status": "SPEAKING",  "amp": 0.70},
        "approval":  {"color": THEME["accent_amber"],  "status": "NEEDS APPROVAL", "amp": 0.10},
        "error":     {"color": THEME["accent_magenta"],"status": "ERROR",     "amp": 0.10},
    }

    def __init__(self, on_submit_goal: Optional[Callable[[str], None]] = None):
        self.on_submit_goal = on_submit_goal
        self.root: Optional[ctk.CTk] = None
        self._is_expanded = True
        self._cur_w, self._cur_h = 640, 360
        self._thought_text = "JARVIS Core Online. Ready for autonomous desktop tasks."
        self._active_tools: List[str] = []

        self._mode = "idle"
        self._wave_amp = self._MODES["idle"]["amp"]
        self._wave_bar_count = 9
        self._wave_cur = [2.0] * self._wave_bar_count
        self._wave_running = False

        self._glow_loop: Optional[Loop] = None
        self._pulse_loop: Optional[Loop] = None
        self._reveal_job = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start_in_thread(self):
        """Launches the HUD overlay in a dedicated UI thread."""
        ui_thread = threading.Thread(target=self._run_ui, daemon=True)
        ui_thread.start()

    def _run_ui(self):
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.root = ctk.CTk()
        self.root.title("NIM JARVIS HUD")
        self.root.geometry(f"{self._cur_w}x{self._cur_h}+50+50")
        self.root.overrideredirect(True)  # Frameless window
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.96)  # Fallback translucency (see acrylic below)
        self.root.configure(fg_color=THEME["bg_dark"])

        self._build_ui()
        self._enable_drag_window()

        # Best-effort *real* blur-behind on Windows 10/11. Silently no-ops
        # elsewhere, in which case the flat -alpha above is still in effect.
        self.root.after(50, lambda: apply_acrylic(self.root, THEME["bg_dark"], opacity=190))

        self._start_ambient_animations()
        self.root.mainloop()

    def _build_ui(self):
        if not self.root:
            return

        # Main Container
        self.main_card = ctk.CTkFrame(
            self.root,
            fg_color=THEME["card_bg"],
            border_color=THEME["accent_cyan"],
            border_width=1.5,
            corner_radius=THEME["radius_card"],
        )
        self.main_card.pack(fill="both", expand=True, padx=8, pady=8)

        # Thin top highlight line — the classic glass-panel "light catching the
        # top edge" cue. Cheap to draw, does a lot of work for the glass read.
        glass_edge = ctk.CTkFrame(
            self.main_card, fg_color=THEME["glass_highlight"], height=2, corner_radius=0
        )
        glass_edge.pack(fill="x", side="top")

        # 1. Header Bar (Reactor glow + Title + Status + Waveform + Controls)
        header = ctk.CTkFrame(self.main_card, fg_color="transparent")
        header.pack(fill="x", padx=16, pady=(10, 6))

        title_box = ctk.CTkFrame(header, fg_color="transparent")
        title_box.pack(side="left")

        # Reactor: a small canvas instead of a static "⚡" label, so it can
        # actually breathe (pulsing glow) instead of sitting there inert.
        self.reactor_canvas = tk.Canvas(
            title_box, width=30, height=30, bg=THEME["card_bg"],
            highlightthickness=0, bd=0,
        )
        self.reactor_canvas.pack(side="left", padx=(0, 8))

        title_lbl = ctk.CTkLabel(
            title_box, text="NIM JARVIS",
            font=(THEME["font_family"], 14, "bold"), text_color=THEME["text_primary"],
        )
        title_lbl.pack(side="left")

        status_box = ctk.CTkFrame(title_box, fg_color="transparent")
        status_box.pack(side="left", padx=(10, 0))

        self.status_canvas = tk.Canvas(
            status_box, width=14, height=14, bg=THEME["card_bg"],
            highlightthickness=0, bd=0,
        )
        self.status_canvas.pack(side="left", padx=(0, 4))

        self.status_label = ctk.CTkLabel(
            status_box, text="ONLINE",
            font=(THEME["font_family"], 10, "bold"), text_color=THEME["accent_green"],
        )
        self.status_label.pack(side="left")

        # Live waveform — idle sway when nothing's happening, reacts to
        # set_mode()/set_amplitude() once wired to real STT/TTS levels.
        self.wave_canvas = tk.Canvas(
            header, width=90, height=20, bg=THEME["card_bg"],
            highlightthickness=0, bd=0,
        )
        self.wave_canvas.pack(side="left", padx=(14, 0))

        # Window Controls
        ctrl_box = ctk.CTkFrame(header, fg_color="transparent")
        ctrl_box.pack(side="right")

        min_btn = ctk.CTkButton(
            ctrl_box, text="—", width=24, height=24,
            fg_color=THEME["card_border"], hover_color=THEME["accent_glow"],
            command=self._toggle_expand,
        )
        min_btn.pack(side="left", padx=3)

        close_btn = ctk.CTkButton(
            ctrl_box, text="✕", width=24, height=24,
            fg_color="#3a1c28", hover_color=THEME["accent_magenta"],
            command=self.root.withdraw,
        )
        close_btn.pack(side="left", padx=3)

        # 2. Live Thought Stream Ticker
        thought_frame = ctk.CTkFrame(
            self.main_card, fg_color=THEME["card_bg_soft"],
            border_color=THEME["card_border"], border_width=1, corner_radius=8,
        )
        thought_frame.pack(fill="x", padx=16, pady=6)

        self.thought_lbl = ctk.CTkLabel(
            thought_frame, text=f"↳ {self._thought_text}",
            font=(THEME["font_mono"], 11), text_color=THEME["accent_cyan"],
            anchor="w", wraplength=580, justify="left",
        )
        self.thought_lbl.pack(fill="x", padx=12, pady=8)

        # 3. Action Badges Strip
        self.badge_strip = ctk.CTkFrame(self.main_card, fg_color="transparent")
        self.badge_strip.pack(fill="x", padx=16, pady=4)
        self._update_badges(["Ready", "Screen Perception Active", "Voice Ready"])

        # 4. Interactive Input Box & Goal Dispatcher
        input_box = ctk.CTkFrame(self.main_card, fg_color="transparent")
        input_box.pack(fill="x", padx=16, pady=8)

        self.goal_entry = ctk.CTkEntry(
            input_box,
            placeholder_text="Enter goal or ask JARVIS to inspect desktop / analyze sheets...",
            fg_color="#080e1a", border_color=THEME["card_border"],
            text_color=THEME["text_primary"], font=(THEME["font_family"], 12), height=36,
        )
        self.goal_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))
        self.goal_entry.bind("<Return>", lambda e: self._on_dispatch())

        dispatch_btn = ctk.CTkButton(
            input_box, text="Execute ⚡", font=(THEME["font_family"], 12, "bold"),
            fg_color=THEME["accent_cyan"], text_color="#000000",
            hover_color=THEME["accent_glow"], width=100, height=36,
            command=self._on_dispatch,
        )
        dispatch_btn.pack(side="right")

        # 5. Quick Action Ribbon
        quick_ribbon = ctk.CTkFrame(self.main_card, fg_color="transparent")
        quick_ribbon.pack(fill="x", padx=16, pady=(4, 12))

        btn_inspect = ctk.CTkButton(
            quick_ribbon, text="📊 Analyze Screen", font=(THEME["font_family"], 11),
            fg_color=THEME["card_border"], hover_color=THEME["accent_glow"], height=28,
            command=lambda: self._quick_action("Analyze current screen window and report findings"),
        )
        btn_inspect.pack(side="left", padx=(0, 6))

        btn_undo = ctk.CTkButton(
            quick_ribbon, text="⏪ Undo Action", font=(THEME["font_family"], 11),
            fg_color=THEME["card_border"], hover_color=THEME["accent_amber"], height=28,
            command=lambda: self._quick_action("/undo"),
        )
        btn_undo.pack(side="left", padx=6)

    def _enable_drag_window(self):
        """Allows click-and-drag window movement for the frameless window."""
        def start_move(event):
            self.root.x = event.x
            self.root.y = event.y

        def do_move(event):
            deltax = event.x - self.root.x
            deltay = event.y - self.root.y
            x = self.root.winfo_x() + deltax
            y = self.root.winfo_y() + deltay
            self.root.geometry(f"+{x}+{y}")

        self.main_card.bind("<ButtonPress-1>", start_move)
        self.main_card.bind("<B1-Motion>", do_move)

    # ------------------------------------------------------------------
    # Ambient animation (reactor breathing, status pulse, waveform)
    # ------------------------------------------------------------------

    def _start_ambient_animations(self):
        self._glow_loop = Loop(
            self.root, THEME["period_breathe"], self._draw_reactor,
        ).start()
        self._pulse_loop = Loop(
            self.root, THEME["period_pulse"], self._draw_status_dot,
        ).start()
        self._wave_running = True
        self._wave_tick()

    def _draw_reactor(self, t: float):
        """t in [0,1], ping-ponging — the reactor's breathing cycle."""
        c = self.reactor_canvas
        if not c.winfo_exists():
            return
        c.delete("all")
        cx, cy = 15, 15
        outer_r = 13 + 1.5 * t
        mid_r = 10 + 1.0 * t
        core_r = 5 + 2.0 * t
        outer_color = lerp_color(THEME["card_bg"], THEME["accent_glow"], 0.18 + 0.12 * t)
        mid_color = lerp_color(THEME["card_bg"], THEME["accent_glow"], 0.40 + 0.25 * t)
        core_color = lerp_color(THEME["accent_glow"], THEME["accent_core"], t)
        c.create_oval(cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r,
                       fill=outer_color, outline="")
        c.create_oval(cx - mid_r, cy - mid_r, cx + mid_r, cy + mid_r,
                       fill=mid_color, outline="")
        c.create_oval(cx - core_r, cy - core_r, cx + core_r, cy + core_r,
                       fill=core_color, outline="")
        c.create_text(cx, cy, text="⚡", fill=THEME["bg_dark"], font=(THEME["font_family"], 9, "bold"))

    def _draw_status_dot(self, t: float):
        c = self.status_canvas
        if not c.winfo_exists():
            return
        mode = self._MODES.get(self._mode, self._MODES["idle"])
        color = mode["color"]
        c.delete("all")
        cx, cy = 7, 7
        halo_r = 5 + 2 * t
        halo_color = lerp_color(THEME["card_bg"], color, 0.15 + 0.35 * t)
        c.create_oval(cx - halo_r, cy - halo_r, cx + halo_r, cy + halo_r, fill=halo_color, outline="")
        c.create_oval(cx - 3, cy - 3, cx + 3, cy + 3, fill=color, outline="")

    def _wave_tick(self):
        if not self._wave_running or not self.root or not self.wave_canvas.winfo_exists():
            return
        mode = self._MODES.get(self._mode, self._MODES["idle"])
        color = mode["color"]
        now = time.time()

        w, h = 90, 20
        bar_w = w / self._wave_bar_count
        self.wave_canvas.delete("all")
        for i in range(self._wave_bar_count):
            if self._mode == "idle":
                target = 2 + (h * 0.35) * (0.5 + 0.5 * math.sin(now * 1.6 + i * 0.8))
            else:
                jitter = random.uniform(-0.15, 0.15)
                target = 2 + h * min(1.0, max(0.0, self._wave_amp + jitter))
            # Exponential smoothing toward target — cheap, continuous, no per-bar Tween needed.
            self._wave_cur[i] += (target - self._wave_cur[i]) * 0.25
            bar_h = self._wave_cur[i]
            x0 = i * bar_w + 1
            x1 = x0 + bar_w - 2
            y1 = h
            y0 = h - bar_h
            self.wave_canvas.create_rectangle(x0, y0, x1, y1, fill=color, outline="")
        self.root.after(33, self._wave_tick)  # ~30fps

    # ------------------------------------------------------------------
    # Expand / collapse (smooth instead of an instant geometry snap)
    # ------------------------------------------------------------------

    def _toggle_expand(self):
        target_w, target_h = (320, 54) if self._is_expanded else (640, 360)
        self._animate_resize(target_w, target_h)
        self._is_expanded = not self._is_expanded

    def _animate_resize(self, target_w: int, target_h: int):
        start_w, start_h = self._cur_w, self._cur_h

        def on_update(t: float):
            w = round(start_w + (target_w - start_w) * t)
            h = round(start_h + (target_h - start_h) * t)
            self.root.geometry(f"{w}x{h}")
            self._cur_w, self._cur_h = w, h

        Tween(self.root, THEME["duration_normal"], on_update, easing=ease_out_cubic).start()

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------

    def _quick_action(self, text: str):
        if self.goal_entry:
            self.goal_entry.delete(0, "end")
            self.goal_entry.insert(0, text)
            self._on_dispatch()

    def _on_dispatch(self):
        if not self.goal_entry:
            return
        text = self.goal_entry.get().strip()
        if text:
            self._flash_border()
            self.set_mode("thinking")
            self.update_thought(f"Executing goal: '{text}'...")
            self.goal_entry.delete(0, "end")
            if self.on_submit_goal:
                self.on_submit_goal(text)

    def _flash_border(self):
        """Brief brightness pulse on the card border — a tactile 'received' cue."""
        base = THEME["accent_cyan"]
        bright = THEME["accent_core"]

        def up(t: float):
            self.main_card.configure(border_color=lerp_color(base, bright, t))

        def down():
            Tween(self.root, THEME["duration_fast"], lambda t: self.main_card.configure(
                border_color=lerp_color(bright, base, t)
            )).start()

        Tween(self.root, THEME["duration_fast"], up, on_done=down).start()

    # ------------------------------------------------------------------
    # Public API (called from the agent core)
    # ------------------------------------------------------------------

    def set_mode(self, mode: str):
        """mode: 'idle' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'error'"""
        if mode not in self._MODES:
            return
        self._mode = mode
        profile = self._MODES[mode]
        self._wave_amp = profile["amp"]
        self.update_status(profile["status"], profile["color"])

    def set_amplitude(self, level: float):
        """Feed a real 0.0-1.0 mic/TTS amplitude while mode is 'listening'/'speaking'."""
        self._wave_amp = max(0.0, min(1.0, level))

    def update_thought(self, text: str):
        """Updates the Live Thought Stream Ticker with a brief typewriter reveal."""
        self._thought_text = text
        if not (self.thought_lbl and self.root):
            return
        if self._reveal_job is not None:
            try:
                self.root.after_cancel(self._reveal_job)
            except Exception:
                pass
            self._reveal_job = None
        self._reveal_text(text, 0)

    def _reveal_text(self, full_text: str, i: int):
        if not self.thought_lbl.winfo_exists():
            return
        try:
            self.thought_lbl.configure(text=f"↳ {full_text[:i]}")
        except Exception:
            return
        if i < len(full_text):
            # Reveal a few characters per tick so long sentences don't crawl.
            step = max(1, len(full_text) // 60)
            self._reveal_job = self.root.after(
                THEME["duration_reveal"], lambda: self._reveal_text(full_text, min(len(full_text), i + step))
            )
        else:
            self._reveal_job = None

    def update_status(self, status: str, color: str = THEME["accent_green"]):
        """Updates the status label text/color; the dot's pulse color follows self._mode."""
        if self.status_label and self.root:
            try:
                self.status_label.configure(text=status.upper(), text_color=color)
            except Exception:
                pass

    def _update_badges(self, badges: List[str]):
        for widget in self.badge_strip.winfo_children():
            widget.destroy()
        for b in badges:
            lbl = ctk.CTkLabel(
                self.badge_strip, text=f" [⚡ {b}] ",
                font=(THEME["font_mono"], 10), fg_color="#132038",
                text_color=THEME["accent_cyan"], corner_radius=6,
            )
            lbl.pack(side="left", padx=4)
