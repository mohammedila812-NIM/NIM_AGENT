# NIM AGENT — Windows Desktop Automation & Browser Intelligence

[![GitHub release](https://img.shields.io/github/v/release/mohammedila812-NIM/NIM_AGENT?color=df6b48&style=flat-square)](https://github.com/mohammedila812-NIM/NIM_AGENT/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4?style=flat-square&logo=windows)](https://github.com/mohammedila812-NIM/NIM_AGENT)
[![Python](https://img.shields.io/badge/python-3.11%2B-blue?style=flat-square&logo=python)](https://python.org)
[![Extension](https://img.shields.io/badge/extension-Chrome%20%7C%20Edge%20%7C%20Brave-green?style=flat-square&logo=google-chrome)](https://github.com/mohammedila812-NIM/NIM_AGENT)
[![Instagram](https://img.shields.io/badge/Instagram-@mahamadali210-E4405F?style=flat-square&logo=instagram)](https://instagram.com/mahamadali210)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-black?style=flat-square)](LICENSE)

> **Autonomous AI assistant for Windows and any Chromium browser.**  
> Execute OS-level automation, actuate applications, manage files and emails, monitor processes, and research the open web — all from a single unified agentic loop with a global **`ESC` kill-switch**.

---

## ⚡ Key Highlights

### 🖥️ Windows Desktop Automation Subsystems (`desktop/`)
- **Hybrid Actuation & Control:** Windows UI Automation (UIA accessibility tree) + Vision LLM grounding + smooth Bézier mouse kinematics + closed-loop visual verification (`dHash` diffing).
- **Application & Multi-Window Manager:** Launch apps by friendly alias, bypass focus-stealing locks, reposition windows across multi-monitor setups, and snapshot/restore complete workspace layouts.
- **Intelligent Context-Aware Scheduler:** Natural language & cron-based scheduling (`"every weekday at 9am"`), Outlook meeting conflict gates, and missed-job recovery.
- **Memory-Aware Email Integration:** Direct Microsoft Outlook COM & SMTP/IMAP integration, automated follow-up tracking, sensitive data redactor, and high-risk mass-send approvals.
- **Adaptive Process & Resource Monitor:** SQLite per-app baseline learning, resource anomaly scoring, open socket/file handle diagnostics, and safe undoable process kill with automatic window state restorer.
- **Vision-Verified File Converter:** Bidirectional conversion across XLSX, CSV, DOCX, Markdown, PDF, images, and archives (`zip`, `tar.gz`) with closed-loop perceptual layout spot-checks.
- **Global `ESC` Kill-Switch:** Press `ESC` at any time to instantly sever the LLM SSE stream, abort in-flight tool execution, silence TTS voice, and reset the HUD to idle.
- **Floating Acrylic HUD:** Minimalist translucent overlay (`Ctrl+Space`), live streaming reasoning steps, proactive suggestion cards, and Edge-TTS neural speech (`JARVIS` / `FRIDAY`).
- **Default LLM Routing:** Built-in automatic 35s rate-limit cooldown recovery for **Gemini Flash** (primary brain) and **NVIDIA NIM Vision** (visual coordinate grounding).

### 🌐 Browser Extension Copilot (`extension/`)
- **Manifest V3 Side Panel (`Alt+Shift+N`):** Works across Chrome, Microsoft Edge, Brave, and Opera.
- **DOM & Tab Inspector:** Semantic page parsing, visual bounding boxes, form auto-filling, table scraper, and cross-tab multi-hop web research.
- **Local WebSocket Bridge (`ws://127.0.0.1:7432`):** Seamless real-time context sharing between browser actions and desktop OS tools.

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interaction                         │
│   [Ctrl+Space] Floating Acrylic HUD   |   [Alt+Shift+N] Chrome Side Panel │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐  ws://7432   ┌──────────────────────────────┐
│    Desktop Runtime (Python)  │◄────────────►│  Browser Extension (MV3)     │
│   • UIA + Vision Actuator    │              │  • DOM Tree & Tab Inspector  │
│   • Window & Process Monitor │              │  • Web Scraper & Form Filler │
│   • Scheduler & Email COM    │              │  • Research Coordinator      │
│   • File & Archive Converter │              └──────────────────────────────┘
│   • Snapshot Rollback & ESC  │
└──────────────┬───────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                      LLM Routing Layer                      │
│   • Google AI Studio (Gemini Flash - Default Brain)         │
│   • NVIDIA NIM (Llama-3.2-90B Vision Instruct)              │
│   • OpenAI / Groq / Local Ollama Endpoints                  │
│   • Windows Credential Vault (Zero Plaintext Secrets)        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Windows Desktop Agent

**Prerequisites:** Windows 10/11, Python 3.11 or newer.

```powershell
# Clone the repository
git clone https://github.com/mohammedila812-NIM/NIM_AGENT.git
cd NIM_AGENT/desktop

# Install dependencies
pip install -r requirements.txt

# Run the desktop agent & HUD
python -m src.main
```

- Press **`Ctrl+Space`** to toggle the floating HUD.
- Press **`ESC`** at any moment to cancel a running task.
- API keys are securely stored in the Windows Credential Vault on first launch.

### 2. Browser Extension (Any Chromium Browser)

**Prerequisites:** Node.js 18+ (for building) or load pre-built extension.

```bash
# From repository root
npm install
npm run build
```

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and choose the `.output/chrome-mv3` folder.
4. Press **`Alt+Shift+N`** on any webpage to open the NIM Agent Side Panel.

---

## 🧪 Testing

The repository includes a comprehensive automated test suite for all desktop subsystems and browser tools:

```powershell
cd desktop
pytest tests/ -v
```

---

## 🛡️ Security & Privacy Principles

1. **No Silent Operations:** All file modifications, process kills, and emails are displayed in the HUD execution trace.
2. **Local Credential Storage:** API keys and sensitive tokens never leave your local machine.
3. **Atomic Undo & Rollback:** The `SnapshotManager` saves pre-execution checkpoints for instant one-command restoration.
4. **Permanent OS Shield:** Critical Windows processes (`csrss.exe`, `svchost.exe`, `wininit.exe`, kernel threads) are hard-protected by `SecurityGuard`.

---

## 📦 Releases

- **[Latest Release (v1.0.0)](https://github.com/mohammedila812-NIM/NIM_AGENT/releases):** Full Windows Desktop Automation Suite, Actuation, Process Monitor, Converter, Scheduler, Outlook, Global ESC Kill-Switch, and Chrome Extension Bridge.
- **[Changelog](CHANGELOG.md):** Complete chronological log of features and fixes.

---

## 👤 Author & Community

Created and maintained by **Mohammed Ali** ([@mahamadali210](https://instagram.com/mahamadali210)).

- **GitHub:** [https://github.com/mohammedila812-NIM/NIM_AGENT](https://github.com/mohammedila812-NIM/NIM_AGENT)
- **Instagram:** [@mahamadali210](https://instagram.com/mahamadali210)

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).
