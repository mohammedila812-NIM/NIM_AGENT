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
      description: 'Click an element or toggle a checkbox/radio by its numeric index (e.g. "1"), CSS selector, or semantic label.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Numeric index (e.g. "1"), CSS selector, or text of the element to click.' },
          description: { type: 'string', description: 'Human-readable description of what this click accomplishes.' },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into an input field or contenteditable element by numeric index or selector.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Numeric index (e.g. "2"), CSS selector, label, or placeholder of the input field.' },
          value: { type: 'string', description: 'The exact text to type into the field.' },
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
      description: 'Capture a visual screenshot of the viewport when DOM structure is non-descriptive or complex.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Explanation of why DOM text extraction was insufficient.' },
        },
        required: ['reason'],
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
];
