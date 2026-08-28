import { defineContentScript } from 'wxt/utils/define-content-script';
import { extractVisibleText, extractVisibleLinks } from '../lib/agent/tools/dom-reader';
import { findElement, clickElement, selectOptionElement, pressKeyOnElement } from '../lib/agent/tools/clicker';
import { typeIntoElement } from '../lib/agent/tools/typer';
import { scrollPage } from '../lib/agent/tools/scroller';
import { renderHighlight } from '../lib/overlay/mount';

/**
 * Canonical Content Script Kernel (content.ts)
 *
 * Centralized DOM operations engine for NIM Agent.
 * Ensures 100% test-to-production parity and handles structured message routing.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime', // Injected on-demand when agent accesses tab
  main() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Security: Only accept messages from our own extension background worker
      if (sender.id !== chrome.runtime.id) {
        return false;
      }

      const msg = message as {
        type?: string;
        target?: string;
        value?: string;
        option?: string;
        key?: string;
        direction?: 'up' | 'down' | 'to_element';
        pixels?: number;
        selector?: string;
      };

      if (msg.type === 'PING') {
        sendResponse({ type: 'PONG', alive: true, url: window.location.href, title: document.title });
        return true;
      }

      if (msg.type === 'EXTRACT_DOM') {
        try {
          const container = msg.selector ? document.querySelector(msg.selector) ?? undefined : undefined;
          const text = extractVisibleText(container);
          const links = extractVisibleLinks();
          sendResponse({
            success: true,
            title: document.title,
            url: window.location.href,
            text,
            links,
          });
        } catch (err: unknown) {
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      if (msg.type === 'EXECUTE_CLICK') {
        if (!msg.target) {
          sendResponse({ success: false, error: 'No target specified for click' });
          return true;
        }
        const el = findElement(msg.target);
        if (!el) {
          sendResponse({ success: false, error: `Element not found: ${msg.target}` });
          return true;
        }
        try {
          renderHighlight(el.getBoundingClientRect(), 'Clicking...');
          clickElement(el);
          sendResponse({ success: true, target: msg.target });
        } catch (err: unknown) {
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      if (msg.type === 'EXECUTE_TYPE') {
        if (!msg.target) {
          sendResponse({ success: false, error: 'No target specified for type' });
          return true;
        }
        const el = findElement(msg.target);
        if (!el) {
          sendResponse({ success: false, error: `Element not found: ${msg.target}` });
          return true;
        }
        try {
          renderHighlight(el.getBoundingClientRect(), 'Typing...');
          typeIntoElement(el, msg.value ?? '');
          sendResponse({ success: true, target: msg.target });
        } catch (err: unknown) {
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      if (msg.type === 'EXECUTE_SELECT') {
        if (!msg.target || !msg.option) {
          sendResponse({ success: false, error: 'Target and option are required for select' });
          return true;
        }
        const el = findElement(msg.target);
        if (!el) {
          sendResponse({ success: false, error: `Select element not found: ${msg.target}` });
          return true;
        }
        try {
          renderHighlight(el.getBoundingClientRect(), 'Selecting option...');
          selectOptionElement(el, msg.option);
          sendResponse({ success: true, target: msg.target, option: msg.option });
        } catch (err: unknown) {
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      if (msg.type === 'EXECUTE_KEY') {
        if (!msg.key) {
          sendResponse({ success: false, error: 'Key name required for press_key' });
          return true;
        }
        const el = (msg.target ? findElement(msg.target) : null) || (document.activeElement as HTMLElement) || document.body;
        try {
          pressKeyOnElement(el, msg.key);
          sendResponse({ success: true, key: msg.key });
        } catch (err: unknown) {
          sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }

      if (msg.type === 'EXECUTE_SCROLL') {
        try {
          scrollPage(msg.direction ?? 'down', msg.pixels, msg.selector);
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
