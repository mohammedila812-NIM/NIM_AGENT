import asyncio
import sys
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

def main():
    if "--gui" in sys.argv:
        try:
            from src.ui.gui.app import launch_gui
            launch_gui()
            return
        except Exception as e:
            print(f"Failed to launch GUI: {e}. Falling back to CLI...")

    from src.ui.cli import run_cli
    try:
        asyncio.run(run_cli())
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()

