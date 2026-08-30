# NIM Agent user guide

Current release: **v1.1.0**

## What NIM Agent does

NIM Agent is an AI browser side-panel extension. You can ask it to research pages, extract information, navigate websites, and help carry out browser tasks. It works with your own model-provider account and API key.

## Install from this project

1. Install Node.js 18 or later.
2. In the project folder, run:

   ```bash
   npm install
   npm run build
   ```

3. In Chrome, open `chrome://extensions`. In Edge, open `edge://extensions`.
4. Turn on **Developer mode**.
5. Choose **Load unpacked**, then select the `.output/chrome-mv3` folder created by the build.
6. Pin the extension if desired and open its side panel. The default shortcut is `Alt+Shift+N`.

For Firefox development builds, run `npm run build:firefox` and follow Firefox's temporary-extension loading flow.

## Install the Windows desktop agent

1. Install Python 3.11 or later.
2. In the desktop project folder, install the package:

   ```powershell
   cd desktop
   pip install -e .
   ```

3. Start the desktop runtime and HUD:

   ```powershell
   python -m src.main
   ```

4. Press `Ctrl+Space` to toggle the floating HUD. Press `ESC` to cancel an active task, stop speech playback, and return the agent to idle.

## Configure a provider

1. Open the extension's **Settings** tab.
2. Select NVIDIA NIM, OpenAI, Google AI Studio, Groq, Ollama, or a custom OpenAI-compatible endpoint.
3. Enter your provider API key. For web search, optionally enter a Brave Search or Serper API key.
4. Select **Fetch Models**, choose a chat model, set budget limits, and save.

For a self-hosted service, use the appropriate local endpoint and ensure it is running before fetching models.

## Run a task

1. Navigate to the relevant browser tab.
2. Open NIM Agent and describe the goal clearly, for example: “Summarize this page and list the main pricing options.”
3. Review the live task steps in the side panel.
4. Approve any action that could submit, purchase, delete, send, or otherwise have a meaningful effect.
5. Review findings in **Research Notes** or the final chat response.

Use the vision option only when a screenshot is useful. The extension is designed to read the page DOM first.

## Voice controls

NIM Agent v1.1.0 adds local voice activity detection, speech-to-text command capture, and neural TTS playback with barge-in cancellation.

- Use `/mic on` and `/mic off` to control ambient microphone listening.
- Use `/listen` for one spoken command.
- Use `/voice <text>` to speak text through the active persona.
- Use `/persona jarvis`, `/persona friday`, `/persona christopher`, `/persona jenny`, `/persona sonia`, or `/persona ryan` to switch voices.

## Safety and data handling

- Your configured API keys and extension data are stored in Chrome extension-local storage. They persist until you clear them or remove the extension.
- The extension has no developer-operated backend; requests go directly to the provider you choose.
- Page content is read when a task needs it. Screenshots are opt-in or used as a controlled fallback.
- NIM Agent blocks typing into sensitive fields such as passwords, payment details, and one-time codes.
- You remain responsible for reviewing the proposed actions and outputs, especially on sites involving money, private information, or irreversible changes.

## Troubleshooting

**The extension will not load:** Run `npm run build` again and select `.output/chrome-mv3`, not the project root.

**No models appear:** Verify the provider URL and API key, then use **Fetch Models** again. Confirm that the selected provider account exposes a chat-capable model.

**Web search fails:** Add a valid Brave Search or Serper key in Settings, or ask the agent to work from the open page.

**A task pauses:** Check the task timeline and security log. You may need to approve a flagged action, increase a configured budget, or resume the task.

**The agent cannot interact with a page:** Some pages prevent automation or change dynamically. Ask it to read the page first, then use a more specific instruction.

## Updating the extension

Pull the latest project changes, run `npm install`, then `npm run build`. Open the browser's extensions page and use the reload button on NIM Agent.
