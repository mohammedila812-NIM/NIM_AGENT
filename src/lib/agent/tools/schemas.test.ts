import { describe, it, expect } from 'vitest';
import { validateToolCall } from './schemas';

describe('Tool Call Zod Validation', () => {
  it('validates a correct click_element call', () => {
    const valid = { tool: 'click_element', target: '#submit-button', description: 'Submit login form' };
    const res = validateToolCall(valid);
    expect(res.success).toBe(true);
  });

  it('rejects click_element with empty target', () => {
    const invalid = { tool: 'click_element', target: '' };
    const res = validateToolCall(invalid);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toContain('target must not be empty');
    }
  });

  it('validates navigate_to with valid URL and rejects invalid URL', () => {
    expect(validateToolCall({ tool: 'navigate_to', url: 'https://example.com' }).success).toBe(true);
    expect(validateToolCall({ tool: 'navigate_to', url: 'not-a-valid-url' }).success).toBe(false);
  });

  it('validates web_search query boundaries', () => {
    expect(validateToolCall({ tool: 'web_search', query: 'nvidia nim api' }).success).toBe(true);
    expect(validateToolCall({ tool: 'web_search', query: '' }).success).toBe(false);
  });
});
