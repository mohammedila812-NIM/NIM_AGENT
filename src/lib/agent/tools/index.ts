import type { Tool } from '../../llm/types';

export { webSearch } from './web-search';
export { extractVisibleText, extractVisibleLinks } from './dom-reader';
export { captureViewport } from './screenshot';
export { navigateTo } from './navigator';
export { clickElement, findElement, executeClickWithCache, selectOptionElement, pressKeyOnElement } from './clicker';
export { typeIntoElement, isSensitiveField } from './typer';
export { scrollPage } from './scroller';
export { summarizeContent } from './summarizer';
export { listTabs, switchTab, closeTab } from './tab-manager';
export { extractTableFromPage } from './table-extractor';
export { waitForDOMSettle, waitForSelector } from './wait-utils';
export { validateToolCall, type ValidatedToolCall } from './schemas';
export { shouldUseFallbackVision, MIN_DOM_CHARS } from './interaction-policy';
export { getCachedSelector, cacheSelector } from './selector-cache';

export { recallSessionHistory } from './session-recall';
export { executeBatchFormFill, formatBatchFillResult } from './form-filler';
export { exportDataToFile, formatExportResult } from './data-exporter';
export { inspectPageState, formatInspectedState } from './state-inspector';
export {
  setScratchpadVar,
  getScratchpadVar,
  listScratchpadVars,
  clearScratchpad,
  executeScratchpadWrite,
  executeScratchpadRead,
} from '../scratchpad';
export {
  executeCreateWatch,
  executeListWatches,
  executeDeleteWatch,
} from './watch-tools';
export {
  executeWorkspaceCreateFile,
  executeWorkspaceAppendFile,
  executeWorkspaceReadFile,
  executeWorkspaceListFiles,
  executeWorkspaceDeleteFile,
  executeWorkspaceSearch,
} from '../../workspace/workspace-tools';
export { observePage, formatAffordances } from '../primitives/observe';
export { actOnElement } from '../primitives/act';
export { extractStructuredData } from '../primitives/extract';
export { captureViewportWithMarks } from './set-of-marks';
export {
  executeKnowledgeGraphQuery,
  executeKnowledgeGraphAdd,
  executeKnowledgeGraphRelate,
} from '../../knowledge/graph-tools';
export { runSwarm } from '../swarm/coordinator';
export {
  startPageChangeDetector,
  stopPageChangeDetector,
  getPageChangeDetectorStatus,
} from '../sentinel/change-detector';


/** Tool declarations for OpenAI/NIM function calling specification */
export const AGENT_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the live web for information using a search engine.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query to execute.' },
          maxResults: { type: 'number', description: 'Maximum search results to return (default 5).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_page',
      description: 'Extract visible text, links, and indexed interactive elements ([1], [2], ...) with label and form metadata from current webpage.',
      parameters: {
        type: 'object',
        properties: {
          focusSelector: { type: 'string', description: 'Optional CSS selector to extract from a specific container.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_element',
      description: 'Click an element or toggle a checkbox/radio by its numeric index (e.g. "1"), CSS selector, or semantic label. Supports coordinate fallback and auto-resolves SVG icon buttons to clickable containers.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Numeric index (e.g. "1"), CSS selector, or text of the element to click.' },
          description: { type: 'string', description: 'Human-readable description of what this click accomplishes.' },
          coordinates: {
            type: 'object',
            properties: { x: { type: 'number' }, y: { type: 'number' } },
            description: 'Optional viewport coordinates {x, y} to click directly when visual targeting is needed.',
          },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into an input field or contenteditable element. Triggers full React/Vue/Angular keyboard lifecycle. Can optionally submit search or login forms immediately with Enter in a single turn.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Numeric index (e.g. "2"), CSS selector, label, or placeholder of the input field.' },
          value: { type: 'string', description: 'The exact text to type into the field.' },
          submitWithEnter: { type: 'boolean', description: 'If true, immediately sends Enter key and submits form after typing (ideal for search inputs).' },
          mode: { type: 'string', enum: ['replace', 'append', 'prepend'], description: 'Typing mode: replace existing value (default), append to end, or prepend.' },
        },
        required: ['target', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_option',
      description: 'Select an option in a <select> dropdown or custom dropdown menu by option text or value.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Numeric index (e.g. "3") or CSS selector of the <select> or dropdown element.' },
          option: { type: 'string', description: 'Visible label or value of the option to select.' },
        },
        required: ['target', 'option'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Send a keyboard key press event (e.g. Enter, Tab, Escape, ArrowDown) to an element or page.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key name (e.g. "Enter", "Tab", "Escape", "ArrowDown").' },
          target: { type: 'string', description: 'Optional target element index (e.g. "2") or selector to focus before pressing key.' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait_for',
      description: 'Wait for a specific CSS selector or element state to appear or disappear before proceeding.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to wait for (e.g. ".results-container", "#loading-spinner").' },
          state: { type: 'string', enum: ['visible', 'hidden'], description: 'Wait until visible or hidden (default: visible).' },
          timeoutMs: { type: 'number', description: 'Maximum milliseconds to wait (default: 5000).' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate_to',
      description: 'Navigate the active tab to a specific URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The absolute URL to navigate to (e.g. https://...).' },
          newTab: { type: 'boolean', description: 'Open in a new tab instead of current tab.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll_page',
      description: 'Scroll the webpage up, down, or to a specific element.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'to_element'], description: 'Scroll direction' },
          pixels: { type: 'number', description: 'Number of pixels to scroll (optional).' },
          selector: { type: 'string', description: 'Target element selector if direction is to_element.' },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description: 'Capture a visual screenshot of the viewport when DOM structure is non-descriptive or complex. Only usable with vision-capable models.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Explanation of why DOM text extraction was insufficient.' },
          annotateWithMarks: { type: 'boolean', description: 'Whether to overlay Set-of-Marks numbered badges on clickable elements (default: true).' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'visual_inspect',
      description: 'Inspect the webpage visually using multimodal vision to detect visual states not reflected in DOM text (e.g. Instagram unread message badges, red notification dots on icons, visual layout, video player states, canvas graphics).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to visually inspect (e.g. "Is there a red unread notification badge on the Messages or Direct icon?", "Is the video playing?").' },
          targetElement: { type: 'string', description: 'Optional selector or element description to focus on.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'auto_advance_media',
      description: 'Automatically watch and advance short-form video reels (Instagram Reels, YouTube Shorts, TikTok). Listens for reel completion in-page and smoothly scrolls to the next reel with zero LLM API calls, completely eliminating rate-limit usage.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'status'], description: 'Action to perform: "start" to begin continuous auto-scrolling on finish, "stop" to cancel, "status" to check count.' },
          maxReels: { type: 'number', description: 'Maximum number of reels to advance before pausing (default: 100).' },
          scrollKey: { type: 'string', enum: ['ArrowDown', 'PageDown', 'scroll'], description: 'Key/action to advance reel (default: "ArrowDown").' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bypass_annoyances',
      description: 'Automatically dismiss cookie consent banners (OneTrust, Cookiebot, GDPR dialogs), newsletter popups, blurred paywall backdrops, and restore page scrolling with zero LLM tokens.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clone_page_markdown',
      description: 'Extract and clean the active article/documentation page into clean GitHub-Flavored Markdown (preserving headings, code blocks, lists, and tables) and save it to the Virtual Workspace under /research/.',
      parameters: {
        type: 'object',
        properties: {
          includeLinks: { type: 'boolean', description: 'Whether to include inline markdown links (default: true).' },
          saveToWorkspace: { type: 'boolean', description: 'Whether to save the markdown file to /research/ in Virtual Workspace (default: true).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'watch_page_changes',
      description: 'Sentinel Change Detector: Monitors in real-time if anything changes on the page or inside a specific element (chat message streams like WhatsApp/Instagram/Slack, stock prices, auctions, form statuses). Can ask user what to do upon change or autonomously execute an instruction with zero token consumption while watching.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'stop', 'status'], description: 'Control action: "start" to begin monitoring, "stop" to cancel, "status" to inspect active watcher (default: "start").' },
          target: { type: 'string', description: 'CSS selector, element ID, or description of the area/item to monitor (e.g. "#chat-messages", ".price-container", "page", or aria-label).' },
          changeType: { type: 'string', enum: ['any', 'text', 'mutation', 'attribute', 'count'], description: 'Type of change to detect: "any", "count" (new incoming items/messages), "text" (price/content changes), or "attribute" (status/disabled changes).' },
          condition: { type: 'string', description: 'Optional human-readable condition description, e.g. "new incoming message from Alice" or "price drops below $200".' },
          actionOnDetect: { type: 'string', enum: ['ask', 'auto_act', 'notify'], description: 'Reaction mode when change is detected: "ask" alerts the user with audio and asks what to do; "auto_act" autonomously triggers the autonomousInstruction; "notify" alerts silently.' },
          autonomousInstruction: { type: 'string', description: 'Autonomous agent prompt to execute immediately when change occurs (when actionOnDetect is "auto_act").' },
          allowSending: { type: 'boolean', description: 'Whether autonomous action is pre-authorized to send outbound messages/submits without requiring HITL prompt (default: false).' },
          stopAfterChange: { type: 'boolean', description: 'Whether to stop monitoring after the first detected change (default: true).' },
          timeoutSeconds: { type: 'number', description: 'Maximum seconds to monitor before timing out (default: 3600).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize',
      description: 'Summarize accumulated research facts or compress long context and save to Research Notes.',
      parameters: {
        type: 'object',
        properties: {
          focus: { type: 'string', description: 'Specific focus area for the summary.' },
          markAsKeyFinding: { type: 'boolean', description: 'Flag output as a key finding that survives context compression.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: 'List all open browser tabs in the current window with their IDs, titles, and URLs.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'switch_tab',
      description: 'Switch the active browser tab by tab ID or URL/title keyword.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Tab ID or URL keyword to switch to.' },
        },
        required: ['tabId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_tab',
      description: 'Close a browser tab by tab ID or close current active tab.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'number', description: 'Optional tab ID to close.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_table',
      description: 'Extract structured tabular or repetitive card data from the page as JSON and CSV.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Optional CSS selector for the target table/container.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'parallel_research',
      description: 'Spawn parallel worker sub-agents across separate background tabs to research multiple URLs concurrently. Workers can interact with pages (click, type, scroll) or just extract static content. Ideal for multi-site comparisons, price checking, form filling, and paginated data collection.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'List of 1–5 parallel research tasks to execute simultaneously.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Label for this sub-task (e.g. "Amazon Prices", "Flipkart Reviews")' },
                url: { type: 'string', description: 'Target URL to research' },
                instruction: { type: 'string', description: 'Specific extraction or interaction instructions for this page' },
                maxSteps: { type: 'number', description: 'Optional max interaction steps for this worker (default: 8, max: 15)' },
                mode: { 
                  type: 'string', 
                  enum: ['extract', 'interact'],
                  description: 'Mode: "extract" for fast static scraping, "interact" for full interaction capability (click/type/scroll). Default: "interact".'
                },
              },
              required: ['name', 'url', 'instruction'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_session_history',
      description: 'Look up previous steps and results from this session by keyword query or retrieve the last N turns. Use ONLY when the user references something from earlier in the task (e.g. "what was the price you found?", "compare with the first result", "what did you find on that site?"). Do NOT use proactively — only when follow-up recall is needed.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Free-text keyword to search for in past session turns (e.g. "laptop price amazon", "cheapest result", "login error").',
          },
          last_n: {
            type: 'number',
            description: 'Number of most recent turns to retrieve (1–20). Used when no specific query is given.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_form',
      description: 'Fill multiple form inputs, dropdowns, checkboxes, or radios atomically in a single turn. Extremely fast and efficient for checkout, login, search filters, and registration forms. Can optionally submit the form once filled.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            description: 'List of fields to populate with their target numeric index / selector and values.',
            items: {
              type: 'object',
              properties: {
                target: { type: 'string', description: 'Numeric index (e.g. "1"), CSS selector, name, or label of the form field.' },
                value: { type: 'string', description: 'The exact value to enter, select, or set (use "true"/"false" for checkboxes).' },
                type: { type: 'string', enum: ['text', 'select', 'checkbox', 'radio'], description: 'Optional field type hint.' },
              },
              required: ['target', 'value'],
            },
          },
          submitAfter: {
            type: 'boolean',
            description: 'If true, automatically clicks the submit button or triggers form submission after filling all fields.',
          },
          submitTarget: {
            type: 'string',
            description: 'Optional numeric index or selector of the specific submit button to click.',
          },
        },
        required: ['fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_data',
      description: 'Trigger a native browser download as .csv, .json, .md, or .txt directly to the user Downloads folder from tables, search comparisons, or research notes.',
      parameters: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['csv', 'json', 'md', 'txt'], description: 'File format to save.' },
          filename: { type: 'string', description: 'Target filename without path (e.g. "laptop_comparison.csv").' },
          content: { type: 'string', description: 'Raw string or markdown/JSON content to write to file.' },
          source: { type: 'string', enum: ['table', 'research_notes', 'raw'], description: 'Optional data source.' },
        },
        required: ['format', 'filename'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'eval_page_script',
      description: 'Safely inspect framework state, Next.js server props, Nuxt data, or JSON-LD schema metadata embedded in the page without scraping noisy DOM.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['next_data', 'json_ld', 'nuxt_state', 'open_graph', 'custom'],
            description: 'The framework state target to inspect: "next_data" for window.__NEXT_DATA__, "json_ld" for schema.org schemas, "nuxt_state" for Nuxt/Vue state, "open_graph" for meta tags, or "custom" for specific window path.',
          },
          customPath: {
            type: 'string',
            description: 'Property path on window when target is "custom" (e.g. "window.__INITIAL_STATE__.catalog").',
          },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scratchpad_write',
      description: 'Save or update an intermediate variable in the session scratchpad (e.g. auth_token, selected_sku, cart_total, discount_code) so it survives across steps and parallel sub-agents.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Variable key name (e.g. "selected_laptop_price", "cart_id").' },
          value: { type: 'string', description: 'Value to store.' },
          notes: { type: 'string', description: 'Optional human-readable notes about this variable.' },
        },
        required: ['key', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scratchpad_read',
      description: 'Read an intermediate variable from the session scratchpad or list all currently stored session variables.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Optional key to look up. If omitted, lists all stored variables.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_watch',
      description: 'Schedule a recurring background monitor for a webpage to track price drops, inventory, new posts, or content changes. Sends browser notifications when triggers fire. IMPORTANT: When the user specifies a time in seconds (e.g. "every 20 seconds", "every 30sec"), use the `intervalSeconds` field. When the user specifies minutes or hours (e.g. "every 5 minutes", "hourly"), use the `intervalMinutes` field. Never convert seconds to minutes — pass the value in the correct field.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Descriptive title for this monitor (e.g. "Acer Laptop Price Watch").' },
          url: { type: 'string', description: 'Absolute URL of the webpage to monitor.' },
          type: { type: 'string', enum: ['element_text', 'price', 'dom_selector', 'macro', 'llm_condition'], description: 'Type of monitor check (default: "price").' },
          selector: { type: 'string', description: 'Optional CSS selector for the specific element to watch.' },
          conditionPrompt: { type: 'string', description: 'Optional semantic condition (e.g. "Alert if price drops below $650" or "In stock").' },
          intervalSeconds: { type: 'number', description: 'Monitoring interval in SECONDS. Use this when user says "every 20 seconds", "every 30sec", "every 45s", etc. Example: 20 for every 20 seconds.' },
          intervalMinutes: { type: 'number', description: 'Monitoring interval in MINUTES. Use this when user says "every 5 minutes", "every hour" (=60), "twice a day" (=720), etc. Default: 30. Do NOT use this for second-level intervals.' },
        },
        required: ['name', 'url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_watches',
      description: 'List all currently scheduled page monitors and their background status.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_watch',
      description: 'Delete a scheduled page monitor and cancel its background alarm.',
      parameters: {
        type: 'object',
        properties: {
          watchId: { type: 'string', description: 'The unique ID of the watch target to delete.' },
        },
        required: ['watchId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_create_file',
      description: 'Create a new file, document, or code script in the NIM Virtual Workspace (in-browser persistent file system).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute virtual path, e.g. "/research/ai-report.md" or "/code/script.js".' },
          content: { type: 'string', description: 'Full text content of the file.' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags to categorize this file.',
          },
          overwrite: { type: 'boolean', description: 'Whether to overwrite if file already exists (default: true).' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_append_file',
      description: 'Append text or findings to an existing file in the NIM Virtual Workspace without overwriting previous content. Creates file if it does not exist.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute virtual path of the file to append to.' },
          text: { type: 'string', description: 'The text, paragraph, or research notes to append.' },
        },
        required: ['path', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_read_file',
      description: 'Read the full text and metadata of a file stored in the NIM Virtual Workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute virtual path of the file to read.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_list_files',
      description: 'List all files and folders in a directory of the NIM Virtual Workspace with their sizes and extensions.',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Directory to list (e.g. "/research", "/code", "/notes", or "/" for root).' },
          recursive: { type: 'boolean', description: 'If true, lists files in subdirectories too.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_delete_file',
      description: 'Delete a file from the NIM Virtual Workspace or move it to /trash/.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute virtual path of the file to delete.' },
          permanent: { type: 'boolean', description: 'If true, deletes permanently. If false, moves to /trash/.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_search',
      description: 'Search for text or keywords across all files in the NIM Virtual Workspace.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search keyword or phrase.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'observe_page',
      description: 'Discover interactive affordances on the page (actions, input fields, dropdown options) with Shadow DOM piercing. Provides an organized map of interactive controls.',
      parameters: {
        type: 'object',
        properties: {
          maxAffordances: { type: 'number', description: 'Maximum interactive elements to return (default 75).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'act_on_element',
      description: 'Execute an atomic action on an element with automatic scroll-into-view, realistic pointer events, and state change verification (checks if page or values changed).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['click', 'type', 'select', 'press_key', 'scroll'], description: 'The action to perform.' },
          target: { type: 'string', description: 'The numeric ID (e.g. "1") or CSS selector of the target element.' },
          value: { type: 'string', description: 'Text to type (when action is "type").' },
          option: { type: 'string', description: 'Option text or value to select (when action is "select").' },
          key: { type: 'string', description: 'Key name (e.g. "Enter", "Tab", "Escape") when action is "press_key".' },
          direction: { type: 'string', enum: ['up', 'down', 'to_element'], description: 'Scroll direction when action is "scroll".' },
          submitWithEnter: { type: 'boolean', description: 'If true and action is "type", immediately sends Enter key and submits form after typing.' },
        },
        required: ['action', 'target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'extract_data',
      description: 'Extract structured data, repeating cards, or tables from the active page matching specific field names into JSON and CSV.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of field names to extract, e.g. ["title", "price", "rating", "url"].',
          },
          containerSelector: {
            type: 'string',
            description: 'Optional CSS selector for repeating card or row containers, e.g. ".product-card", "tbody tr".',
          },
          maxItems: {
            type: 'number',
            description: 'Maximum items to extract (default 25).',
          },
        },
        required: ['fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'knowledge_graph_query',
      description: 'Search NIM Brain — the persistent cross-session knowledge graph — for entities, facts, prices, specs, or relationships previously observed during browsing. Use this BEFORE searching the web when the user asks about something you may have researched before.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Keyword or entity name to search for (e.g. "Sony WH-1000XM5", "iPhone price", "OpenAI").' },
          maxNodes: { type: 'number', description: 'Maximum matching nodes to return (default 10, max 20).' },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'knowledge_graph_add',
      description: 'Explicitly save an important fact, entity, or finding to the persistent NIM Brain knowledge graph so it can be recalled in future sessions.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'The entity name (e.g. "Sony WH-1000XM5", "Sam Altman").' },
          type: { type: 'string', enum: ['product', 'person', 'organization', 'location', 'concept', 'price', 'date', 'stat', 'source', 'file', 'unknown'], description: 'Entity category.' },
          attributes: { type: 'object', description: 'Key-value attributes to store (e.g. { "price": "$279", "rating": "4.8" }).' },
          sourceUrl: { type: 'string', description: 'URL where this fact was found.' },
        },
        required: ['label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'knowledge_graph_relate',
      description: 'Save a relationship between two entities in the NIM Brain knowledge graph (e.g. "Sony WH-1000XM5" made_by "Sony").',
      parameters: {
        type: 'object',
        properties: {
          fromLabel: { type: 'string', description: 'Source entity label.' },
          fromType: { type: 'string', enum: ['product', 'person', 'organization', 'location', 'concept', 'price', 'date', 'stat', 'source', 'file', 'unknown'] },
          relation: { type: 'string', description: 'Relationship verb in snake_case (e.g. "made_by", "priced_at", "competes_with", "found_on").' },
          toLabel: { type: 'string', description: 'Target entity label.' },
          toType: { type: 'string', enum: ['product', 'person', 'organization', 'location', 'concept', 'price', 'date', 'stat', 'source', 'file', 'unknown'] },
        },
        required: ['fromLabel', 'relation', 'toLabel'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'swarm_research',
      description: 'Launch a parallel multi-tab research swarm: decomposes topic into sub-queries, runs each in a separate background tab simultaneously, then synthesizes a structured comparison report. Ideal for price comparison, multi-source fact checking, and comprehensive topic research.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'The research topic (e.g. "best wireless headphones under $300", "GPT-4o vs Claude 3.5 Sonnet comparison").' },
          maxWorkers: { type: 'number', description: 'Max parallel tabs to open (1–4, default 3).' },
        },
        required: ['topic'],
      },
    },
  },
  // ── DevTools (CDP) Curated Tools ──────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'inspect_element',
      description: 'DevTools Tier T0 (Read-Only). Inspects DOM node details, attributes, computed CSS, and box model via Chrome DevTools Protocol. Output is untrusted.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to inspect.' },
          nodeId: { type: 'number', description: 'DOM nodeId if already known.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_console',
      description: 'DevTools Tier T0 (Read-Only). Reads browser console messages, warnings, and errors. Output is untrusted.',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['error', 'warning', 'log', 'all'], description: 'Message severity filter.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_network',
      description: 'DevTools Tier T0/T1. Inspects network activity, HTTP status codes, headers, and performance timings. Output is untrusted.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'URL substring filter.' },
          includeResponseBody: { type: 'boolean', description: 'Include response body (Requires Tier T1). Always redacted.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_storage',
      description: 'DevTools Tier T1 (Sensitive Reads). Inspects localStorage, sessionStorage, or cookie names. Sensitive tokens and values are automatically redacted. Output is untrusted.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['localStorage', 'sessionStorage', 'cookies'], description: 'Storage system to inspect.' },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_ax_tree',
      description: 'DevTools Tier T0 (Read-Only). Retrieves accessibility tree (roles, accessible names, states) for assistive inspection. Output is untrusted.',
      parameters: {
        type: 'object',
        properties: {
          maxDepth: { type: 'number', description: 'Maximum depth of AX nodes to inspect (default 3).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_element',
      description: 'DevTools Tier T2 (Writes). Modifies outerHTML or attributes of an element. Requires Human-In-The-Loop approval showing diff. Reversible with undo_devtools_edit. Edits vanish on page reload.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of target element.' },
          outerHTML: { type: 'string', description: 'Replacement HTML string.' },
          attributeName: { type: 'string', description: 'Attribute name to set.' },
          attributeValue: { type: 'string', description: 'Attribute value.' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_styles',
      description: 'DevTools Tier T2 (Writes). Modifies inline or stylesheet CSS rules. Requires Human-In-The-Loop approval with diff. Reversible with undo_devtools_edit. Edits vanish on page reload.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of target element.' },
          cssText: { type: 'string', description: 'New CSS text declarations (e.g. "color: red; display: block;").' },
        },
        required: ['selector', 'cssText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'live_edit_script',
      description: 'DevTools Tier T2 (Writes). Live-edits JavaScript source code in V8 runtime. Requires Human-In-The-Loop approval. Edits vanish on page reload.',
      parameters: {
        type: 'object',
        properties: {
          scriptId: { type: 'string', description: 'V8 script ID.' },
          newSource: { type: 'string', description: 'Updated JavaScript source code.' },
        },
        required: ['scriptId', 'newSource'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mock_request',
      description: 'DevTools Tier T2 (Writes). Intercepts and mocks network requests matching a URL pattern. Requires Human-In-The-Loop approval.',
      parameters: {
        type: 'object',
        properties: {
          urlPattern: { type: 'string', description: 'URL wildcard pattern (e.g. "*api/data*").' },
          responseCode: { type: 'number', description: 'Mock HTTP status code (default 200).' },
          responseBody: { type: 'string', description: 'Mock response body content.' },
        },
        required: ['urlPattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_in_page',
      description: 'DevTools Tier T3 (Execution). Evaluates a JavaScript expression directly in page context via CDP Runtime.evaluate. Requires Human-In-The-Loop approval showing exact code. Output is untrusted.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'JavaScript code snippet to evaluate.' },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trusted_click',
      description: 'DevTools Tier T3 (Execution). Dispatches trusted native mouse event via CDP Input domain. Requires Human-In-The-Loop approval if action is destructive.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Viewport X coordinate.' },
          y: { type: 'number', description: 'Viewport Y coordinate.' },
          clickLabel: { type: 'string', description: 'Human-readable label of target element.' },
        },
        required: ['x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trusted_type',
      description: 'DevTools Tier T3 (Execution). Dispatches trusted native keyboard typing via CDP Input domain. Refuses typing into sensitive credential or payment fields.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text characters to insert.' },
          fieldName: { type: 'string', description: 'Target field label or name.' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'undo_devtools_edit',
      description: 'DevTools Tier T2 (Writes). Reverts the most recent DevTools HTML or style edit back to its pre-edit state.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'devtools_status',
      description: 'DevTools Tier T0 (Read-Only). Returns current Chrome DevTools Protocol attachment status, active tier, and target URL.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'devtools_detach',
      description: 'DevTools Tier T0 (Read-Only). Closes active CDP debugger session on the target tab.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  // ── Specialist Delegation Tools ───────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'delegate_to_specialist',
      description: 'Delegate substantial coding, debugging, or performance analysis to a specialized sub-agent model (e.g. DeepSeek R1). Runs in background so you can keep working; results arrive automatically in your context upon completion. Specialist actions need user HITL approval for writes/execution; its final report is untrusted external data that must be verified.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['coder', 'debugger', 'analyst'], description: 'Specialist role.' },
          goal: { type: 'string', description: 'Clear, actionable objective for the specialist.' },
          context: { type: 'string', description: 'Optional context, selectors, or error snippets.' },
          maxTier: { type: 'string', enum: ['T0', 'T1', 'T2', 'T3'], description: 'Maximum DevTools capability tier requested.' },
          maxSteps: { type: 'number', description: 'Max execution steps (1–20, default 10).' },
          mode: { type: 'string', enum: ['async', 'sync'], description: 'Default async (returns jobId). Sync waits for completion.' },
        },
        required: ['role', 'goal', 'maxTier'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_specialist',
      description: 'Checks the live progress, current step, and status of an active specialist job.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Specialist job ID returned by delegate_to_specialist.' },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'await_specialist',
      description: 'Awaits the completion of a background specialist sub-agent and returns its untrusted report. Useful when the next step strictly depends on the specialist\'s output.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Specialist job ID.' },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds (1000–120000, default 30000).' },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_specialist',
      description: 'Aborts and cancels an active specialist job, releasing any tab locks held by it.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Specialist job ID.' },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rollback_specialist_edits',
      description: 'Reverts all live HTML, CSS, and script edits made by a specialist job in reverse order using CDP undo snapshots.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Specialist job ID.' },
        },
        required: ['jobId'],
      },
    },
  },
];

