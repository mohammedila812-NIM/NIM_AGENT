import os
import sys
from pathlib import Path

# Ensure desktop/ and desktop/src/ are on sys.path
_this_dir = Path(__file__).resolve().parent          # desktop/src
_desktop_dir = _this_dir.parent                      # desktop
_root_dir = _desktop_dir.parent                      # NIM_AGENT-1.1.0

for p in [str(_desktop_dir), str(_this_dir), str(_root_dir)]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from src.ui.gui.window import run_gui
except ImportError:
    from ui.gui.window import run_gui

if __name__ == "__main__":
    run_gui()
