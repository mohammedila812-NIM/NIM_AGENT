# NIM Agent

NIM Agent is a Manifest V3 browser extension for AI-assisted web research, browsing, and task automation. It is built with TypeScript, React, and WXT, and supports NVIDIA NIM plus other OpenAI-compatible model providers.

> **Personal hobby project:** NIM Agent is created and maintained by Mohammed Ali as a non-commercial hobby project. You are welcome to download, study, modify, and improve it for non-commercial purposes. See [LICENSE](LICENSE) for the full terms.

## Highlights

- Side-panel assistant with chat, task history, research notes, security log, and settings.
- Browser tools for page reading, navigation, clicking, typing, scrolling, tables, screenshots, and web search.
- Support for NVIDIA NIM, OpenAI, Google AI Studio, Groq, Ollama, and custom OpenAI-compatible endpoints.
- Safety features including prompt-injection quarantine, sensitive-field blocking, confirmation for risky actions, budget limits, and audit logging.
- Optional parallel research workers that are restricted to their starting domain.

## What's new

- **Session-history recall:** The agent can retrieve findings, tool results, and completed-task answers from earlier in the current browser session when a follow-up question refers to them.
- **Batch form filling:** The agent can populate up to 25 text fields, dropdowns, checkboxes, radio buttons, and editable fields in one action, with optional form submission.
- **Safer form automation:** Password and payment-related fields are automatically skipped during batch filling, while the result reports filled, skipped, and failed fields clearly.
- **Improved agent activity display:** Session recall and form-filling actions now appear with dedicated labels and icons in the side-panel activity feed.

## Quick start

Prerequisites: Node.js 18 or later and a Chromium-based browser (Chrome or Edge recommended).

```bash
npm install
npm run build
```

Load the generated extension from `.output/chrome-mv3`:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose `.output/chrome-mv3`.
4. Open the NIM Agent side panel, acknowledge the privacy disclosure, and configure a model provider and API key in Settings.

See [the user guide](docs/USER_GUIDE.md) for full setup, use, privacy, and troubleshooting instructions.

## Development

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run type-check
npm test
npm run build
npm run build:firefox
```

`npm run zip` and `npm run zip:firefox` create distributable extension archives.

## Privacy and security

NIM Agent has no developer-operated backend. Requests are sent directly to the provider configured by the user. API keys are stored in Chrome extension-local storage; this is sandboxed from websites and other extensions, but is not encrypted by the extension. Do not commit API keys or local `.env` files.

## Repository contents

- `src/` — extension source code.
- `public/` — icons and static assets.
- `e2e/` — end-to-end tests.
- `docs/USER_GUIDE.md` — installation and usage guide.
- `.env.example` — optional development configuration template without secrets.

## Author and license

Created by **Mohammed Ali** as a personal, non-commercial hobby project.

This project is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify, and distribute it for non-commercial purposes. Commercial use requires prior written permission from Mohammed Ali.
