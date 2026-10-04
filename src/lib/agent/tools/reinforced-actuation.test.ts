import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveInteractiveContainer,
  isElementDisabled,
  isElementOccluded,
  clickElement,
} from './clicker';
import { typeIntoElement } from './typer';

describe('Reinforced Clicker — Actuation & Edge Cases', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('climbs SVG child to its parent button container', () => {
    document.body.innerHTML = `
      <button id="search-btn">
        <svg id="search-icon"><path id="search-path" d="M0 0h10v10H0z"/></svg>
      </button>
    `;
    const path = document.getElementById('search-path');
    const container = resolveInteractiveContainer(path);
    expect(container).not.toBeNull();
    expect(container?.id).toBe('search-btn');
    expect(container?.tagName).toBe('BUTTON');
  });

  it('climbs text span to its parent link container', () => {
    document.body.innerHTML = `
      <a href="/pricing" id="pricing-link">
        <span id="pricing-text">View Pricing</span>
      </a>
    `;
    const span = document.getElementById('pricing-text');
    const container = resolveInteractiveContainer(span);
    expect(container?.id).toBe('pricing-link');
    expect(container?.tagName).toBe('A');
  });

  it('detects disabled element and blocks click with informative error', () => {
    document.body.innerHTML = `
      <button id="disabled-btn" disabled>Submit</button>
      <button id="aria-disabled-btn" aria-disabled="true">Save</button>
    `;
    const btn1 = document.getElementById('disabled-btn') as HTMLButtonElement;
    const btn2 = document.getElementById('aria-disabled-btn') as HTMLButtonElement;

    expect(isElementDisabled(btn1)).toBe(true);
    expect(isElementDisabled(btn2)).toBe(true);

    const res1 = clickElement(btn1);
    expect(res1.success).toBe(false);
    expect(res1.error).toContain('ELEMENT_DISABLED');

    const res2 = clickElement(btn2);
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('ELEMENT_DISABLED');
  });

  it('dispatches full pointer, mouse, and click lifecycle on valid button', () => {
    document.body.innerHTML = `<button id="active-btn">Click Me</button>`;
    const btn = document.getElementById('active-btn') as HTMLButtonElement;

    const eventsFired: string[] = [];
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((evt) => {
      btn.addEventListener(evt, () => eventsFired.push(evt));
    });

    const res = clickElement(btn);
    expect(res.success).toBe(true);
    expect(eventsFired).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  });

  it('toggles checkbox input correctly and fires input + change', () => {
    document.body.innerHTML = `<input type="checkbox" id="agree-chk" />`;
    const chk = document.getElementById('agree-chk') as HTMLInputElement;

    let changeFired = false;
    chk.addEventListener('change', () => { changeFired = true; });

    expect(chk.checked).toBe(false);
    clickElement(chk);
    expect(chk.checked).toBe(true);
    expect(changeFired).toBe(true);
  });
});

describe('Reinforced Typer — Framework Lifecycle & Enter Submit', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('dispatches full keydown -> keypress -> input -> keyup -> change pipeline', () => {
    document.body.innerHTML = `<input type="text" id="username" />`;
    const input = document.getElementById('username') as HTMLInputElement;

    const eventSequence: string[] = [];
    ['keydown', 'keypress', 'input', 'keyup', 'change'].forEach((evt) => {
      input.addEventListener(evt, () => eventSequence.push(evt));
    });

    typeIntoElement(input, 'elonmusk');
    expect(input.value).toBe('elonmusk');
    expect(eventSequence).toEqual(['keydown', 'keypress', 'input', 'keyup', 'change']);
  });

  it('supports append mode without wiping existing value', () => {
    document.body.innerHTML = `<input type="text" id="query" value="wireless " />`;
    const input = document.getElementById('query') as HTMLInputElement;

    typeIntoElement(input, 'headphones', { mode: 'append' });
    expect(input.value).toBe('wireless headphones');
  });

  it('submits parent form when submitWithEnter is enabled', () => {
    document.body.innerHTML = `
      <form id="search-form">
        <input type="text" id="search-box" />
        <button type="submit">Go</button>
      </form>
    `;
    const form = document.getElementById('search-form') as HTMLFormElement;
    const input = document.getElementById('search-box') as HTMLInputElement;

    let formSubmitted = false;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      formSubmitted = true;
    });

    typeIntoElement(input, 'nvidia nim', { submitWithEnter: true });
    expect(input.value).toBe('nvidia nim');
    expect(formSubmitted).toBe(true);
  });

  it('blocks typing into sensitive password fields for security', () => {
    document.body.innerHTML = `<input type="password" id="user-pass" />`;
    const pass = document.getElementById('user-pass') as HTMLInputElement;

    expect(() => {
      typeIntoElement(pass, 'secret123');
    }).toThrow('SECURITY');
  });
});
