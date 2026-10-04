import { getCachedSelector, cacheSelector } from './selector-cache';
import { deepQuerySelector } from '../primitives/shadow-piercer';

/**
 * Resolve an interactive element to its true clickable container (e.g. SVG/path/span -> button/a).
 */
export function resolveInteractiveContainer(element: Element | null): HTMLElement | null {
  if (!element) return null;
  if (element instanceof HTMLElement) {
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/i.test(element.tagName) || element.hasAttribute('role')) {
      return element;
    }
  }
  const container = element.closest('button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], summary, [tabindex]:not([tabindex="-1"])');
  if (container instanceof HTMLElement) {
    return container;
  }
  return element instanceof HTMLElement ? element : (element.parentElement as HTMLElement | null);
}

/** Check if element is currently disabled via HTML disabled property or aria-disabled. */
export function isElementDisabled(element: HTMLElement): boolean {
  if ((element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled) {
    return true;
  }
  return element.getAttribute('aria-disabled') === 'true';
}

/**
 * Check if the element's center point is occluded by a fixed header, cookie banner, or modal backdrop.
 */
export function isElementOccluded(element: HTMLElement): { occluded: boolean; obstructingElement?: Element } {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
    return { occluded: false };
  }
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { occluded: false };

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  if (cx < 0 || cx > window.innerWidth || cy < 0 || cy > window.innerHeight) {
    return { occluded: true };
  }

  const topEl = document.elementFromPoint(cx, cy);
  if (!topEl) return { occluded: false };

  if (topEl === element || element.contains(topEl) || topEl.contains(element)) {
    return { occluded: false };
  }

  return { occluded: true, obstructingElement: topEl };
}

/** Find an interactive element via numeric index, CSS selector, or semantic heuristic matching, piercing Shadow DOM. */
export function findElement(target: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const trimmed = target.trim();

  // 1. Numeric index matching: "1", "[1]", "id:1", "#1" (piercing Shadow DOM)
  const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
  if (numMatch) {
    const nimIdEl = deepQuerySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
    if (nimIdEl) return resolveInteractiveContainer(nimIdEl);
  }

  // 2. Try direct CSS selector (piercing Shadow DOM)
  try {
    const el = deepQuerySelector<HTMLElement>(trimmed);
    if (el) return resolveInteractiveContainer(el);
  } catch {
    // Target was not a valid CSS selector
  }

  // 3. Semantic fallback across interactive elements
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], summary, [tabindex]:not([tabindex="-1"])',
    ),
  );

  const lower = target.toLowerCase().trim();

  const match = all.find((e) => {
    const text = (e.textContent ?? '').trim().toLowerCase();
    const label = (e.getAttribute('aria-label') ?? '').toLowerCase();
    const title = (e.getAttribute('title') ?? '').toLowerCase();
    const placeholder = (e instanceof HTMLInputElement ? e.placeholder : '').toLowerCase();
    const name = (e.getAttribute('name') ?? '').toLowerCase();

    return (
      text === lower ||
      text.includes(lower) ||
      label === lower ||
      label.includes(lower) ||
      title.includes(lower) ||
      placeholder.includes(lower) ||
      name === lower
    );
  });

  return match ? resolveInteractiveContainer(match) : null;
}

/** Click an element, ensuring container resolution, occlusion bypass, and full event dispatch. */
export function clickElement(element: HTMLElement): { success: boolean; error?: string } {
  const targetEl = resolveInteractiveContainer(element) || element;

  // Disabled pre-flight check
  if (isElementDisabled(targetEl)) {
    return {
      success: false,
      error: `ELEMENT_DISABLED: Element <${targetEl.tagName.toLowerCase()}> is disabled or aria-disabled="true" and cannot receive user interaction.`,
    };
  }

  // Ensure element is scrolled into view (centered) so sticky headers don't obstruct it
  if (typeof targetEl.scrollIntoView === 'function') {
    try {
      targetEl.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
    } catch {
      targetEl.scrollIntoView({ block: 'center', inline: 'center' });
    }
  }

  // Occlusion bypass: if element is covered by sticky header or modal, offset scroll slightly
  const occlusion = isElementOccluded(targetEl);
  if (occlusion.occluded && typeof window !== 'undefined' && typeof window.scrollBy === 'function') {
    window.scrollBy(0, -90);
  }

  targetEl.focus();

  // Checkbox / Radio input event handling for React/Vue listeners
  if (targetEl instanceof HTMLInputElement && (targetEl.type === 'checkbox' || targetEl.type === 'radio')) {
    targetEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Dispatch full pointer and mouse event lifecycle
  targetEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  targetEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  targetEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
  targetEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  targetEl.click();

  return { success: true };
}

/** Click element at specific viewport coordinates. */
export function clickAtCoordinates(x: number, y: number): { success: boolean; error?: string } {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
    return { success: false, error: 'Document unavailable or elementFromPoint unsupported' };
  }
  const el = document.elementFromPoint(x, y);
  if (!el || !(el instanceof HTMLElement)) {
    return { success: false, error: `No element found at viewport coordinates (${x}, ${y})` };
  }
  return clickElement(el);
}

/** High-level click handler with selector cache integration. */
export async function executeClickWithCache(
  hostname: string,
  target: string,
  coordinates?: { x: number; y: number },
): Promise<{ success: boolean; error?: string }> {
  if (coordinates) {
    return clickAtCoordinates(coordinates.x, coordinates.y);
  }

  // Check cache first
  const cached = await getCachedSelector(hostname, target);
  let el: HTMLElement | null = null;

  if (cached) {
    el = findElement(cached);
  }

  if (!el) {
    el = findElement(target);
    if (el) {
      // If we found it, generate a unique selector and cache it
      const generatedSelector = el.id ? `#${el.id}` : target;
      await cacheSelector(hostname, target, generatedSelector);
    }
  }

  if (!el) {
    return { success: false, error: `Could not locate element: "${target}"` };
  }

  return clickElement(el);
}

/** Select an option in a <select> element or custom dropdown. */
export function selectOptionElement(element: HTMLElement, optionValueOrText: string): { success: boolean; error?: string } {
  try {
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center', inline: 'center' });
    }
    element.focus();

    if (element instanceof HTMLSelectElement) {
      const lower = optionValueOrText.toLowerCase().trim();
      let matchedIndex = -1;

      for (let i = 0; i < element.options.length; i++) {
        const opt = element.options[i];
        if (
          opt.value.toLowerCase() === lower ||
          opt.text.toLowerCase() === lower ||
          opt.text.toLowerCase().includes(lower)
        ) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex === -1) {
        const available = Array.from(element.options).map((o) => `"${o.text}"`).slice(0, 8).join(', ');
        return { success: false, error: `Option "${optionValueOrText}" not found. Available options: [${available}]` };
      }

      element.selectedIndex = matchedIndex;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }

    // Custom dropdown / combobox
    const matchingItem = Array.from(element.querySelectorAll('[role="option"], li, button, a')).find(
      (item) => item.textContent?.toLowerCase().includes(optionValueOrText.toLowerCase())
    );

    if (matchingItem instanceof HTMLElement) {
      clickElement(matchingItem);
      return { success: true };
    }

    return { success: false, error: `Target element is not a <select> and no child option matched "${optionValueOrText}"` };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Dispatch key presses (Enter, Tab, Escape, ArrowDown, etc.) to an element. */
export function pressKeyOnElement(element: HTMLElement, key: string): { success: boolean; error?: string } {
  try {
    element.focus();

    const keyLower = key.toLowerCase();
    const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
      enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
      tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
      escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
      esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
      arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
      space: { key: ' ', code: 'Space', keyCode: 32 },
    };

    const info = keyMap[keyLower] || { key, code: `Key${key.toUpperCase()}`, keyCode: key.charCodeAt(0) };

    const eventProps = {
      key: info.key,
      code: info.code,
      keyCode: info.keyCode,
      which: info.keyCode,
      bubbles: true,
      cancelable: true,
    };

    element.dispatchEvent(new KeyboardEvent('keydown', eventProps));
    element.dispatchEvent(new KeyboardEvent('keypress', eventProps));
    element.dispatchEvent(new KeyboardEvent('keyup', eventProps));

    // If Enter on a form input, trigger form submit if present
    if (info.key === 'Enter' && element instanceof HTMLInputElement) {
      const form = element.form;
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
