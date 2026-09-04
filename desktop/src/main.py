import asyncio
import sys
import threading
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))


def run_tray_background_service():
    """Runs NIM JARVIS headlessly in the Windows System Tray with global hotkey support."""
    from src.bridge.server import get_bridge_server
    from src.security.snapshot import get_snapshot_manager
    from src.ui.tray import SystemTrayDaemon
    from src.ui.onboarding import launch_onboarding
    from overlay import JarvisHUDOverlay

    hud_instance = None
    hud_lock = threading.Lock()

    def get_or_create_hud():
        nonlocal hud_instance
        with hud_lock:
            if hud_instance is None or not (hud_instance.root and hud_instance.root.winfo_exists()):
                hud_instance = JarvisHUDOverlay(
                    on_submit_goal=lambda g: None,  # Dispatched via orchestrator
                    on_cancel_task=lambda: None
                )
                hud_instance.start_in_thread()
            else:
                try:
                    if hud_instance.root.state() == "withdrawn":
                        hud_instance.root.deiconify()
                        hud_instance.root.attributes("-topmost", True)
                    else:
                        hud_instance.root.withdraw()
                except Exception:
                    pass
        return hud_instance

    # Global Hotkey listener for Ctrl+Space
    try:
        from pynput import keyboard as pynput_keyboard
        hotkey = pynput_keyboard.HotKey(
            pynput_keyboard.HotKey.parse("<ctrl>+<space>"),
            get_or_create_hud
        )
        def for_canonical(f):
            return lambda k: f(l.canonical(k))

        l = pynput_keyboard.Listener(
            on_press=for_canonical(hotkey.press),
            on_release=for_canonical(hotkey.release)
        )
        l.daemon = True
        l.start()
    except Exception as e:
        print(f"[Tray] Hotkey registration notice: {e}")

    # Start background bridge server in a separate thread loop
    def _run_bridge_server():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        server = get_bridge_server()
        loop.run_until_complete(server.start())
        loop.run_forever()

    bridge_thread = threading.Thread(target=_run_bridge_server, daemon=True)
    bridge_thread.start()

    # Launch Tray Icon
    tray = SystemTrayDaemon(
        on_toggle_hud=get_or_create_hud,
        on_open_onboarding=lambda: threading.Thread(target=launch_onboarding, daemon=True).start(),
        on_undo=lambda: get_snapshot_manager().undo_last_action(),
        on_exit=lambda: sys.exit(0)
    )
    tray.run()


def main():
    if "--onboarding" in sys.argv:
        from src.ui.onboarding import launch_onboarding
        launch_onboarding()
        return

    if "--tray" in sys.argv or "--headless" in sys.argv:
        run_tray_background_service()
        return

    if "--gui" in sys.argv:
        try:
            from overlay import JarvisHUDOverlay
            hud = JarvisHUDOverlay()
            hud._run_ui()
            return
        except Exception as e:
            print(f"Failed to launch GUI HUD: {e}. Falling back to CLI...")

    from src.ui.cli import run_cli
    try:
        asyncio.run(run_cli())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
