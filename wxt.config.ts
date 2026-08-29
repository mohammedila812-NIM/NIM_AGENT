import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';

export default defineConfig({
  srcDir: 'src',
  vite: () => ({
    plugins: [react()],
    build: {
      modulePreload: false,
    },
  }),
  manifest: {
    name: 'NIM Agent — AI Browser Assistant',
    version: '1.0.0',
    description: 'AI agentic browser assistant for research, automation, and tasks. Powered by NVIDIA NIM and OpenAI-compatible models.',
    permissions: [
      'activeTab',
      'tabs',
      'scripting',
      'storage',
      'sidePanel',
      'alarms',
      'downloads',
      'notifications',
    ],
    host_permissions: [
      'https://integrate.api.nvidia.com/*',
      'https://generativelanguage.googleapis.com/*',
      'https://api.openai.com/*',
      'https://api.groq.com/*',
      'https://api.search.brave.com/*',
      'https://google.serper.dev/*',
      'https://html.duckduckgo.com/*',
      'https://api.duckduckgo.com/*',
      'http://localhost:8000/*',
      'http://localhost:11434/*',
      'http://127.0.0.1:7432/*',
      '<all_urls>',
    ],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    commands: {
      _execute_action: {
        suggested_key: {
          default: 'Alt+Shift+N',
          mac: 'Alt+Shift+N',
        },
        description: 'Open NIM Agent side panel',
      },
    },
    omnibox: {
      keyword: 'nim',
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: 'Open NIM Agent Side Panel',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  },
});
