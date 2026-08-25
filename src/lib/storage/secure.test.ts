import { describe, it, expect } from 'vitest';
import { saveProviderKeys, loadProviderKeys, clearProviderKeys, hasSessionKeys } from './secure';

describe('Session Storage for API Keys', () => {
  it('stores and retrieves keys in session storage', async () => {
    await saveProviderKeys('nim-cloud', {
      llmApiKey: 'nvapi-test-key-12345',
      searchApiKey: 'brave-search-key',
      searchProvider: 'brave',
    });

    const loaded = await loadProviderKeys('nim-cloud');
    expect(loaded).not.toBeNull();
    expect(loaded?.llmApiKey).toBe('nvapi-test-key-12345');
    expect(loaded?.searchProvider).toBe('brave');

    const hasKey = await hasSessionKeys('nim-cloud');
    expect(hasKey).toBe(true);
  });

  it('clears keys from session on reset', async () => {
    await saveProviderKeys('nim-cloud', { llmApiKey: 'nvapi-key' });
    await clearProviderKeys('nim-cloud');
    const loaded = await loadProviderKeys('nim-cloud');
    expect(loaded).toBeNull();
    expect(await hasSessionKeys('nim-cloud')).toBe(false);
  });
});
