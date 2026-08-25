import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ProviderConfig,
} from './types';
import { parseSSEStream, collectStream } from './streaming';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

function stripMetadata(messages: ChatMessage[]): Omit<ChatMessage, 'metadata'>[] {
  return messages.map(({ metadata: _m, ...rest }) => rest);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Non-streaming chat completion with automatic retry. */
export async function chatCompletion(
  config: ProviderConfig,
  request: Omit<ChatCompletionRequest, 'stream'>,
): Promise<ChatCompletionResponse> {
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

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
        throw new Error(`API error (${res.status}): ${text}`);
      }

      return (await res.json()) as ChatCompletionResponse;
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err;
      await delay(RETRY_BASE_MS * 2 ** attempt);
    }
  }
  throw new Error('Unreachable completion state');
}

/** Streaming chat completion that yields raw text chunks. */
export async function* streamChatCompletion(
  config: ProviderConfig,
  request: Omit<ChatCompletionRequest, 'stream'>,
  onChunk?: (text: string) => void,
): AsyncGenerator<string> {
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

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API stream error (${res.status}): ${text}`);
  }

  const stream = parseSSEStream(res);
  const { content } = await collectStream(stream, (chunk) => {
    onChunk?.(chunk);
  });

  if (content) yield content;
}
