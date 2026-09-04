"""
tray.py
-------
Windows System Tray Background Daemon for NIM JARVIS.
Allows NIM AGENT to live quietly in the Windows notification area (system tray)
without keeping any visible console / terminal window open.

Features:
- Left-click / Ctrl+Space: Toggle floating Acrylic HUD
- Right-click menu: Ambient Voice toggle, Undo last action, Onboarding Wizard, Settings, Quit
- Auto-starts on boot via HKCU registry entry
"""

import os
import sys
import threading
import logging
from pathlib import Path
from typing import Callable, Optional

from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)


def create_default_tray_icon() -> Image.Image:
    """Generates a high-DPI cyberpunk JARVIS reactor icon if no .ico file is present."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Outer neon ring
    draw.ellipse([4, 4, size - 4, size - 4], outline=(223, 107, 72, 255), width=4)
    # Inner glow
    draw.ellipse([14, 14, size - 14, size - 14], fill=(16, 32, 58, 220), outline=(78, 205, 196, 255), width=3)
    # Core reactor dot
    draw.ellipse([24, 24, size - 24, size - 24], fill=(255, 230, 109, 255))
    return img


class SystemTrayDaemon:
    """
    Manages the persistent system tray icon and background thread loops.
    """

    def __init__(
        self,
        on_toggle_hud: Optional[Callable[[], None]] = None,
        on_toggle_voice: Optional[Callable[[], None]] = None,
        on_undo: Optional[Callable[[], None]] = None,
        on_open_onboarding: Optional[Callable[[], None]] = None,
        on_exit: Optional[Callable[[], None]] = None,
        icon_path: Optional[Path] = None,
    ):
        self.on_toggle_hud = on_toggle_hud
        self.on_toggle_voice = on_toggle_voice
        self.on_undo = on_undo
        self.on_open_onboarding = on_open_onboarding
        self.on_exit = on_exit
        self.icon_path = icon_path
        self._icon = None
        self._is_voice_active = False

    def _load_icon_image(self) -> Image.Image:
        if self.icon_path and self.icon_path.exists():
            try:
                return Image.open(str(self.icon_path))
            except Exception as e:
                logger.warning("Could not load tray icon from %s: %s", self.icon_path, e)
        return create_default_tray_icon()

    def set_voice_state(self, active: bool):
        """Updates voice toggle checkmark in tray menu."""
        self._is_voice_active = active

    def run(self):
        """Runs the tray icon event loop (blocking, call in thread or main)."""
        try:
            import pystray
            from pystray import MenuItem as item, Menu
        except ImportError:
            logger.warning("pystray is not installed. System tray icon disabled.")
            return

        image = self._load_icon_image()

        def _action_toggle_hud(icon, item):
            if self.on_toggle_hud:
                self.on_toggle_hud()

        def _action_toggle_voice(icon, item):
            if self.on_toggle_voice:
                self.on_toggle_voice()

        def _action_undo(icon, item):
            if self.on_undo:
                self.on_undo()

        def _action_onboarding(icon, item):
            if self.on_open_onboarding:
                self.on_open_onboarding()

        def _action_exit(icon, item):
            if self.on_exit:
                self.on_exit()
            icon.stop()

        menu = Menu(
            item("⚡ Open NIM HUD (Ctrl+Space)", _action_toggle_hud, default=True),
            item("🎙️ Toggle Ambient Voice", _action_toggle_voice, checked=lambda item: self._is_voice_active),
            item("⏪ Undo Last Action", _action_undo),
            Menu.SEPARATOR,
            item("🚀 Welcome & Setup Wizard", _action_onboarding),
            item("⚙️ Settings & API Keys", _action_onboarding),
            Menu.SEPARATOR,
            item("⏻ Exit NIM JARVIS", _action_exit),
        )

        self._icon = pystray.Icon(
            name="NIM_JARVIS_AGENT",
            icon=image,
            title="NIM JARVIS — Autonomous AI Desktop Partner (Ctrl+Space)",
            menu=menu,
        )

        logger.info("System Tray Icon started.")
        self._icon.run()

    def stop(self):
        """Stops the system tray loop."""
        if self._icon:
            self._icon.stop()
