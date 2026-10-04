import { SENSITIVE_FIELD_PATTERNS } from '../security-patterns';

export function isSensitiveField(element: HTMLElement): boolean {
  const el = element as HTMLInputElement;
  if (el.type === 'password') return true;
  const searchIn = [
    el.name,
    el.id,
    el.placeholder,
    el.getAttribute('aria-label'),
    el.getAttribute('autocomplete'),
  ].join(' ');
  return SENSITIVE_FIELD_PATTERNS.some((p) => p.test(searchIn));
}

export interface TypeOptions {
  clearFirst?: boolean;
  mode?: 'replace' | 'append' | 'prepend';
  submitWithEnter?: boolean;
}

/**
 * Type text into an element in a way that triggers React, Vue, Angular change detection.
 * Dispatches full keyboard event lifecycle: keydown -> keypress -> native setter -> input -> keyup -> change.
 * Optionally submits with Enter immediately.
 */
export function typeIntoElement(
  element: HTMLElement,
  value: string,
  options: boolean | TypeOptions = true,
): void {
  const opts: TypeOptions = typeof options === 'boolean'
    ? { clearFirst: options, mode: options ? 'replace' : 'append' }
    : { clearFirst: options.clearFirst ?? (options.mode !== 'append'), mode: options.mode ?? 'replace', submitWithEnter: options.submitWithEnter };

  if (isSensitiveField(element)) {
    throw new Error('SECURITY: Refusing to auto-fill a sensitive field (password / payment)');
  }

  if (typeof element.scrollIntoView === 'function') {
    try {
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
    } catch {
      element.scrollIntoView({ block: 'center', inline: 'center' });
    }
  }

  element.focus();

  // Synthetic keydown / keypress prelude for modern autocomplete / search listeners
  const firstChar = value.slice(-1) || 'a';
  element.dispatchEvent(new KeyboardEvent('keydown', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true, cancelable: true }));
  element.dispatchEvent(new KeyboardEvent('keypress', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true, cancelable: true }));

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    let finalValue = value;
    if (opts.mode === 'append') {
      finalValue = (element.value || '') + value;
    } else if (opts.mode === 'prepend') {
      finalValue = value + (element.value || '');
    } else if (opts.clearFirst) {
      element.value = '';
    }

    // React/Vue track the native setter; invoking it directly bypasses the framework override
    const proto =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(element, finalValue);
    } else {
      element.value = finalValue;
    }

    // Modern input event with inputType metadata
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value,
      }));
    } catch {
      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }

    // Keyup after input
    element.dispatchEvent(new KeyboardEvent('keyup', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  } else if (element.isContentEditable) {
    // Gmail, Slack, Notion, Linear use contenteditable containers
    element.focus();
    if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
      if (opts.clearFirst && opts.mode !== 'append') {
        document.execCommand('selectAll', false);
      }
      document.execCommand('insertText', false, value);
    } else {
      if (opts.mode === 'append') {
        element.textContent = (element.textContent || '') + value;
      } else {
        element.textContent = value;
      }
    }
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: 'insertText',
      }),
    );
    element.dispatchEvent(new KeyboardEvent('keyup', { key: firstChar, code: `Key${firstChar.toUpperCase()}`, bubbles: true, cancelable: true }));
  }

  // Handle submitWithEnter if requested
  if (opts.submitWithEnter) {
    const enterProps = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    element.dispatchEvent(new KeyboardEvent('keydown', enterProps));
    element.dispatchEvent(new KeyboardEvent('keypress', enterProps));
    element.dispatchEvent(new KeyboardEvent('keyup', enterProps));

    const form = (element as HTMLInputElement).form || element.closest('form');
    if (form) {
      if (typeof form.requestSubmit === 'function') {
        try { form.requestSubmit(); } catch { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }
  }

  element.blur();
}
