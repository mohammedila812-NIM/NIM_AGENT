import { describe, it, expect } from 'vitest';
import { extractRetryDelayMs } from './client';

describe('Intelligent Rate-Limit & Delay Extraction', () => {
  it('extracts exact retryDelay from Google RPC JSON error body', () => {
    const errorJson = JSON.stringify({
      error: {
        code: 429,
        message: 'Quota exceeded for metric... Please retry in 35.638s.',
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '35s',
          },
        ],
      },
    });

    const delayMs = extractRetryDelayMs(429, undefined, errorJson, 0);
    // 35s * 1000 + 1500ms safety buffer = 36500ms
    expect(delayMs).toBe(36500);
  });

  it('extracts fractional delay from error message regex', () => {
    const errorMsg = 'API error (429): Quota exceeded. Please retry in 22.5s.';
    const delayMs = extractRetryDelayMs(429, undefined, errorMsg, 0);
    // 22.5s * 1000 + 1500ms safety buffer = 24000ms
    expect(delayMs).toBe(24000);
  });

  it('extracts delay from Retry-After header', () => {
    const headers = { 'retry-after': '45' };
    const delayMs = extractRetryDelayMs(429, headers, '', 0);
    // 45s * 1000 + 1500ms safety buffer = 46500ms
    expect(delayMs).toBe(46500);
  });

  it('provides sensible backoff when no exact delay is specified', () => {
    const delayMs = extractRetryDelayMs(429, undefined, 'Too many requests', 0);
    expect(delayMs).toBeGreaterThanOrEqual(4000);
    expect(delayMs).toBeLessThanOrEqual(60000);
  });
});
