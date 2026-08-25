import { defineContentScript } from 'wxt/utils/define-content-script';
import { extractVisibleText, extractVisibleLinks } from '../lib/agent/tools/dom-reader';
import { findElement, clickElement } from '../lib/agent/tools/clicker';
import { typeIntoElement } from '../lib/agent/tools/typer';
import { renderHighlight } from '../lib/overlay/mount';

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime', // On-demand injection via chrome.scripting.executeScript only!
  main() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Security: Only accept messages from our own extension background worker
      if (sender.id !== chrome.runtime.id) {
        return false;
      }

      if (message.type === 'PING') {
        sendResponse({ type: 'PONG', alive: true });
        return true;
      }

      if (message.type === 'EXTRACT_DOM') {
        const text = extractVisibleText();
        const links = extractVisibleLinks();
        sendResponse({
          title: document.title,
          url: window.location.href,
          text,
          links,
        });
        return true;
      }

      if (message.type === 'EXECUTE_CLICK') {
        const el = findElement(message.target);
        if (!el) {
          sendResponse({ success: false, error: `Element not found: ${message.target}` });
          return true;
        }
        renderHighlight(el.getBoundingClientRect(), 'Clicking...');
        clickElement(el);
        sendResponse({ success: true });
        return true;
      }

      if (message.type === 'EXECUTE_TYPE') {
        const el = findElement(message.target);
        if (!el) {
          sendResponse({ success: false, error: `Element not found: ${message.target}` });
          return true;
        }
        renderHighlight(el.getBoundingClientRect(), 'Typing...');
        try {
          typeIntoElement(el, message.value);
          sendResponse({ success: true });
        } catch (err: unknown) {
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      return false;
    });
  },
});
