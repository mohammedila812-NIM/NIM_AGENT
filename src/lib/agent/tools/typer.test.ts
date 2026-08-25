import { describe, it, expect } from 'vitest';
import { isSensitiveField, typeIntoElement } from './typer';

describe('Typer Tool & Input Simulation', () => {
  it('detects sensitive password and credit card input elements', () => {
    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    expect(isSensitiveField(passwordInput)).toBe(true);

    const cardInput = document.createElement('input');
    cardInput.name = 'credit_card_number';
    expect(isSensitiveField(cardInput)).toBe(true);

    const normalInput = document.createElement('input');
    normalInput.name = 'search_query';
    expect(isSensitiveField(normalInput)).toBe(false);
  });

  it('throws a security error if attempted on sensitive fields', () => {
    const passwordInput = document.createElement('input');
    passwordInput.type = 'password';
    expect(() => typeIntoElement(passwordInput, 'secret123')).toThrowError(/SECURITY/);
  });

  it('types text and dispatches input and change events on normal inputs', () => {
    const input = document.createElement('input');
    let inputFired = false;
    let changeFired = false;

    input.addEventListener('input', () => {
      inputFired = true;
    });
    input.addEventListener('change', () => {
      changeFired = true;
    });

    typeIntoElement(input, 'Hello NVIDIA NIM');
    expect(input.value).toBe('Hello NVIDIA NIM');
    expect(inputFired).toBe(true);
    expect(changeFired).toBe(true);
  });
});
