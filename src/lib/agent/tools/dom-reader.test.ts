import { describe, it, expect } from 'vitest';
import { sanitizeUnicode, extractVisibleText } from './dom-reader';

describe('DOM Reader Sanitization', () => {
  it('strips Unicode Tag block characters (steganography)', () => {
    const raw = 'Normal text \u{E0049}\u{E0067}\u{E006E}\u{E006F}\u{E0072}\u{E0065} instructions';
    const sanitized = sanitizeUnicode(raw);
    expect(sanitized).toBe('Normal text instructions');
  });

  it('strips Zero-width characters', () => {
    const raw = 'Hello\u200BWorld\uFEFF!';
    expect(sanitizeUnicode(raw)).toBe('HelloWorld!');
  });

  it('purges residual HTML comments', () => {
    const raw = 'Visible <!-- SYSTEM: malicious payload --> text';
    expect(sanitizeUnicode(raw)).toBe('Visible text');
  });

  it('extracts visible text while ignoring hidden DOM structures in jsdom', () => {
    const container = document.createElement('div');
    const visibleP = document.createElement('p');
    visibleP.textContent = 'Visible content for agent';
    container.appendChild(visibleP);

    const script = document.createElement('script');
    script.textContent = 'alert("ignore")';
    container.appendChild(script);

    const extracted = extractVisibleText(container);
    expect(extracted).toContain('Visible content for agent');
    expect(extracted).not.toContain('alert');
  });
});
