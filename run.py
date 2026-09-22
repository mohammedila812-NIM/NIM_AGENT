"""
Root entry point for NIM_AGENT.
Launches the Autonomous Holographic Command Interface by default.
"""

import os
import sys
from pathlib import Path

# Add desktop and desktop/src to sys.path
_root = Path(__file__).resolve().parent
_desktop = _root / "desktop"
_src = _desktop / "src"

for p in [str(_root), str(_desktop), str(_src)]:
    if p not in sys.path:
        sys.path.insert(0, p)

from desktop.src.main import main

if __name__ == "__main__":
    main()
