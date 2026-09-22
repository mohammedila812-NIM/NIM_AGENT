import asyncio
import sys
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from src.ui.gui.window import run_gui

def main():
    if "--cli" in sys.argv or "-c" in sys.argv:
        from src.ui.cli import run_cli
        try:
            asyncio.run(run_cli())
        except KeyboardInterrupt:
            pass
    else:
        run_gui()

if __name__ == "__main__":
    main()
