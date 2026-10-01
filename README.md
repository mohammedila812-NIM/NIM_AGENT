# NIM AGENT — Autonomous AI Browser Assistant

[![Website](https://img.shields.io/badge/Website-Live%20Demo-df6b48?style=flat-square&logo=google-chrome)](https://mohammedila812-nim.github.io/NIM_AGENT/)
[![GitHub release](https://img.shields.io/github/v/release/mohammedila812-NIM/NIM_AGENT?color=df6b48&style=flat-square)](https://github.com/mohammedila812-NIM/NIM_AGENT/releases)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Brave%20%7C%20Firefox-0078d4?style=flat-square&logo=google-chrome)](https://github.com/mohammedila812-NIM/NIM_AGENT)
[![TypeScript](https://img.shields.io/badge/typescript-5.5%2B-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-black?style=flat-square)](LICENSE)
[![Instagram](https://img.shields.io/badge/Instagram-@mahamadali210-E4405F?style=flat-square&logo=instagram)](https://instagram.com/mahamadali210)

> **Autonomous, multi-model AI browser agent extension powered by NVIDIA NIM, Google Gemini, OpenAI, Groq, and local Ollama.**  
> Seamlessly inspect DOM trees, actuate web forms, extract structured data, schedule background monitors, record macros, and conduct deep multi-hop web research — straight from your browser side panel.

---

## ⚡ Core Capabilities

- **🧠 Autonomous ReAct Engine:** Multi-step autonomous reasoning loop executing DOM inspection, semantic element resolution, form submission, clicking, scrolling, and synthesis.
- **⚡ NVIDIA NIM Acceleration:** High-throughput cloud inference on Meta Llama 3.3 70B, Llama 3.2 Vision, Nemotron, and Mistral via NVIDIA NIM API endpoints.
- **🌐 Universal Model Compatibility:** Switch effortlessly between NVIDIA NIM, Google Gemini, OpenAI, Groq, or self-hosted local Ollama (`http://localhost:11434`).
- **🎯 Precise DOM Grounding:** Interactive numerical element indexing, semantic tree simplification, viewport coordinate calculation, and full-resolution screenshot capture.
- **📝 Form Automation & Scrapers:** Instant atomic multi-input form submission (`fill_form`), table extraction, markdown research compilation, and direct downloads.
- **⏱️ Background Watch Mode:** Continuous automated monitoring of web pages (price drop tracking, stock availability, news updates) with instant browser alert notifications.
- **🎬 Workflow Macro Recorder:** Capture repetitive browser tasks into reusable macros and replay them autonomously on demand or triggered by watch events.
- **🛡️ Cost Guard & Token Budgeting:** Real-time token tracking, session cost meters, and configurable daily spending caps to prevent unexpected API costs.
- **🔒 Privacy-First Security:** Zero telemetry. All API credentials and session histories are sandboxed in local browser storage and never leave your machine.

---

## 🏛️ Extension Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interaction                         │
│       Side Panel UI (`Alt+Shift+N`) | Omnibox `nim <query>`   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Background Service Worker                   │
│   • Agent ReAct Engine Loop (`engine.ts`)                   │
│   • Alarm-Driven Background Watch Engine (`watch-engine.ts`)│
│   • Session Checkpoint & Recovery Manager                   │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│       Content Scripts        │ │      LLM Inference Layer     │
│   • Interactive DOM Grounding│ │   • NVIDIA NIM Cloud API     │
│   • Numeric Element Tagging  │ │   • Google Gemini 1.5/2.0    │
│   • Click / Type / Scroll    │ │   • OpenAI GPT-4o / o1       │
│   • Screenshot & Extraction  │ │   • Groq Cloud & Ollama      │
└──────────────────────────────┘ └──────────────────────────────┘
```

---

## 🚀 Getting Started

### 1. Build from Source

**Prerequisites:** Node.js 18+ and npm.

```bash
# Clone the repository
git clone https://github.com/mohammedila812-NIM/NIM_AGENT.git
cd NIM_AGENT

# Install dependencies
npm install

# Build the Chrome/Chromium Manifest V3 extension
npm run build

# Or build for Firefox
npm run build:firefox
```

### 2. Load into Your Browser

#### Chromium Browsers (Google Chrome, Microsoft Edge, Brave, Opera)
1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Toggle on **Developer mode** (top-right corner).
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder inside the project.
4. Pin the **NIM Agent** extension icon or press **`Alt+Shift+N`** on any tab to open the Side Panel.

#### Firefox
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...** and select `manifest.json` inside the `.output/firefox-mv2` or `.output/firefox-mv3` folder.

---

## ⚙️ Configuration

1. Click the **Settings (gear icon)** in the NIM Agent side panel.
2. Select your preferred LLM provider:
   - **NVIDIA NIM:** Enter your API key (`nvapi-...`). Defaults to `meta/llama-3.3-70b-instruct`.
   - **Google Gemini:** Enter your Gemini API key (`AIzaSy...`).
   - **OpenAI:** Enter your OpenAI key (`sk-...`).
   - **Groq:** Enter your Groq API key (`gsk_...`).
   - **Ollama:** Set endpoint to `http://localhost:11434` (no API key required).
3. (Optional) Provide a **Brave Search** or **Serper** API key to enable live web search synthesis.
4. Click **Save Configuration**.

---

## 🧪 Automated Testing & Verification

The extension includes a comprehensive test suite built on Vitest:

```bash
# Run unit & agent integration tests
npm test

# Type-check TypeScript codebase
npm run compile
```

---

## 🛡️ Security & Privacy Guarantees

1. **Sandboxed Local Storage:** API keys and credentials are stored strictly in local browser extension storage. No third-party servers ever receive your keys.
2. **Zero Telemetry:** NIM Agent does not collect analytics, logs, telemetry, or user metrics.
3. **Explicit Permissions:** Actions occur only in browser tabs under your control.
4. **Human-In-The-Loop (HITL):** Financial or irreversible web actions prompt an operator confirmation dialog before execution.

---

## 👤 Author & License

Created and maintained by **Mohammed Ali** ([@mahamadali210](https://instagram.com/mahamadali210)).

- **GitHub:** [https://github.com/mohammedila812-NIM/NIM_AGENT](https://github.com/mohammedila812-NIM/NIM_AGENT)
- **Instagram:** [@mahamadali210](https://instagram.com/mahamadali210)

This project is distributed under the [PolyForm Noncommercial License 1.0.0](LICENSE).
