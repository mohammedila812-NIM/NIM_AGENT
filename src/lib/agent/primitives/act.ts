/**
 * Act Primitive (Stagehand / Browser-Use Pattern)
 * Executes atomic actions on DOM elements with automated scroll-into-view,
 * full event sequencing, and post-action state delta verification.
 */

import { waitForPageSettled } from './settle-gate';

export type ActActionType = 'click' | 'type' | 'select' | 'press_key' | 'scroll';

export interface ActOptions {
  action: ActActionType;
  target: string; // numeric id (e.g. "1") or CSS selector
  value?: string; // for type
  option?: string; // for select
  key?: string; // for press_key
  direction?: 'up' | 'down' | 'to_element'; // for scroll
  submitWithEnter?: boolean;
  coordinates?: { x: number; y: number };
}

export interface ActResult {
  success: boolean;
  didStateChange: boolean;
  resultingUrl: string;
  details: string;
  error?: string;
}

/**
 * Executes a verified action on the target browser tab.
 */
export async function actOnElement(tabId: number, options: ActOptions): Promise<ActResult> {
  const initialTab = await chrome.tabs.get(tabId);
  const initialUrl = initialTab.url || '';

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (opts: ActOptions, urlBefore: string) => {
      // 1. Recursive finder piercing Shadow DOM and same-origin child iframes
      function deepFind(targetStr: string): HTMLElement | null {
        const trimmed = targetStr.trim();
        const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
        const searchSelector = numMatch ? `[data-nim-id="${numMatch[1]}"]` : trimmed;

        function searchRoot(root: Document | ShadowRoot | Element): HTMLElement | null {
          try {
            const el = (root as Document).querySelector?.(searchSelector);
            if (el) return el as HTMLElement;
          } catch {
            // invalid selector
          }

          const all = (root as Document).querySelectorAll ? Array.from((root as Document).querySelectorAll('*')) : [];
          for (const node of all) {
            if (node.shadowRoot) {
              const found = searchRoot(node.shadowRoot);
              if (found) return found;
            }
            if (node instanceof HTMLIFrameElement) {
              try {
                if (node.contentDocument) {
                  const found = searchRoot(node.contentDocument);
                  if (found) return found;
                }
              } catch {
                // Cross-origin
              }
            }
          }
          return null;
        }

        const found = searchRoot(document);
        if (found) return found;

        // Fallback: search text labels
        const allElements = Array.from(document.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [role="button"]'));
        const lower = trimmed.toLowerCase();
        return allElements.find((e) => {
          const t = (e.textContent || '').trim().toLowerCase();
          const l = (e.getAttribute('aria-label') || '').toLowerCase();
          const p = (e instanceof HTMLInputElement ? e.placeholder : '').toLowerCase();
          return t === lower || t.includes(lower) || l === lower || p === lower;
        }) ?? null;
      }

      // Handle scrolling
      if (opts.action === 'scroll') {
        const dir = opts.direction || 'down';
        const amount = window.innerHeight * 0.8;
        window.scrollBy({ top: dir === 'down' ? amount : -amount, behavior: 'smooth' });
        return {
          success: true,
          didStateChange: true,
          resultingUrl: window.location.href,
          details: `Scrolled window ${dir}.`,
        };
      }

      let el = opts.coordinates
        ? (document.elementFromPoint(opts.coordinates.x, opts.coordinates.y) as HTMLElement | null)
        : deepFind(opts.target);

      if (!el) {
        return {
          success: false,
          didStateChange: false,
          resultingUrl: window.location.href,
          details: `Element target "${opts.target}" could not be located on the page.`,
          error: `Element not found: ${opts.target}`,
        };
      }

      // Resolve to true interactive container (SVG/path/span -> button/a)
      const container = el.closest('button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], summary, [tabindex]:not([tabindex="-1"])');
      if (container instanceof HTMLElement) {
        el = container;
      }

      // Disabled check
      if ((el as HTMLButtonElement | HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') {
        return {
          success: false,
          didStateChange: false,
          resultingUrl: window.location.href,
          details: `Element "${opts.target}" is disabled.`,
          error: `ELEMENT_DISABLED: Element is disabled and cannot be interacted with.`,
        };
      }

      // Scroll into view
      if (typeof el.scrollIntoView === 'function') {
        try {
          el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
        } catch {
          el.scrollIntoView({ block: 'center', inline: 'center' });
        }
      }

      // Track mutations before action
      let domMutated = false;
      const observer = new MutationObserver(() => {
        domMutated = true;
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      let actionDesc = '';

      switch (opts.action) {
        case 'click': {
          el.focus();
          if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
            el.checked = el.type === 'checkbox' ? !el.checked : true;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          el.click();
          actionDesc = `Clicked element "${opts.target}".`;
          break;
        }

        case 'type': {
          const val = opts.value ?? '';
          el.focus();
          const firstChar = val.slice(-1) || 'a';
          el.dispatchEvent(new KeyboardEvent('keydown', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true }));

          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(el, val);
            } else {
              el.value = val;
            }
            try {
              el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: val }));
            } catch {
              el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            }
            el.dispatchEvent(new KeyboardEvent('keyup', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            el.textContent = val;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: val }));
          }

          if (opts.submitWithEnter) {
            const enterProps = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
            el.dispatchEvent(new KeyboardEvent('keydown', enterProps));
            el.dispatchEvent(new KeyboardEvent('keypress', enterProps));
            el.dispatchEvent(new KeyboardEvent('keyup', enterProps));
            const form = (el as HTMLInputElement).form || el.closest('form');
            if (form) {
              if (typeof form.requestSubmit === 'function') {
                try { form.requestSubmit(); } catch { form.dispatchEvent(new Event('submit', { bubbles: true })); }
              } else {
                form.dispatchEvent(new Event('submit', { bubbles: true }));
              }
            }
          }
          actionDesc = `Typed "${val}" into "${opts.target}"${opts.submitWithEnter ? ' and submitted with Enter' : ''}.`;
          break;
        }

        case 'select': {
          const optText = (opts.option || '').toLowerCase();
          if (el instanceof HTMLSelectElement) {
            const foundOpt = Array.from(el.options).find(o => o.text.toLowerCase().includes(optText) || o.value.toLowerCase().includes(optText));
            if (foundOpt) {
              el.value = foundOpt.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              actionDesc = `Selected option "${foundOpt.text}" on "${opts.target}".`;
            } else {
              observer.disconnect();
              return {
                success: false,
                didStateChange: false,
                resultingUrl: window.location.href,
                details: `Option "${opts.option}" not found in dropdown.`,
                error: `Option not found: ${opts.option}`,
              };
            }
          }
          break;
        }

        case 'press_key': {
          const keyName = opts.key || 'Enter';
          el.focus();
          const props = { key: keyName, code: keyName, bubbles: true, cancelable: true };
          el.dispatchEvent(new KeyboardEvent('keydown', props));
          el.dispatchEvent(new KeyboardEvent('keypress', props));
          el.dispatchEvent(new KeyboardEvent('keyup', props));
          if (keyName.toLowerCase() === 'enter' && el instanceof HTMLInputElement && el.form) {
            el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
          actionDesc = `Pressed key "${keyName}" on "${opts.target}".`;
          break;
        }
      }

      // Small tick to catch immediate DOM changes
      observer.disconnect();
      const urlChanged = window.location.href !== urlBefore;
      const didStateChange = urlChanged || domMutated;

      return {
        success: true,
        didStateChange,
        resultingUrl: window.location.href,
        details: `${actionDesc} ${didStateChange ? '(Page state updated)' : '(No immediate DOM change detected)'}`,
      };
    },
    args: [options, initialUrl],
  });

  await waitForPageSettled(tabId, { maxWaitMs: 600, idleThresholdMs: 150 });
  return results[0]?.result ?? {
    success: false,
    didStateChange: false,
    resultingUrl: initialUrl,
    details: 'Act script execution failed.',
    error: 'Execution returned no result',
  };
}
