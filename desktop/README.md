# 🤖 NIM JARVIS Desktop

Current release: **v1.1.0**

**Native OS AI Automation Partner for the NIM Agent Browser Extension.**

NIM JARVIS Desktop is an autonomous desktop AI agent that executes native OS workflows, file transformations, document authoring, system tasks, and connects seamlessly to the NIM Agent browser extension via a local WebSocket bridge.

---

## 🌟 Key Capabilities

1. **ReAct Agent Loop**:
   - Classifies intent (`agent` vs `chat`), reasons step-by-step, emits tool calls, observes results, and synthesizes answers.
   - Compatible with NVIDIA NIM (cloud & self-hosted), OpenAI, Google Gemini, Groq, Ollama (local), and custom OpenAI endpoints.

2. **File System & Atomic Undo**:
   - Read, write, move, search, diff, and delete files.
   - **Pre-action atomic snapshots**: Every destructive file modification or deletion is automatically backed up. Revert instantly with `/undo` or `undo_last_action`.

3. **Multi-Format Document Generation**:
   - Generates `.docx` (Word), `.xlsx` (Excel), `.pdf` (PDF report), `.pptx` (PowerPoint), and `.md` (Markdown) with professional formatting, styled tables, headings, and bullet points.

4. **OS-Native Credential Security**:
   - API keys and tokens are stored directly in the OS-native Credential Manager (Windows Credential Manager / macOS Keychain / Linux Secret Service via `keyring`). Never stored in plaintext files.

5. **Browser Bridge WebSocket Server**:
   - Runs a local WebSocket server at `ws://127.0.0.1:7432` with a per-session pairing authentication token.
   - Enables bidirectional task delegation with the NIM Agent browser extension (`browser_research`).

6. **Safety & Audit Logging**:
   - Human-in-the-Loop (HITL) confirmation for destructive actions.
   - Sensitive pattern redaction (SSN, credit cards, credentials) prior to cloud LLM transmission.
   - Append-only audit logger at `~/.nim_jarvis/logs/audit.jsonl`.

7. **Voice & Speech Control**:
   - Local voice activity detection for ambient microphone listening.
   - Speech-to-text command capture for `/listen` and microphone-driven goals.
   - Edge-TTS neural voice personas with low-latency `pygame` playback and barge-in cancellation.

---

## 🚀 Quick Start

### 1. Launch NIM JARVIS Interactive CLI

```bash
cd desktop
pip install -e .
python -m src.main
```

### 2. Configure Your LLM Provider Key

Inside the CLI:
```bash
/key nim-cloud nvapi-your-key-here
# or for OpenAI:
/key openai sk-your-key-here
# or for Groq:
/key groq gsk-your-key-here
```

### 3. Check Configured Keys & Tools

```bash
/keys
/tools
/bridge
/mic on
/listen
/persona friday
```

### 4. Run Any Goal

```text
NIM JARVIS > Generate a quarterly financial summary in report.docx and export numbers to financials.xlsx
```

```text
NIM JARVIS > Find all python files in this project and search for TODO comments
```

```text
NIM JARVIS > Delete sample_temp.txt
# To revert:
NIM JARVIS > /undo
```

---

## 🧪 Running the Test Suite

```bash
cd desktop
python -m pytest tests -v
```
