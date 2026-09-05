import datetime
import math
import random
import sys
import threading
import time
from typing import Any, Callable, Dict, List, Optional

import psutil
import tkinter as tk
import customtkinter as ctk

try:
    from theme import THEME
    from anim import Tween, Loop, lerp_color, ease_out_cubic
    from acrylic import apply_acrylic
except ImportError:
    try:
        from .theme import THEME
        from .anim import Tween, Loop, lerp_color, ease_out_cubic
        from .acrylic import apply_acrylic
    except ImportError:
        from desktop.theme import THEME
        from desktop.anim import Tween, Loop, lerp_color, ease_out_cubic
        from desktop.acrylic import apply_acrylic


class JarvisHUDOverlay:
    """
    Futuristic Floating Desktop HUD & Command Center for NIM JARVIS.
    Designed based on the Stitch Design System (NIM-Agent HUD).
    Features real-time telemetry, live reasoning stream, left quick-dock,
    voice waveform visualizer, proactive ambient drawer, and global ESC kill-switch.
    """

    # Visual/behavioral profile per agent state
    _MODES = {
        "idle":      {"color": THEME["accent_sage"],   "status": "ONLINE",         "amp": 0.15},
        "listening": {"color": THEME["accent_teal"],   "status": "LISTENING",      "amp": 0.60},
        "thinking":  {"color": THEME["accent_amber"],  "status": "REASONING",      "amp": 0.40},
        "speaking":  {"color": THEME["accent_sage"],   "status": "SPEAKING",       "amp": 0.75},
        "approval":  {"color": THEME["accent_amber"],  "status": "NEEDS APPROVAL", "amp": 0.10},
        "error":     {"color": THEME["accent_coral"],  "status": "ERROR",          "amp": 0.10},
        "cancelled": {"color": THEME["accent_coral"],  "status": "CANCELLED",      "amp": 0.05},
    }

    def __init__(
        self,
        on_submit_goal: Optional[Callable[[str], None]] = None,
        on_cancel_task: Optional[Callable[[], None]] = None
    ):
        self.on_submit_goal = on_submit_goal
        self.on_cancel_task = on_cancel_task
        self.root: Optional[ctk.CTk] = None
        self._is_expanded = True
        self._cur_w, self._cur_h = 760, 440
        self._current_goal = "Awaiting command or autonomous trigger..."
        self._active_tool = "Idle (Ready)"
        self._log_history: List[str] = [
            f"[{datetime.datetime.now().strftime('%H:%M:%S')}] NIM_AGENT_OS Kernel Initialized.",
            f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Provider: Google Gemini Flash [ONLINE].",
            f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Vision Engine: NVIDIA NIM Llama-3.2-90B [READY].",
            f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Subsystems: UIA Actuator, Process Monitor, Scheduler, Email COM active.",
        ]

        self._mode = "idle"
        self._wave_amp = self._MODES["idle"]["amp"]
        self._wave_bar_count = 11
        self._wave_cur = [2.0] * self._wave_bar_count
        self._wave_running = False

        self._glow_loop: Optional[Loop] = None
        self._pulse_loop: Optional[Loop] = None
        self._telemetry_running = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start_in_thread(self):
        """Launches the HUD overlay in a dedicated UI thread."""
        ui_thread = threading.Thread(target=self._run_ui, daemon=True)
        ui_thread.start()

    def _on_escape_pressed(self, event=None):
        """Handles user hitting ESC key: cancels active task and resets HUD."""
        if self.on_cancel_task:
            self.on_cancel_task()
        self.set_mode("cancelled")
        self.append_log("⛔ Task cancelled by operator (ESC kill-switch).")
        self.set_active_tool("Aborted by User")

    def _run_ui(self):
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.root = ctk.CTk()
        self.root.title("NIM AGENT HUD")
        self.root.geometry(f"{self._cur_w}x{self._cur_h}+50+50")
        self.root.overrideredirect(True)  # Frameless window
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.96)
        self.root.configure(fg_color=THEME["bg_dark"])

        self.root.bind("<Escape>", self._on_escape_pressed)

        self._build_ui()
        self._enable_drag_window()

        # Best-effort Windows 10/11 Acrylic Blur
        self.root.after(50, lambda: apply_acrylic(self.root, THEME["bg_dark"], opacity=210))

        self._start_ambient_animations()
        self._start_telemetry_poller()
        self.root.mainloop()

    # ------------------------------------------------------------------
    # UI Layout Construction (Stitch Design System)
    # ------------------------------------------------------------------

    def _build_ui(self):
        if not self.root:
            return

        # Main Outer Glass Card
        self.main_card = ctk.CTkFrame(
            self.root,
            fg_color=THEME["card_bg"],
            border_color=THEME["border_neon"],
            border_width=1.5,
            corner_radius=THEME["radius_card"],
        )
        self.main_card.pack(fill="both", expand=True, padx=6, pady=6)

        # Subtle top-edge glass bevel
        glass_edge = ctk.CTkFrame(
            self.main_card, fg_color=THEME["glass_highlight"], height=2, corner_radius=0
        )
        glass_edge.pack(fill="x", side="top")

        # ==================== 1. TOP TELEMETRY HEADER ====================
        header = ctk.CTkFrame(self.main_card, fg_color="transparent")
        header.pack(fill="x", padx=14, pady=(8, 4))

        # Left: Reactor Pulse + Brand Title
        brand_box = ctk.CTkFrame(header, fg_color="transparent")
        brand_box.pack(side="left", fill="y")

        self.reactor_canvas = tk.Canvas(
            brand_box, width=28, height=28, bg=THEME["card_bg"],
            highlightthickness=0, bd=0,
        )
        self.reactor_canvas.pack(side="left", padx=(0, 8))

        title_lbl = ctk.CTkLabel(
            brand_box, text="NIM_AGENT_OS // v1.1_STABLE",
            font=(THEME["font_mono"], 12, "bold"), text_color=THEME["text_primary"],
        )
        title_lbl.pack(side="left", padx=(0, 12))

        # Center: Provider Badge & System Resource Telemetry
        provider_badge = ctk.CTkLabel(
            header, text="GEMINI FLASH [ONLINE]",
            font=(THEME["font_mono"], 9, "bold"),
            fg_color="#0f2935", text_color=THEME["accent_sage"],
            corner_radius=4, padx=8, pady=2,
        )
        provider_badge.pack(side="left", padx=6)

        self.telemetry_lbl = ctk.CTkLabel(
            header, text="SYS_RES: CPU 0%  RAM 0MB",
            font=(THEME["font_mono"], 9), text_color=THEME["text_muted"],
        )
        self.telemetry_lbl.pack(side="left", padx=10)

        # Right: Kill-Switch & Window Controls
        ctrl_box = ctk.CTkFrame(header, fg_color="transparent")
        ctrl_box.pack(side="right")

        # Red ESC CANCEL Button (Prominent Coral Handbrake)
        self.esc_btn = ctk.CTkButton(
            ctrl_box, text="⏻ ESC CANCEL", font=(THEME["font_mono"], 10, "bold"),
            fg_color=THEME["accent_coral"], hover_color=THEME["accent_coral_hover"],
            text_color="#10203a", height=24, corner_radius=4,
            command=self._on_escape_pressed,
        )
        self.esc_btn.pack(side="left", padx=4)

        min_btn = ctk.CTkButton(
            ctrl_box, text="—", width=22, height=22,
            fg_color=THEME["card_border"], hover_color=THEME["accent_glow"],
            font=(THEME["font_mono"], 11), corner_radius=4,
            command=self._toggle_expand,
        )
        min_btn.pack(side="left", padx=2)

        close_btn = ctk.CTkButton(
            ctrl_box, text="✕", width=22, height=22,
            fg_color="#3a1c28", hover_color=THEME["accent_coral"],
            font=(THEME["font_mono"], 10), corner_radius=4,
            command=self.root.withdraw,
        )
        close_btn.pack(side="left", padx=2)

        # ==================== 2. MAIN WORKSPACE BODY ====================
        body_frame = ctk.CTkFrame(self.main_card, fg_color="transparent")
        body_frame.pack(fill="both", expand=True, padx=12, pady=4)

        # Left Subsystem Dock (Vertical icons)
        dock_frame = ctk.CTkFrame(
            body_frame, fg_color="#081422", width=42,
            border_color=THEME["card_border"], border_width=1, corner_radius=6
        )
        dock_frame.pack(side="left", fill="y", padx=(0, 8), pady=2)

        dock_buttons = [
            ("🖱️", "Actuate active window", "Ground active window UI elements and actuate"),
            ("📊", "Process baselines", "/baseline"),
            ("📅", "Schedule task", "/schedule"),
            ("🔄", "Convert documents", "Convert files in workspace"),
            ("✉️", "Outlook sync", "Check and read latest Outlook emails"),
            ("⏪", "Atomic undo", "/undo"),
        ]

        for icon, tooltip, cmd in dock_buttons:
            btn = ctk.CTkButton(
                dock_frame, text=icon, width=32, height=32,
                fg_color="transparent", hover_color="#14283d",
                font=(THEME["font_mono"], 12), corner_radius=4,
                command=lambda c=cmd: self._quick_action(c),
            )
            btn.pack(pady=4, padx=4)

        # Center Reasoning Stream & Log Box (LOG_STRM)
        self.stream_frame = ctk.CTkFrame(
            body_frame, fg_color=THEME["card_bg_soft"],
            border_color=THEME["card_border"], border_width=1, corner_radius=8
        )
        self.stream_frame.pack(side="left", fill="both", expand=True)

        # Stream Sub-Header (Goal + Active Tool)
        stream_top = ctk.CTkFrame(self.stream_frame, fg_color="transparent")
        stream_top.pack(fill="x", padx=10, pady=(6, 4))

        badge_log = ctk.CTkLabel(
            stream_top, text="LOG_STRM", font=(THEME["font_mono"], 9, "bold"),
            fg_color="#183648", text_color=THEME["accent_sage"],
            corner_radius=4, padx=6, pady=1
        )
        badge_log.pack(side="left", padx=(0, 8))

        self.goal_lbl = ctk.CTkLabel(
            stream_top, text=f"Goal: {self._current_goal}",
            font=(THEME["font_mono"], 11, "bold"), text_color=THEME["text_primary"],
            anchor="w"
        )
        self.goal_lbl.pack(side="left", fill="x", expand=True)

        self.active_tool_lbl = ctk.CTkLabel(
            stream_top, text=f"Active Tool: {self._active_tool}",
            font=(THEME["font_mono"], 9), text_color=THEME["accent_sage"],
            anchor="e"
        )
        self.active_tool_lbl.pack(side="right", padx=(8, 0))

        # Log Text Box (Terminal style with auto-scroll)
        self.log_textbox = ctk.CTkTextbox(
            self.stream_frame,
            fg_color="#07111c",
            text_color=THEME["text_secondary"],
            font=(THEME["font_mono"], 10),
            corner_radius=6,
            border_width=0,
            activate_scrollbars=True,
        )
        self.log_textbox.pack(fill="both", expand=True, padx=8, pady=(0, 6))
        self._refresh_log_textbox()

        # ==================== 3. PROACTIVE AMBIENT DRAWER ====================
        self.proactive_container = ctk.CTkFrame(self.main_card, fg_color="transparent")
        self.proactive_container.pack(fill="x", padx=14, pady=(2, 4))

        # ==================== 4. BOTTOM COMMAND & WAVEFORM BAR ====================
        input_container = ctk.CTkFrame(
            self.main_card, fg_color="#081422",
            border_color=THEME["card_border"], border_width=1, corner_radius=8
        )
        input_container.pack(fill="x", padx=12, pady=(0, 8))

        input_inner = ctk.CTkFrame(input_container, fg_color="transparent")
        input_inner.pack(fill="x", padx=8, pady=6)

        # Terminal prompt prefix
        prompt_sym = ctk.CTkLabel(
            input_inner, text="⌘", font=(THEME["font_mono"], 13, "bold"),
            text_color=THEME["accent_sage"], width=20
        )
        prompt_sym.pack(side="left", padx=(0, 4))

        # Command Input Entry
        self.goal_entry = ctk.CTkEntry(
            input_inner,
            placeholder_text="What should I execute? (e.g. 'Organize workspace & extract invoice totals')",
            fg_color="transparent", border_width=0,
            text_color=THEME["text_primary"], font=(THEME["font_mono"], 11), height=28,
        )
        self.goal_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))
        self.goal_entry.bind("<Return>", lambda e: self._on_dispatch())

        # Audio Waveform Canvas (Edge-TTS Visualizer)
        self.wave_canvas = tk.Canvas(
            input_inner, width=70, height=20, bg="#081422",
            highlightthickness=0, bd=0,
        )
        self.wave_canvas.pack(side="left", padx=(0, 10))

        # Hotkey Pill
        hotkey_pill = ctk.CTkLabel(
            input_inner, text="[Ctrl + Space]",
            font=(THEME["font_mono"], 9), text_color=THEME["text_muted"],
            fg_color="#0f2030", corner_radius=4, padx=6, pady=2
        )
        hotkey_pill.pack(side="left", padx=(0, 8))

        # Execute Button
        dispatch_btn = ctk.CTkButton(
            input_inner, text="RUN ⚡", font=(THEME["font_mono"], 10, "bold"),
            fg_color=THEME["accent_sage"], text_color="#0a1829",
            hover_color=THEME["accent_teal"], width=68, height=28,
            corner_radius=4, command=self._on_dispatch,
        )
        dispatch_btn.pack(side="right")

    # ------------------------------------------------------------------
    # Window Movement & Sizing
    # ------------------------------------------------------------------

    def _enable_drag_window(self):
        """Allows dragging the frameless window from any blank container."""
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

    def _toggle_expand(self):
        target_w, target_h = (360, 52) if self._is_expanded else (760, 440)
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
    # Telemetry Poller (psutil)
    # ------------------------------------------------------------------

    def _start_telemetry_poller(self):
        self._telemetry_running = True

        def poll():
            while self._telemetry_running:
                try:
                    cpu = psutil.cpu_percent(interval=None)
                    mem = psutil.virtual_memory()
                    used_mb = int(mem.used / (1024 * 1024))
                    text = f"SYS_RES: CPU {cpu:.0f}%  RAM {used_mb}MB"
                    if self.root and self.telemetry_lbl:
                        self.root.after(0, lambda t=text: self.telemetry_lbl.configure(text=t))
                except Exception:
                    pass
                time.sleep(2.5)

        t = threading.Thread(target=poll, daemon=True)
        t.start()

    # ------------------------------------------------------------------
    # Ambient Animations (Reactor breathing & Audio Waveform)
    # ------------------------------------------------------------------

    def _start_ambient_animations(self):
        self._glow_loop = Loop(
            self.root, THEME["period_breathe"], self._draw_reactor,
        ).start()
        self._wave_running = True
        self._wave_tick()

    def _draw_reactor(self, t: float):
        """t in [0,1] - Reactor pulsing orb."""
        c = self.reactor_canvas
        if not (c and c.winfo_exists()):
            return
        c.delete("all")
        cx, cy = 14, 14
        outer_r = 11 + 2.0 * t
        mid_r = 8 + 1.2 * t
        core_r = 4 + 1.0 * t

        mode_info = self._MODES.get(self._mode, self._MODES["idle"])
        glow_color = mode_info["color"]

        outer_color = lerp_color(THEME["card_bg"], glow_color, 0.20 + 0.15 * t)
        mid_color = lerp_color(THEME["card_bg"], glow_color, 0.45 + 0.25 * t)
        core_color = lerp_color(glow_color, THEME["accent_core"], t)

        c.create_oval(cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r, fill=outer_color, outline="")
        c.create_oval(cx - mid_r, cy - mid_r, cx + mid_r, cy + mid_r, fill=mid_color, outline="")
        c.create_oval(cx - core_r, cy - core_r, cx + core_r, cy + core_r, fill=core_color, outline="")

    def _wave_tick(self):
        if not self._wave_running or not self.root or not self.wave_canvas.winfo_exists():
            return
        mode_info = self._MODES.get(self._mode, self._MODES["idle"])
        color = mode_info["color"]
        now = time.time()

        w, h = 70, 20
        bar_w = w / self._wave_bar_count
        self.wave_canvas.delete("all")

        for i in range(self._wave_bar_count):
            if self._mode == "idle":
                target = 2 + (h * 0.3) * (0.5 + 0.5 * math.sin(now * 2.0 + i * 0.7))
            else:
                jitter = random.uniform(-0.12, 0.12)
                target = 2 + h * min(1.0, max(0.0, self._wave_amp + jitter))

            self._wave_cur[i] += (target - self._wave_cur[i]) * 0.3
            bar_h = self._wave_cur[i]
            x0 = i * bar_w + 1
            x1 = x0 + bar_w - 2
            y1 = h
            y0 = h - bar_h
            self.wave_canvas.create_rectangle(x0, y0, x1, y1, fill=color, outline="")

        self.root.after(33, self._wave_tick)

    # ------------------------------------------------------------------
    # Public Control & Dispatch API
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
            self.set_goal(text)
            self.append_log(f"Operator Command: '{text}'")
            self.goal_entry.delete(0, "end")
            if self.on_submit_goal:
                self.on_submit_goal(text)

    def _flash_border(self):
        base = THEME["border_neon"]
        bright = THEME["accent_core"]

        def up(t: float):
            self.main_card.configure(border_color=lerp_color(base, bright, t))

        def down():
            Tween(self.root, THEME["duration_fast"], lambda t: self.main_card.configure(
                border_color=lerp_color(bright, base, t)
            )).start()

        Tween(self.root, THEME["duration_fast"], up, on_done=down).start()

    def set_mode(self, mode: str):
        """mode: 'idle' | 'listening' | 'thinking' | 'speaking' | 'approval' | 'error' | 'cancelled'"""
        if not self.root or mode not in self._MODES:
            return
        def _apply():
            self._mode = mode
            profile = self._MODES[mode]
            self._wave_amp = profile["amp"]
        try:
            self.root.after(0, _apply)
        except Exception:
            pass

    def set_amplitude(self, level: float):
        """Dynamic audio level visualizer (0.0 to 1.0) for TTS speech or mic."""
        self._wave_amp = max(0.0, min(1.0, level))

    def set_goal(self, goal_text: str):
        """Updates the active goal display banner."""
        self._current_goal = goal_text
        if self.root and self.goal_lbl:
            try:
                self.root.after(0, lambda: self.goal_lbl.configure(text=f"Goal: {goal_text[:65]}"))
            except Exception:
                pass

    def set_active_tool(self, tool_name: str):
        """Updates the active tool telemetry readout."""
        self._active_tool = tool_name
        if self.root and self.active_tool_lbl:
            try:
                self.root.after(0, lambda: self.active_tool_lbl.configure(text=f"Active Tool: {tool_name}"))
            except Exception:
                pass

    def append_log(self, text: str):
        """Appends a new entry to the live reasoning stream textbox."""
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        entry = f"[{timestamp}] {text}"
        self._log_history.append(entry)
        if len(self._log_history) > 100:
            self._log_history.pop(0)

        if self.root and self.log_textbox:
            try:
                self.root.after(0, lambda: self._append_to_textbox(entry))
            except Exception:
                pass

    def _append_to_textbox(self, entry: str):
        if not self.log_textbox.winfo_exists():
            return
        self.log_textbox.insert("end", entry + "\n")
        self.log_textbox.see("end")

    def _refresh_log_textbox(self):
        if not (self.log_textbox and self.log_textbox.winfo_exists()):
            return
        self.log_textbox.delete("1.0", "end")
        for entry in self._log_history:
            self.log_textbox.insert("end", entry + "\n")
        self.log_textbox.see("end")

    def update_thought(self, text: str):
        """Backward-compatible alias for log stream."""
        self.append_log(text)

    # ------------------------------------------------------------------
    # Proactive Ambient Drawer (Downloads & Clipboard Triggers)
    # ------------------------------------------------------------------

    def show_proactive_suggestion(self, source: str, title: str, actions: List[Dict[str, str]]):
        """Displays slide-in intervention card in bottom drawer."""
        if not self.root:
            return
        try:
            self.root.after(0, lambda: self._show_proactive_suggestion(source, title, actions))
        except Exception:
            pass

    def _show_proactive_suggestion(self, source: str, title: str, actions: List[Dict[str, str]]):
        if not (self.proactive_container and self.proactive_container.winfo_exists()):
            return
        for widget in self.proactive_container.winfo_children():
            widget.destroy()

        card = ctk.CTkFrame(
            self.proactive_container,
            fg_color="#0b1e32",
            border_color=THEME["accent_coral"] if source == "alert" else THEME["accent_sage"],
            border_width=1,
            corner_radius=6
        )
        card.pack(fill="x", pady=2)

        # Top line: Title & Dismiss
        top = ctk.CTkFrame(card, fg_color="transparent")
        top.pack(fill="x", padx=10, pady=(4, 2))

        lbl = ctk.CTkLabel(
            top, text=f"🔔 {title}", font=(THEME["font_mono"], 10, "bold"),
            text_color=THEME["text_primary"], anchor="w"
        )
        lbl.pack(side="left")

        dismiss_btn = ctk.CTkButton(
            top, text="✕", width=18, height=18, fg_color="transparent",
            hover_color="#3a1c28", text_color=THEME["text_secondary"],
            font=(THEME["font_mono"], 9), command=self._clear_proactive_suggestion
        )
        dismiss_btn.pack(side="right")

        # Action Buttons
        btn_row = ctk.CTkFrame(card, fg_color="transparent")
        btn_row.pack(fill="x", padx=10, pady=(0, 4))

        for act in actions:
            btn = ctk.CTkButton(
                btn_row, text=act["label"], font=(THEME["font_mono"], 9, "bold"),
                fg_color=THEME["accent_sage"], text_color="#071425",
                hover_color=THEME["accent_teal"], height=22, corner_radius=4,
                command=lambda g=act["goal"]: self._execute_proactive_goal(g)
            )
            btn.pack(side="left", padx=(0, 6))

    def _execute_proactive_goal(self, goal: str):
        self._clear_proactive_suggestion()
        self._quick_action(goal)

    def _clear_proactive_suggestion(self):
        if self.proactive_container and self.proactive_container.winfo_exists():
            for widget in self.proactive_container.winfo_children():
                widget.destroy()

    def update_status(self, status: str, color: str = THEME["accent_sage"]):
        """Updates the status readout."""
        pass

    def update_badges(self, badges: List[str]):
        """Appends status badges to the log stream."""
        self.append_log("Badges: " + " | ".join(badges))
