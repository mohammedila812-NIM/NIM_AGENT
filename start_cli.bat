@echo off
title NIM JARVIS — Interactive CLI
cd /d "%~dp0"
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)
python desktop\src\main.py
if %errorlevel% neq 0 (
    echo.
    echo [!] An error occurred.
    pause
)
