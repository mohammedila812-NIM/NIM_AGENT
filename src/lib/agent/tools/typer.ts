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

/**
 * Type text into an element in a way that triggers React, Vue, Angular change detection.
 * Uses the native prototype descriptor setter before firing synthetic events.
 */
export function typeIntoElement(element: HTMLElement, value: string, clearFirst = true): void {
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

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (clearFirst) {
      element.value = '';
    }

    // React/Vue track the native setter; invoking it directly bypasses the framework override
    const proto =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  } else if (element.isContentEditable) {
    // Gmail, Slack, Notion, Linear use contenteditable containers
    element.focus();
    if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
      if (clearFirst) {
        document.execCommand('selectAll', false);
      }
      document.execCommand('insertText', false, value);
    } else {
      element.textContent = value;
    }
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: 'insertText',
      }),
    );
  }

  element.blur();
}
