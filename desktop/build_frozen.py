"""
build_frozen.py
---------------
Automated PyInstaller Build & Freeze Pipeline for NIM JARVIS.
Produces standalone Windows executables with no console window:
1. dist/NIM_Agent/NIM_Agent.exe (Main System Tray & HUD App)
2. dist/NIM_Agent/nim_bridge_host.exe (Chrome Native Messaging Host)
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

DESKTOP_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = DESKTOP_DIR.parent
DIST_DIR = DESKTOP_DIR / "dist" / "NIM_Agent"
BUILD_DIR = DESKTOP_DIR / "build"


def check_prerequisites():
    """Ensures PyInstaller is available."""
    try:
        import PyInstaller
    except ImportError:
        print("[*] Installing PyInstaller...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])


def build_main_app():
    """Freezes main.py into standalone NIM_Agent.exe."""
    print("=" * 60)
    print("⚡ Building NIM_Agent.exe (Windowed Desktop Tray & HUD App)...")
    print("=" * 60)

    main_script = str(DESKTOP_DIR / "src" / "main.py")

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--name=NIM_Agent",
        "--noconsole",
        "--windowed",
        "--noconfirm",
        "--clean",
        f"--distpath={DESKTOP_DIR / 'dist'}",
        f"--workpath={BUILD_DIR}",
        f"--paths={DESKTOP_DIR}",
        # Hidden imports for dynamic modules
        "--hidden-import=customtkinter",
        "--hidden-import=PIL",
        "--hidden-import=PIL._tkinter_finder",
        "--hidden-import=pystray",
        "--hidden-import=pygame",
        "--hidden-import=edge_tts",
        "--hidden-import=win32gui",
        "--hidden-import=win32con",
        "--hidden-import=win32process",
        "--hidden-import=win32api",
        "--hidden-import=psutil",
        "--hidden-import=pynput.keyboard._win32",
        "--hidden-import=pynput.mouse._win32",
        "--hidden-import=reportlab",
        "--hidden-import=docx",
        "--hidden-import=openpyxl",
        "--hidden-import=pptx",
        "--hidden-import=bs4",
        main_script,
    ]

    subprocess.check_call(cmd, cwd=str(DESKTOP_DIR))
    print("✓ NIM_Agent.exe compiled successfully.")


def build_native_bridge():
    """Freezes native_messaging.py into nim_bridge_host.exe."""
    print("=" * 60)
    print("⚡ Building nim_bridge_host.exe (Native Messaging Host)...")
    print("=" * 60)

    bridge_script = str(DESKTOP_DIR / "src" / "bridge" / "native_messaging.py")

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--name=nim_bridge_host",
        "--noconsole",
        "--noconfirm",
        "--clean",
        "--onefile",
        f"--distpath={DESKTOP_DIR / 'dist' / 'NIM_Agent'}",
        f"--workpath={BUILD_DIR}",
        bridge_script,
    ]

    subprocess.check_call(cmd, cwd=str(DESKTOP_DIR))
    print("✓ nim_bridge_host.exe compiled successfully.")


def copy_support_assets():
    """Copies manifest templates, icons, and themes into the output distribution directory."""
    print("[*] Copying runtime support assets...")
    manifest_src = DESKTOP_DIR / "src" / "bridge" / "manifest_template.json"
    manifest_dst = DIST_DIR / "manifest.json"
    if manifest_src.exists():
        shutil.copy2(manifest_src, manifest_dst)

    print(f"✓ All assets packaged in: {DIST_DIR}")


def main():
    check_prerequisites()
    build_main_app()
    build_native_bridge()
    copy_support_assets()
    print("\n🎉 Standalone distribution build complete!")
    print(f"Directory: {DIST_DIR}")


if __name__ == "__main__":
    main()
