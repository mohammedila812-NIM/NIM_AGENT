@echo off
title NIM JARVIS — System Tray Service
cd /d "%~dp0"
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)
start "" python desktop\src\main.py --tray
