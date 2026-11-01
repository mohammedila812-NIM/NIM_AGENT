import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractRetryDelayMs, chatCompletion, streamChatCompletion } from './client';
import type { ProviderConfig } from './types';

const mockConfig: ProviderConfig = {
  id: 'nim',
  label: 'NVIDIA NIM',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  apiKey: 'test-key',
  defaultModel: 'meta/llama-3.1-8b-instruct',
};

const mockRequest = {
  model: 'meta/llama-3.1-8b-instruct',
  messages: [{ role: 'user' as const, content: 'Hello' }],
};

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

describe('LLM Request Cancellation & Abort Handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aborts chatCompletion immediately without calling fetch if already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const onRetry = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      chatCompletion(mockConfig, mockRequest, { signal: controller.signal, onRetry })
    ).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('terminates chatCompletion on in-flight abort without retrying or calling onRetry', async () => {
    let fetchCalls = 0;
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url, options: RequestInit) => {
        fetchCalls++;
        return new Promise((_, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('The user aborted a request.', 'AbortError'));
          });
          controller.abort();
        });
      })
    );

    const onRetry = vi.fn();
    await expect(
      chatCompletion(mockConfig, mockRequest, {
        signal: controller.signal,
        onRetry,
        maxRetries: 4,
      })
    ).rejects.toThrow();

    expect(fetchCalls).toBe(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries non-abort transient network errors up to maxRetries', async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        fetchCalls++;
        if (fetchCalls < 2) {
          return Promise.reject(new Error('Failed to fetch'));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{ message: { role: 'assistant', content: 'Success after retry' } }],
          }),
        });
      })
    );

    const onRetry = vi.fn();
    const res = await chatCompletion(mockConfig, mockRequest, { onRetry, maxRetries: 3 });

    expect(fetchCalls).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(res.choices[0].message.content).toBe('Success after retry');
  });

  it('aborts streamChatCompletion immediately without yielding if already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const onRetry = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const stream = streamChatCompletion(mockConfig, mockRequest, undefined, {
      signal: controller.signal,
      onRetry,
    });

    await expect(stream.next()).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
