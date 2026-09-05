@echo off
setlocal enabledelayedexpansion
title NIM JARVIS — Automated Setup & Environment Installer
chcp 65001 >nul

echo ==============================================================================
echo   ⚡  NIM JARVIS — Automated Source Setup & Environment Installer
echo   Autonomous OS AI Partner • Subagent Swarms • Holographic HUD
echo ==============================================================================
echo.

:: 1. Detect Python Installation
echo [*] Checking Python installation...
set "PYTHON_CMD="

where python >nul 2>nul
if %errorlevel% equ 0 (
    set "PYTHON_CMD=python"
) else (
    where py >nul 2>nul
    if %errorlevel% equ 0 (
        set "PYTHON_CMD=py -3"
    ) else (
        where python3 >nul 2>nul
        if %errorlevel% equ 0 (
            set "PYTHON_CMD=python3"
        )
    )
)

if "%PYTHON_CMD%"=="" (
    echo [!] ERROR: Python was not found on your system PATH.
    echo.
    echo Please download and install Python 3.11 or newer:
    echo   https://www.python.org/downloads/
    echo.
    echo IMPORTANT: Make sure to check "Add python.exe to PATH" during installation!
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('%PYTHON_CMD% -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"') do (
    set "PY_VER=%%v"
)
echo [✓] Found Python %PY_VER% (%PYTHON_CMD%)
echo.

:: 2. Setup Virtual Environment (.venv)
if not exist ".venv\Scripts\activate.bat" (
    echo [*] Creating virtual environment (.venv)...
    %PYTHON_CMD% -m venv .venv
    if %errorlevel% neq 0 (
        echo [!] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo [✓] Virtual environment created successfully.
) else (
    echo [✓] Existing virtual environment detected (.venv).
)
echo.

:: 3. Activate Virtual Environment & Upgrade pip
echo [*] Activating virtual environment...
call .venv\Scripts\activate.bat

echo [*] Upgrading pip...
python -m pip install --upgrade pip --quiet

:: 4. Install Dependencies
echo [*] Installing required dependencies (this may take 1-2 minutes on first run)...
if exist "desktop\requirements.txt" (
    pip install -r desktop\requirements.txt
) else if exist "requirements.txt" (
    pip install -r requirements.txt
) else (
    echo [!] requirements.txt not found!
    pause
    exit /b 1
)

if %errorlevel% neq 0 (
    echo [!] Warning: Some packages may not have installed cleanly. Retrying standard dependencies...
    pip install pydantic httpx websockets keyring rich openpyxl python-docx python-pptx reportlab psutil numpy pyautogui mss Pillow beautifulsoup4 customtkinter edge-tts pygame sounddevice soundfile silero-vad faster-whisper pynput pystray
)
echo [✓] Dependencies installed successfully.
echo.

:: 5. Register Browser Extension Native Messaging Host
echo [*] Registering Chrome and Edge browser extension native bridge...
set "CURRENT_DIR=%~dp0"
set "CURRENT_DIR=%CURRENT_DIR:~0,-1%"
set "DESKTOP_DIR=%CURRENT_DIR%\desktop"
set "MANIFEST_PATH=%DESKTOP_DIR%\manifest.json"
set "PY_EXE=%CURRENT_DIR%\.venv\Scripts\python.exe"

python -c "import json, os; p = r'%DESKTOP_DIR%\manifest.json'; m = {'name': 'com.nim_agent.desktop', 'description': 'NIM JARVIS Desktop Native Messaging Host', 'path': r'%CURRENT_DIR%\.venv\Scripts\python.exe', 'type': 'stdio', 'allowed_origins': ['chrome-extension://*']}; open(p, 'w').write(json.dumps(m, indent=2))" 2>nul

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.nim_agent.desktop" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>nul
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.nim_agent.desktop" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>nul
echo [✓] Browser native messaging registered (Chrome & Edge).
echo.

:: 6. Create Quick Launchers
echo @echo off > start_gui.bat
echo title NIM JARVIS — Holographic GUI >> start_gui.bat
echo call "%%~dp0.venv\Scripts\activate.bat" >> start_gui.bat
echo python "%%~dp0desktop\src\main.py" --gui >> start_gui.bat

echo @echo off > start_tray.bat
echo title NIM JARVIS — System Tray >> start_tray.bat
echo call "%%~dp0.venv\Scripts\activate.bat" >> start_tray.bat
echo python "%%~dp0desktop\src\main.py" --tray >> start_tray.bat

echo @echo off > start_cli.bat
echo title NIM JARVIS — Interactive CLI >> start_cli.bat
echo call "%%~dp0.venv\Scripts\activate.bat" >> start_cli.bat
echo python "%%~dp0desktop\src\main.py" >> start_cli.bat

echo @echo off > start_onboarding.bat
echo title NIM JARVIS — Setup Wizard >> start_onboarding.bat
echo call "%%~dp0.venv\Scripts\activate.bat" >> start_onboarding.bat
echo python "%%~dp0desktop\src\main.py" --onboarding >> start_onboarding.bat

echo [✓] Generated 1-click launchers:
echo      • start_gui.bat        - Holographic Cyberpunk HUD
echo      • start_tray.bat       - Background Tray Service (Ctrl+Space)
echo      • start_cli.bat        - Interactive Terminal CLI
echo      • start_onboarding.bat - Setup Wizard
echo.

echo ==============================================================================
echo   🎉  NIM JARVIS SETUP COMPLETE!
echo ==============================================================================
echo.
echo Select an option to launch now:
echo   [1] Holographic Command Interface GUI (Recommended)
echo   [2] 3-Step Setup & Onboarding Wizard
echo   [3] System Tray Background Service (Ctrl+Space Hotkey)
echo   [4] Interactive Terminal CLI
echo   [5] Exit
echo.

set /p "CHOICE=Enter choice (1-5) [default: 1]: "
if "%CHOICE%"=="" set "CHOICE=1"

if "%CHOICE%"=="1" (
    echo [*] Launching Holographic Command Interface GUI...
    start "" python desktop\src\main.py --gui
    exit /b 0
)
if "%CHOICE%"=="2" (
    echo [*] Launching Setup & Onboarding Wizard...
    python desktop\src\main.py --onboarding
    exit /b 0
)
if "%CHOICE%"=="3" (
    echo [*] Launching System Tray Service...
    start "" python desktop\src\main.py --tray
    exit /b 0
)
if "%CHOICE%"=="4" (
    echo [*] Launching Interactive CLI...
    python desktop\src\main.py
    exit /b 0
)
if "%CHOICE%"=="5" (
    echo Setup finished. You can run 'start_gui.bat' anytime to launch NIM JARVIS.
    exit /b 0
)

echo Setup complete.
exit /b 0
