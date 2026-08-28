import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ProviderConfig,
} from './types';
import { parseSSEStream, collectStream } from './streaming';

export const DEFAULT_MAX_RETRIES = 5;
export const RETRY_BASE_MS = 2000;

export interface ChatCompletionOptions {
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number, reason: string) => void;
  maxRetries?: number;
}

function stripMetadata(messages: ChatMessage[]): Omit<ChatMessage, 'metadata'>[] {
  return messages.map(({ metadata: _m, ...rest }) => rest);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts exact retry delay in milliseconds from HTTP response headers or error body JSON/text.
 */
export function extractRetryDelayMs(
  responseStatus: number,
  headers: Headers | Record<string, string | null | undefined> | undefined,
  errorText: string,
  attempt: number,
): number {
  const getHeader = (name: string): string | null => {
    if (!headers) return null;
    if (typeof (headers as Headers).get === 'function') {
      return (headers as Headers).get(name);
    }
    const rec = headers as Record<string, string | null | undefined>;
    return rec[name.toLowerCase()] ?? rec[name] ?? null;
  };

  // 1. Check standard Retry-After header
  const retryAfter = getHeader('retry-after') || getHeader('x-ratelimit-reset');
  if (retryAfter) {
    const num = parseFloat(retryAfter);
    if (!isNaN(num) && num > 0) {
      // If greater than 100,000 it's likely an epoch timestamp in seconds/ms
      if (num > 1_000_000_000) {
        const targetMs = num > 1_000_000_000_000 ? num : num * 1000;
        const diff = targetMs - Date.now();
        if (diff > 0) return diff + 1500;
      }
      return num * 1000 + 1500;
    }
    const dateParsed = Date.parse(retryAfter);
    if (!isNaN(dateParsed)) {
      const diff = dateParsed - Date.now();
      if (diff > 0) return diff + 1500;
    }
  }

  // 2. Parse Google RPC / OpenAI JSON error body
  if (errorText) {
    try {
      const json = JSON.parse(errorText);
      const errObj = json.error || json;

      // Google RPC RetryInfo detail
      if (Array.isArray(errObj.details)) {
        for (const d of errObj.details) {
          if (d.retryDelay && typeof d.retryDelay === 'string') {
            const secMatch = d.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
            if (secMatch) {
              return Math.round(parseFloat(secMatch[1]) * 1000) + 1500;
            }
          }
        }
      }

      // Check nested message inside error object
      if (typeof errObj.message === 'string') {
        const msg = errObj.message;
        const match = msg.match(/(?:retry in|retry after|wait|retrydelay.*?)\s*(\d+(?:\.\d+)?)\s*(s|sec|seconds|ms)?/i);
        if (match) {
          const val = parseFloat(match[1]);
          const unit = (match[2] || 's').toLowerCase();
          return unit.startsWith('ms') ? Math.round(val) + 1000 : Math.round(val * 1000) + 1500;
        }
      }
    } catch {
      // Body is not JSON, check plain text regex below
    }

    // 3. Regex match on raw error text
    const textMatch = errorText.match(/(?:retry in|retry after|wait|quota exceeded.*?)\s*(\d+(?:\.\d+)?)\s*(s|sec|seconds|ms)?/i);
    if (textMatch) {
      const val = parseFloat(textMatch[1]);
      const unit = (textMatch[2] || 's').toLowerCase();
      return unit.startsWith('ms') ? Math.round(val) + 1000 : Math.round(val * 1000) + 1500;
    }
  }

  // 4. Default exponential backoff with jitter
  const backoff = responseStatus === 429 ? 5000 * Math.pow(1.8, attempt) : RETRY_BASE_MS * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(60000, Math.round(backoff + jitter));
}

/** Non-streaming chat completion with intelligent rate-limit retry and exact quota wait extraction. */
export async function chatCompletion(
  config: ProviderConfig,
  request: Omit<ChatCompletionRequest, 'stream'>,
  options?: ChatCompletionOptions,
): Promise<ChatCompletionResponse> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const body: ChatCompletionRequest = {
    ...request,
    messages: stripMetadata(request.messages as ChatMessage[]),
    stream: false,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey && config.id !== 'ollama') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 403 && (config.id === 'ollama' || config.baseUrl.includes('11434'))) {
          throw new Error(
            `Ollama 403 Forbidden: Ollama blocks browser extension requests by default. To fix, set environment variable OLLAMA_ORIGINS="*" and restart Ollama.`
          );
        }

        // Check if rate limited or server error eligible for retry
        const isRetryable = res.status === 429 || res.status === 503 || res.status === 502 || res.status === 504 || res.status === 500;
        if (isRetryable && attempt < maxRetries - 1) {
          const delayMs = extractRetryDelayMs(res.status, res.headers, text, attempt);
          const reason = res.status === 429 ? 'Rate limit / quota exceeded (429)' : `Server error (${res.status})`;
          options?.onRetry?.(attempt + 1, maxRetries, delayMs, reason);
          await delay(delayMs);
          continue;
        }

        throw new Error(`API error (${res.status}): ${text}`);
      }

      return (await res.json()) as ChatCompletionResponse;
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      const isAbortOrNetwork = err instanceof Error && (err.name === 'AbortError' || /fetch|network|failed/i.test(err.message));
      if (isAbortOrNetwork) {
        const delayMs = extractRetryDelayMs(0, undefined, '', attempt);
        options?.onRetry?.(attempt + 1, maxRetries, delayMs, 'Network connection retry');
        await delay(delayMs);
      } else {
        throw err;
      }
    }
  }
  throw new Error('Unreachable completion state');
}

/** Streaming chat completion that yields raw text chunks with retry support. */
export async function* streamChatCompletion(
  config: ProviderConfig,
  request: Omit<ChatCompletionRequest, 'stream'>,
  onChunk?: (text: string) => void,
  options?: ChatCompletionOptions,
): AsyncGenerator<string> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const body: ChatCompletionRequest = {
    ...request,
    messages: stripMetadata(request.messages as ChatMessage[]),
    stream: true,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        const isRetryable = res.status === 429 || res.status === 503 || res.status === 502;
        if (isRetryable && attempt < maxRetries - 1) {
          const delayMs = extractRetryDelayMs(res.status, res.headers, text, attempt);
          const reason = res.status === 429 ? 'Rate limit / quota exceeded (429)' : `Server error (${res.status})`;
          options?.onRetry?.(attempt + 1, maxRetries, delayMs, reason);
          await delay(delayMs);
          continue;
        }
        throw new Error(`API stream error (${res.status}): ${text}`);
      }

      const stream = parseSSEStream(res);
      const { content } = await collectStream(stream, (chunk) => {
        onChunk?.(chunk);
      });

      if (content) yield content;
      return;
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      const delayMs = extractRetryDelayMs(0, undefined, '', attempt);
      options?.onRetry?.(attempt + 1, maxRetries, delayMs, 'Stream connection retry');
      await delay(delayMs);
    }
  }
}
