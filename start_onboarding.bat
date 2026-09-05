@echo off
title NIM JARVIS — Setup & Onboarding Wizard
cd /d "%~dp0"
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)
python desktop\src\main.py --onboarding
