import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  deepQuerySelector,
  deepQuerySelectorAll,
  tagPiercedInteractiveElements,
} from './shadow-piercer';
import { formatAffordances, type PageAffordances } from './observe';

describe('Phase 1 Primitives Suite', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('Shadow DOM & Deep Piercing', () => {
    it('pierces open shadow roots to locate internal elements', () => {
      // Create a host element with a shadow root
      const host = document.createElement('div');
      host.id = 'custom-widget';
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      const internalButton = document.createElement('button');
      internalButton.id = 'shadow-btn';
      internalButton.textContent = 'Inside Shadow';
      shadow.appendChild(internalButton);

      // Normal document.querySelector fails to find it
      expect(document.querySelector('#shadow-btn')).toBeNull();

      // deepQuerySelector successfully pierces the shadow root
      const found = deepQuerySelector<HTMLButtonElement>('#shadow-btn');
      expect(found).not.toBeNull();
      expect(found?.textContent).toBe('Inside Shadow');
    });

    it('collects all interactive elements across light and shadow DOM', () => {
      const normalBtn = document.createElement('button');
      normalBtn.textContent = 'Normal';
      document.body.appendChild(normalBtn);

      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });

      const shadowInput = document.createElement('input');
      shadowInput.type = 'text';
      shadowInput.placeholder = 'Search inside shadow';
      shadow.appendChild(shadowInput);

      const allPierced = deepQuerySelectorAll('button, input', document);
      expect(allPierced.length).toBe(2);
      expect(allPierced.some(p => p.element.tagName.toLowerCase() === 'button')).toBe(true);
      expect(allPierced.some(p => p.element.tagName.toLowerCase() === 'input')).toBe(true);
    });

    it('tags pierced interactive elements with sequential data-nim-id', () => {
      const btn1 = document.createElement('button');
      btn1.textContent = 'Button 1';
      document.body.appendChild(btn1);

      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });

      const btn2 = document.createElement('button');
      btn2.textContent = 'Button 2';
      shadow.appendChild(btn2);

      const tagged = tagPiercedInteractiveElements(document);
      expect(tagged.length).toBe(2);
      expect(btn1.getAttribute('data-nim-id')).toBe('1');
      expect(btn2.getAttribute('data-nim-id')).toBe('2');
    });
  });

  describe('Observe & Affordance Formatting', () => {
    it('formats affordances cleanly into structured markdown output', () => {
      const mockAffordances: PageAffordances = {
        title: 'Store Checkout',
        url: 'https://store.example.com/checkout',
        actions: [
          { id: 1, kind: 'button', label: 'Place Order' },
          { id: 2, kind: 'link', label: 'Return to Cart' },
        ],
        inputs: [
          { id: 3, type: 'text', name: 'promo', label: 'Promo Code', placeholder: 'SAVE20' },
          { id: 4, type: 'email', name: 'email', label: 'Email Address', required: true },
        ],
        options: [
          { id: 5, kind: 'checkbox', label: 'Sign up for newsletter', checked: true },
          { id: 6, kind: 'select', label: 'Shipping Method', choices: ['Standard (Free)', 'Express ($15)'] },
        ],
        totalAffordances: 6,
      };

      const formatted = formatAffordances(mockAffordances);

      expect(formatted).toContain('OBSERVED PAGE: "Store Checkout"');
      expect(formatted).toContain('[1] BUTTON: "Place Order"');
      expect(formatted).toContain('[2] LINK: "Return to Cart"');
      expect(formatted).toContain('[3] text: "Promo Code"');
      expect(formatted).toContain('[REQUIRED]');
      expect(formatted).toContain('[5] CHECKBOX: "Sign up for newsletter" (CHECKED)');
      expect(formatted).toContain('[6] SELECT: "Shipping Method" options=["Standard (Free)", "Express ($15)"]');
    });
  });
});
