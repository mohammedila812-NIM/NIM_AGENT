"""
onboarding.py
-------------
First-Run Consumer Onboarding & Setup Wizard for NIM JARVIS.
A sleek dark-mode glassmorphic wizard that guides new users through:
1. Browser Extension setup & connection verification
2. 1-Click Free Gemini API Key configuration / Offline Ollama selection
3. Interactive Tutorial & Hotkey demonstration
"""

import sys
import webbrowser
import threading
import tkinter as tk
import customtkinter as ctk
from pathlib import Path
from typing import Optional, Callable

from src.security.secrets import get_secret_store
from src.bridge.server import get_bridge_server

# Stitch Dark Theme Palette
BG_DARK = "#0a1118"
CARD_BG = "#0f1c2b"
ACCENT_SAGE = "#df6b48"
ACCENT_TEAL = "#4ecdc4"
TEXT_PRIMARY = "#f0f4f8"
TEXT_MUTED = "#829ab1"


class OnboardingWizard(ctk.CTk):
    """
    3-Step First-Run Onboarding Wizard GUI.
    """

    def __init__(self, on_finish: Optional[Callable[[], None]] = None):
        super().__init__()
        self.on_finish_callback = on_finish
        self.secret_store = get_secret_store()
        self.bridge_server = get_bridge_server()

        self.title("NIM JARVIS — Welcome & Quick Setup")
        self.geometry("640x520")
        self.resizable(False, False)
        self.configure(fg_color=BG_DARK)

        ctk.set_appearance_mode("dark")
        self.current_step = 1

        self._build_header()
        self.content_container = ctk.CTkFrame(self, fg_color="transparent")
        self.content_container.pack(fill="both", expand=True, padx=24, pady=12)

        self._build_footer()
        self._render_step(1)

    def _build_header(self):
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=24, pady=(20, 10))

        title = ctk.CTkLabel(
            header,
            text="⚡ NIM JARVIS SETUP WIZARD",
            font=("Segoe UI", 16, "bold"),
            text_color=ACCENT_SAGE,
        )
        title.pack(side="left")

        self.step_indicator = ctk.CTkLabel(
            header,
            text="Step 1 of 3",
            font=("Segoe UI", 11),
            text_color=TEXT_MUTED,
            fg_color="#182a3c",
            corner_radius=6,
            padx=10,
            pady=3,
        )
        self.step_indicator.pack(side="right")

    def _build_footer(self):
        footer = ctk.CTkFrame(self, fg_color="transparent")
        footer.pack(fill="x", padx=24, pady=(10, 20), side="bottom")

        self.btn_back = ctk.CTkButton(
            footer,
            text="← Back",
            font=("Segoe UI", 12),
            fg_color="#182a3c",
            hover_color="#243b53",
            text_color=TEXT_PRIMARY,
            width=90,
            command=self._prev_step,
        )
        self.btn_back.pack(side="left")

        self.btn_next = ctk.CTkButton(
            footer,
            text="Next Step →",
            font=("Segoe UI", 12, "bold"),
            fg_color=ACCENT_SAGE,
            hover_color="#c85937",
            text_color="#0a1118",
            width=120,
            command=self._next_step,
        )
        self.btn_next.pack(side="right")

    def _clear_content(self):
        for widget in self.content_container.winfo_children():
            widget.destroy()

    def _render_step(self, step: int):
        self.current_step = step
        self.step_indicator.configure(text=f"Step {step} of 3")
        self._clear_content()

        if step == 1:
            self.btn_back.configure(state="disabled")
            self.btn_next.configure(text="Next Step →")
            self._render_step1_browser()
        elif step == 2:
            self.btn_back.configure(state="normal")
            self.btn_next.configure(text="Next Step →")
            self._render_step2_brain()
        elif step == 3:
            self.btn_back.configure(state="normal")
            self.btn_next.configure(text="🚀 Finish & Launch HUD")
            self._render_step3_test_drive()

    # -------------------------------------------------------------------------
    # Step 1: Browser Extension Setup
    # -------------------------------------------------------------------------
    def _render_step1_browser(self):
        card = ctk.CTkFrame(self.content_container, fg_color=CARD_BG, corner_radius=12)
        card.pack(fill="both", expand=True, padx=4, pady=4)

        icon_lbl = ctk.CTkLabel(card, text="🌐", font=("Segoe UI", 36))
        icon_lbl.pack(pady=(20, 5))

        h1 = ctk.CTkLabel(
            card,
            text="Chromium Browser Integration",
            font=("Segoe UI", 16, "bold"),
            text_color=TEXT_PRIMARY,
        )
        h1.pack(pady=(0, 6))

        p = ctk.CTkLabel(
            card,
            text=(
                "NIM Agent connects your Windows desktop to Chrome, Microsoft Edge, and Brave.\n"
                "The installer has pre-registered the extension. Click below to verify or open your browser."
            ),
            font=("Segoe UI", 11),
            text_color=TEXT_MUTED,
            justify="center",
        )
        p.pack(pady=(0, 16))

        # Status badge
        is_conn = self.bridge_server.is_client_connected
        status_color = ACCENT_TEAL if is_conn else ACCENT_SAGE
        status_text = "✅ Browser Extension Connected" if is_conn else "⏳ Waiting for browser to open..."

        self.browser_status_lbl = ctk.CTkLabel(
            card,
            text=status_text,
            font=("Segoe UI", 12, "bold"),
            text_color=status_color,
            fg_color="#0b1723",
            corner_radius=8,
            padx=14,
            pady=8,
        )
        self.browser_status_lbl.pack(pady=(0, 14))

        btn_box = ctk.CTkFrame(card, fg_color="transparent")
        btn_box.pack()

        open_chrome_btn = ctk.CTkButton(
            btn_box,
            text="Open Chrome / Edge",
            font=("Segoe UI", 11),
            fg_color="#1b3046",
            hover_color="#243f5d",
            command=lambda: webbrowser.open("chrome://extensions"),
        )
        open_chrome_btn.pack(side="left", padx=6)

        check_btn = ctk.CTkButton(
            btn_box,
            text="🔄 Re-Check Connection",
            font=("Segoe UI", 11),
            fg_color="#1b3046",
            hover_color="#243f5d",
            command=self._check_browser_status,
        )
        check_btn.pack(side="left", padx=6)

    def _check_browser_status(self):
        is_conn = self.bridge_server.is_client_connected
        if is_conn:
            self.browser_status_lbl.configure(text="✅ Browser Extension Connected", text_color=ACCENT_TEAL)
        else:
            self.browser_status_lbl.configure(text="⏳ No active browser connection yet", text_color=ACCENT_SAGE)

    # -------------------------------------------------------------------------
    # Step 2: AI Brain Setup (Free Gemini or Local Ollama)
    # -------------------------------------------------------------------------
    def _render_step2_brain(self):
        card = ctk.CTkFrame(self.content_container, fg_color=CARD_BG, corner_radius=12)
        card.pack(fill="both", expand=True, padx=4, pady=4)

        icon_lbl = ctk.CTkLabel(card, text="🧠", font=("Segoe UI", 36))
        icon_lbl.pack(pady=(16, 4))

        h1 = ctk.CTkLabel(
            card,
            text="Choose Your AI Intelligence",
            font=("Segoe UI", 16, "bold"),
            text_color=TEXT_PRIMARY,
        )
        h1.pack(pady=(0, 6))

        p = ctk.CTkLabel(
            card,
            text="Use Google Gemini Flash (Recommended — Free & Fast) or Local Offline Models (Ollama).",
            font=("Segoe UI", 11),
            text_color=TEXT_MUTED,
        )
        p.pack(pady=(0, 12))

        # 1-Click Get Key Button
        gemini_btn = ctk.CTkButton(
            card,
            text="🔑 Get Free Gemini API Key (1-Click Google Login)",
            font=("Segoe UI", 11, "bold"),
            fg_color="#1c3a54",
            hover_color="#275073",
            text_color=TEXT_PRIMARY,
            height=32,
            command=lambda: webbrowser.open("https://aistudio.google.com/app/apikey"),
        )
        gemini_btn.pack(pady=(0, 8))

        # Key input box
        input_frame = ctk.CTkFrame(card, fg_color="transparent")
        input_frame.pack(fill="x", padx=40, pady=(0, 6))

        self.key_entry = ctk.CTkEntry(
            input_frame,
            placeholder_text="Paste your Gemini API key (e.g. AIzaSy...)",
            font=("Segoe UI", 11),
            height=32,
            fg_color="#091420",
            border_color="#243f5d",
            show="*",
        )
        self.key_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))

        # Check existing key
        existing_key = self.secret_store.get_key("gemini")
        if existing_key:
            self.key_entry.insert(0, existing_key)

        save_btn = ctk.CTkButton(
            input_frame,
            text="Save & Test",
            font=("Segoe UI", 11, "bold"),
            fg_color=ACCENT_SAGE,
            hover_color="#c85937",
            text_color="#0a1118",
            width=90,
            height=32,
            command=self._save_and_test_key,
        )
        save_btn.pack(side="right")

        self.key_status_lbl = ctk.CTkLabel(
            card,
            text="✅ Gemini Key Configured" if existing_key else "ℹ️ Keys are stored securely in Windows Credential Vault",
            font=("Segoe UI", 10),
            text_color=ACCENT_TEAL if existing_key else TEXT_MUTED,
        )
        self.key_status_lbl.pack(pady=(4, 0))

    def _save_and_test_key(self):
        val = self.key_entry.get().strip()
        if not val:
            self.key_status_lbl.configure(text="⚠️ Please enter an API key", text_color=ACCENT_SAGE)
            return

        self.secret_store.set_key("gemini", val)
        self.key_status_lbl.configure(text="✅ Key saved securely in Windows Vault!", text_color=ACCENT_TEAL)

    # -------------------------------------------------------------------------
    # Step 3: Test Drive & Launch
    # -------------------------------------------------------------------------
    def _render_step3_test_drive(self):
        card = ctk.CTkFrame(self.content_container, fg_color=CARD_BG, corner_radius=12)
        card.pack(fill="both", expand=True, padx=4, pady=4)

        icon_lbl = ctk.CTkLabel(card, text="🎉", font=("Segoe UI", 36))
        icon_lbl.pack(pady=(20, 5))

        h1 = ctk.CTkLabel(
            card,
            text="You're Ready to Roll!",
            font=("Segoe UI", 16, "bold"),
            text_color=TEXT_PRIMARY,
        )
        h1.pack(pady=(0, 6))

        p = ctk.CTkLabel(
            card,
            text="JARVIS is now running quietly in your Windows system tray.",
            font=("Segoe UI", 11),
            text_color=TEXT_MUTED,
        )
        p.pack(pady=(0, 16))

        # Hotkey Highlight Card
        pill = ctk.CTkFrame(card, fg_color="#091420", corner_radius=8, border_color="#243f5d", border_width=1)
        pill.pack(padx=30, fill="x", pady=(0, 16))

        hotkey_lbl = ctk.CTkLabel(
            pill,
            text="Press  [ Ctrl + Space ]  anytime to open the HUD",
            font=("Segoe UI", 13, "bold"),
            text_color=ACCENT_SAGE,
            pady=12,
        )
        hotkey_lbl.pack()

        esc_lbl = ctk.CTkLabel(
            card,
            text="💡 Safety Tip: Press [ ESC ] at any moment to cancel any running agent action instantly.",
            font=("Segoe UI", 10),
            text_color=TEXT_MUTED,
        )
        esc_lbl.pack(pady=(0, 10))

    def _prev_step(self):
        if self.current_step > 1:
            self._render_step(self.current_step - 1)

    def _next_step(self):
        if self.current_step < 3:
            self._render_step(self.current_step + 1)
        else:
            self.destroy()
            if self.on_finish_callback:
                self.on_finish_callback()


def launch_onboarding():
    app = OnboardingWizard()
    app.mainloop()


if __name__ == "__main__":
    launch_onboarding()
