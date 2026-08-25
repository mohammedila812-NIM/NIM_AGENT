import type { ChatMessage } from '../llm/types';
import type { DiscoveredModel } from '../llm/model-registry';

export type TruncationStrategy = 'none' | 'compress';

export function selectTruncationStrategy(contextLength: number): TruncationStrategy {
  return contextLength >= 500_000 ? 'none' : 'compress';
}

/** Rough token estimator: ~4 characters per token for English text. */
export function estimateTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + Math.ceil(content.length / 4);
  }, 0);
}

interface AtomicTurn {
  messages: ChatMessage[];
  isKeyFinding: boolean;
  isCompressed: boolean;
}

/**
 * Group messages into atomic turns so assistant tool_calls and their matching tool response
 * messages are never severed or orphaned during transcript compression (prevents 400 Bad Request).
 */
export function groupIntoAtomicTurns(messages: ChatMessage[]): AtomicTurn[] {
  const turns: AtomicTurn[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const group: ChatMessage[] = [msg];
      const isKeyFinding = msg.metadata?.isKeyFinding === true;
      const isCompressed = msg.metadata?.isCompressed === true;
      i++;

      // Include all corresponding tool messages belonging to this assistant turn
      while (i < messages.length && messages[i].role === 'tool') {
        group.push(messages[i]);
        i++;
      }

      turns.push({ messages: group, isKeyFinding, isCompressed });
    } else {
      turns.push({
        messages: [msg],
        isKeyFinding: msg.metadata?.isKeyFinding === true,
        isCompressed: msg.metadata?.isCompressed === true,
      });
      i++;
    }
  }

  return turns;
}

/**
 * Compress the transcript if it approaches 80% of the context budget.
 * System prompt, original task message, and key findings are NEVER compressed.
 * Atomic turn grouping ensures OpenAI / NIM tool_call pairing is strictly preserved.
 */
export async function compressIfNeeded(
  messages: ChatMessage[],
  model: DiscoveredModel,
  summarize: (text: string) => Promise<string>,
): Promise<ChatMessage[]> {
  const threshold = model.contextLength * 0.8;
  if (estimateTokens(messages) < threshold) return messages;

  if (messages.length < 4) return messages;

  const [sysMsg, taskMsg, ...rest] = messages;
  const turns = groupIntoAtomicTurns(rest);

  const keyFindingsTurns = turns.filter((t) => t.isKeyFinding);
  const compressibleTurns = turns.filter((t) => !t.isKeyFinding && !t.isCompressed);

  if (compressibleTurns.length < 3) return messages;

  const toCompressCount = Math.max(1, Math.floor(compressibleTurns.length * 0.35));
  const toCompressTurns = compressibleTurns.slice(0, toCompressCount);
  const toKeepTurns = compressibleTurns.slice(toCompressCount);

  const textToSummarize = toCompressTurns
    .flatMap((t) => t.messages)
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[${m.role}${m.tool_call_id ? ` id:${m.tool_call_id}` : ''}]: ${content}`;
    })
    .join('\n');

  const summary = await summarize(textToSummarize);

  const summaryMsg: ChatMessage = {
    role: 'system',
    content: `[COMPRESSED TRANSCRIPT — replaces ${toCompressTurns.flatMap((t) => t.messages).length} earlier turns]\n${summary}`,
    metadata: { isCompressed: true },
  };

  const keyFindingMessages = keyFindingsTurns.flatMap((t) => t.messages);
  const keptMessages = toKeepTurns.flatMap((t) => t.messages);

  return [sysMsg, taskMsg, summaryMsg, ...keyFindingMessages, ...keptMessages];
}
