@echo off
title NIM JARVIS — Holographic GUI
cd /d "%~dp0"
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)
python desktop\src\main.py --gui
if %errorlevel% neq 0 (
    echo.
    echo [!] An error occurred while running NIM JARVIS.
    pause
)
