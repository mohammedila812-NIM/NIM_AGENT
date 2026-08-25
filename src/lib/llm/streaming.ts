import type { ChatCompletionChunk, ToolCall } from './types';

/** Parse an OpenAI-compatible SSE stream and yield parsed JSON chunks. */
export async function* parseSSEStream(
  response: Response,
): AsyncGenerator<ChatCompletionChunk> {
  if (!response.body) throw new Error('Response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          yield json as ChatCompletionChunk;
        } catch {
          // Ignore malformed chunk lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Accumulate a streaming response into text and tool calls. */
export async function collectStream(
  stream: AsyncGenerator<ChatCompletionChunk>,
  onChunk?: (text: string) => void,
): Promise<{ content: string; toolCalls: ToolCall[]; totalTokens: number }> {
  let content = '';
  const toolCallAccumulator: Map<number, ToolCall> = new Map();
  let totalTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      content += delta.content;
      onChunk?.(delta.content);
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.index === undefined) continue;
        const existing = toolCallAccumulator.get(tc.index);
        if (!existing) {
          toolCallAccumulator.set(tc.index, {
            id: tc.id ?? `call_${tc.index}_${Date.now()}`,
            type: 'function',
            function: {
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            },
          });
        } else {
          existing.function.arguments += tc.function?.arguments ?? '';
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name = tc.function.name;
        }
      }
    }

    if (chunk.usage) {
      totalTokens = chunk.usage.total_tokens;
    }
  }

  return {
    content,
    toolCalls: Array.from(toolCallAccumulator.values()),
    totalTokens,
  };
}
