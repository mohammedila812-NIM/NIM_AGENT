# NIM Agent User Guide

Current release: **v1.1.0**

## What NIM Agent does

NIM Agent is an autonomous AI browser assistant built as a Chrome and Firefox Manifest V3 side panel extension. It enables you to research webpages, extract structured data, fill and submit complex forms, schedule background monitors, record and replay macros, and conduct deep multi-hop web investigations—all using your own preferred LLM provider.

---

## Installation

### Prerequisites
- Node.js 18 or later
- npm

### 1. Build the Extension
```bash
# Clone the repository
git clone https://github.com/mohammedila812-NIM/NIM_AGENT.git
cd NIM_AGENT

# Install dependencies
npm install

# Build the Chromium Manifest V3 extension
npm run build

# Or build for Firefox
npm run build:firefox
```

### 2. Load into Your Browser
1. In Google Chrome, Microsoft Edge, or Brave, navigate to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
2. Enable **Developer mode** (top-right toggle switch).
3. Click **Load unpacked** and select the `.output/chrome-mv3` directory.
4. Pin the **NIM Agent** icon to your toolbar.
5. Press **`Alt+Shift+N`** on any page to open the NIM Agent Side Panel.

For Firefox development builds, navigate to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on...**, and select `manifest.json` inside `.output/firefox-mv2` or `.output/firefox-mv3`.

---

## Configuring LLM Providers

1. Open the NIM Agent side panel and click the **Settings (gear icon)**.
2. Select your LLM provider from the dropdown:
   - **NVIDIA NIM:** Enter your API key (`nvapi-...`). Supports `meta/llama-3.3-70b-instruct`, `meta/llama-3.2-90b-vision-instruct`, `mistralai/mixtral-8x22b-instruct-v0.1`, and `nvidia/nemotron-4-340b-instruct`.
   - **Google Gemini:** Enter your Gemini API key (`AIzaSy...`). Supports Gemini 1.5 Pro and Flash.
   - **OpenAI:** Enter your OpenAI key (`sk-...`). Supports GPT-4o, o1, and GPT-4o-mini.
   - **Groq:** Enter your Groq API key (`gsk_...`).
   - **Ollama:** Configure local URL `http://localhost:11434` for 100% private offline inference.
   - **Custom:** Connect any OpenAI-compatible API endpoint.
3. (Optional) Provide a **Brave Search** or **Serper** API key to allow the agent to perform live web queries across multiple search engines.
4. Configure optional **Cost Guard** spending and token limits.
5. Click **Save Configuration**.

---

## Core Workflows

### 1. Autonomous Web Research
1. Navigate to the webpage you want to analyze.
2. Type your prompt into the side panel input, e.g.:
   - *"Compare the pricing tiers on this page and summarize feature differences."*
   - *"Extract all product names and prices into a markdown table."*
3. The agent reads the page's semantic accessibility tree, reasons through the content, and provides structured answers.

### 2. Form Filling & Navigation
1. Direct the agent to interact with a page:
   - *"Search for RTX 4090 on this store and sort by lowest price."*
   - *"Fill out the contact form with my business info and stop before submitting."*
2. The agent uses targeted numerical element IDs to click, type, select options, and scroll smoothly.
3. Sensitive actions (e.g. final submissions, financial checkouts) trigger Human-In-The-Loop confirmation gates.

### 3. Background Watch Mode
1. Schedule background monitors to track page changes without keeping the side panel open:
   - *"Monitor this page and notify me if the price drops below $500."*
   - *"Check this inventory page every 15 minutes for restock."*
2. The agent monitors the target in the background and sends native browser notifications when thresholds are reached.

### 4. Workflow Macros
1. Open the **Macros** tab in the side panel.
2. Record sequences of user actions or automated steps.
3. Replay macros on demand with a single click or attach them to Watch Mode triggers.

---

## Safety & Security Model

- **Local Storage:** All API keys and session memories are saved locally in the browser's sandboxed storage. They never leave your device.
- **Zero External Backend:** NIM Agent communicates directly between your browser and the configured AI provider endpoint.
- **Human-In-The-Loop:** The agent automatically pauses and requires operator approval before taking irreversible or potentially risky actions.
- **Form Shield:** NIM Agent detects and prevents automatic filling of sensitive fields such as passwords and credit card security codes.

---

## Troubleshooting

- **Extension will not load:** Ensure you ran `npm run build` and selected `.output/chrome-mv3`, not the project root.
- **No models appear in dropdown:** Check your API key in Settings, then click **Query Live Chat Models**.
- **Web search fails:** Ensure you configured a valid Brave Search or Serper API key in Settings.
- **Task pauses unexpectedly:** Check the timeline for a Human-In-The-Loop approval prompt or verify if your Cost Guard token budget was reached.
