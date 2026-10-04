/**
 * Shadow DOM & Recursive iFrame Piercer
 * Traverses encapsulated Web Components (Shadow Roots) and accessible iFrames
 * to locate interactive elements and ensure complete DOM grounding.
 */

export interface PiercedElementInfo {
  element: HTMLElement;
  framePath: string; // e.g. "root" or "root > #checkout-iframe"
  inShadow: boolean;
}

/**
 * Deep query selector that pierces through shadow roots and same-origin child iframes.
 */
export function deepQuerySelector<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: Document | ShadowRoot | Element = typeof document !== 'undefined' ? document : ({} as Document),
): T | null {
  if (!root || typeof (root as Document).querySelector !== 'function') return null;

  // 1. Direct query at current root
  try {
    const el = (root as Document).querySelector<T>(selector);
    if (el) return el;
  } catch {
    // Selector syntax error or not matched
  }

  // 2. Search all shadow roots recursively
  const candidates = (root as Document).querySelectorAll ? Array.from((root as Document).querySelectorAll('*')) : [];
  for (const node of candidates) {
    if (node.shadowRoot) {
      const found = deepQuerySelector<T>(selector, node.shadowRoot);
      if (found) return found;
    }

    if (node instanceof HTMLIFrameElement) {
      try {
        if (node.contentDocument) {
          const found = deepQuerySelector<T>(selector, node.contentDocument);
          if (found) return found;
        }
      } catch {
        // Cross-origin iframe boundary, ignore
      }
    }
  }

  return null;
}

/**
 * Deep query selector all that collects matching elements across document, shadow roots, and iframes.
 */
export function deepQuerySelectorAll<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: Document | ShadowRoot | Element = typeof document !== 'undefined' ? document : ({} as Document),
  framePath = 'root',
): PiercedElementInfo[] {
  if (!root || typeof (root as Document).querySelectorAll !== 'function') return [];

  const results: PiercedElementInfo[] = [];

  // Collect direct matches
  try {
    const directMatches = Array.from((root as Document).querySelectorAll<T>(selector));
    for (const el of directMatches) {
      results.push({
        element: el,
        framePath,
        inShadow: root !== document,
      });
    }
  } catch {
    // Ignore invalid selector
  }

  // Traverse children for Shadow Roots and iFrames
  const allNodes = Array.from((root as Document).querySelectorAll('*'));
  for (const node of allNodes) {
    if (node.shadowRoot) {
      const shadowMatches = deepQuerySelectorAll<T>(
        selector,
        node.shadowRoot,
        `${framePath} > #${node.id || node.tagName.toLowerCase()}-shadow`,
      );
      results.push(...shadowMatches);
    }

    if (node instanceof HTMLIFrameElement) {
      try {
        if (node.contentDocument) {
          const frameName = node.id || node.name || 'frame';
          const frameMatches = deepQuerySelectorAll<T>(
            selector,
            node.contentDocument,
            `${framePath} > #${frameName}`,
          );
          results.push(...frameMatches);
        }
      } catch {
        // Cross-origin iframe
      }
    }
  }

  return results;
}

/**
 * Assigns unified numeric data-nim-id attributes across the full pierced document tree.
 */
export function tagPiercedInteractiveElements(
  root: Document = typeof document !== 'undefined' ? document : ({} as Document),
): Array<{ id: number; element: HTMLElement; framePath: string; kind: string; label: string }> {
  const query = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';
  const piercedMatches = deepQuerySelectorAll(query, root);

  let idCounter = 1;
  const taggedList: Array<{ id: number; element: HTMLElement; framePath: string; kind: string; label: string }> = [];

  for (const { element, framePath } of piercedMatches) {
    // Visibility check
    if (typeof element.checkVisibility === 'function') {
      if (!element.checkVisibility()) continue;
    } else if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.01) {
        continue;
      }
    }

    const id = idCounter++;
    element.setAttribute('data-nim-id', String(id));

    // Resolve semantic label
    let label = element.getAttribute('aria-label') || '';
    if (!label && (element as HTMLInputElement).placeholder) {
      label = (element as HTMLInputElement).placeholder;
    }
    if (!label) {
      label = element.textContent?.replace(/\s+/g, ' ').trim() || element.getAttribute('title') || '';
    }
    label = label.slice(0, 60);

    const tag = element.tagName.toLowerCase();
    const kind = tag === 'a' ? 'link' : tag === 'input' ? `input[${(element as HTMLInputElement).type || 'text'}]` : tag;

    taggedList.push({
      id,
      element,
      framePath,
      kind,
      label,
    });
  }

  return taggedList;
}
