import asyncio
import sys
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from src.ui.cli import run_cli

def main():
    try:
        asyncio.run(run_cli())
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
