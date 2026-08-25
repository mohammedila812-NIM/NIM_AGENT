import { getCachedSelector, cacheSelector } from './selector-cache';

/** Find an interactive element via numeric index, CSS selector, or semantic heuristic matching. */
export function findElement(target: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const trimmed = target.trim();

  // 1. Numeric index matching: "1", "[1]", "id:1", "#1"
  const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
  if (numMatch) {
    const nimIdEl = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
    if (nimIdEl) return nimIdEl;
  }

  // 2. Try direct CSS selector
  try {
    const el = document.querySelector<HTMLElement>(trimmed);
    if (el) return el;
  } catch {
    // Target was not a valid CSS selector
  }

  // 3. Semantic fallback across interactive elements
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])',
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

  return match ?? null;
}

/** Click an element, ensure it's scrolled into view, and dispatch full bubbling events. */
export function clickElement(element: HTMLElement): void {
  // Ensure element is scrolled into view (centered) so sticky headers don't obstruct it
  if (typeof element.scrollIntoView === 'function') {
    try {
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
    } catch {
      element.scrollIntoView({ block: 'center', inline: 'center' });
    }
  }

  element.focus();

  // Checkbox / Radio toggle handling
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    if (element.type === 'checkbox') {
      element.checked = !element.checked;
    } else {
      element.checked = true;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Dispatch full pointer and mouse event lifecycle
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  element.click();
}

/** High-level click handler with selector cache integration. */
export async function executeClickWithCache(
  hostname: string,
  target: string,
): Promise<{ success: boolean; error?: string }> {
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

  clickElement(el);
  return { success: true };
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
