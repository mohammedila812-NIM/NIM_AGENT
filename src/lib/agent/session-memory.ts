/**
 * Lifelong Conversational Session Memory & Auto-Summarizer
 * Preserves cross-turn context, user preferences, and workspace assets
 * without token explosion by intelligently compressing older turns into
 * rolling memory while preserving recent conversational dialogue verbatim.
 */

import type { ChatMessage, ProviderConfig } from '../llm/types';
import { chatCompletion } from '../llm/client';
import { vfs } from '../workspace/vfs';
import { recordTaskCompletion, recordTaskStart } from './session-store';

export interface HistoryTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const MAX_VERBATIM_TURNS = 4;
const COMPRESSION_THRESHOLD_TURNS = 6;

/**
 * Builds an initial transcript that combines system prompts,
 * auto-summarized long-term memory, recent conversation turns,
 * and workspace asset awareness.
 */
export async function buildMemoryEnrichedTranscript(
  instruction: string,
  systemPrompt: string,
  history: HistoryTurn[] = [],
  providerConfig?: ProviderConfig,
  modelId?: string,
): Promise<ChatMessage[]> {
  // If no history, return standard 2-message transcript
  if (!history || history.length === 0) {
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: instruction },
    ];
  }

  // Filter out empty or welcome turns
  const cleanHistory = history.filter(
    (h) => h.content && h.content.trim().length > 0 && !h.content.includes('I am your NIM AI agent')
  );

  if (cleanHistory.length === 0) {
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: instruction },
    ];
  }

  // 1. If history is short (<= 6 turns), include all of them verbatim
  if (cleanHistory.length <= COMPRESSION_THRESHOLD_TURNS) {
    const formattedHistory: ChatMessage[] = cleanHistory.map((h) => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content,
    }));

    return [
      { role: 'system', content: systemPrompt },
      ...formattedHistory,
      { role: 'user', content: instruction },
    ];
  }

  // 2. If history is long, partition into older turns (to compress) and recent turns (to keep verbatim)
  const olderTurns = cleanHistory.slice(0, cleanHistory.length - MAX_VERBATIM_TURNS);
  const recentTurns = cleanHistory.slice(cleanHistory.length - MAX_VERBATIM_TURNS);

  let memorySummary = '';

  if (providerConfig && modelId) {
    try {
      memorySummary = await generateRollingMemorySummary(olderTurns, providerConfig, modelId);
    } catch {
      // Fallback: rule-based compression
      memorySummary = olderTurns
        .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.slice(0, 150)}...`)
        .join('\n');
    }
  } else {
    memorySummary = olderTurns
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.slice(0, 150)}...`)
      .join('\n');
  }

  // Check recent workspace files to ground memory
  let recentWorkspaceFilesText = '';
  try {
    await vfs.init();
    const files = await vfs.listFiles('/', true);
    if (files.length > 0) {
      const topFiles = files
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5)
        .map((f) => `- ${f.path} (${f.extension}, ${f.sizeBytes}B)`);
      recentWorkspaceFilesText = `\nActive Workspace Assets Available:\n${topFiles.join('\n')}`;
    }
  } catch {
    // Ignore VFS read error
  }

  const enrichedSystemPrompt = `${systemPrompt}

---
## 🧠 CONTINUOUS SESSION MEMORY & ROLLING CONTEXT:
The user and you have an ongoing conversation. Below is the executive memory summary of prior turns in this session. Use this context to answer follow-up queries seamlessly without asking the user to repeat themselves.

${memorySummary}
${recentWorkspaceFilesText}
---`;

  const formattedRecentTurns: ChatMessage[] = recentTurns.map((h) => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: h.content,
  }));

  return [
    { role: 'system', content: enrichedSystemPrompt },
    ...formattedRecentTurns,
    { role: 'user', content: instruction },
  ];
}

/**
 * Summarize older conversation turns into a high-density memory block.
 */
async function generateRollingMemorySummary(
  turns: HistoryTurn[],
  providerConfig: ProviderConfig,
  modelId: string,
): Promise<string> {
  const turnsText = turns
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join('\n\n');

  const prompt = `You are a memory synthesis engine for an AI browser agent.
Summarize the following prior conversation turns into a high-density, fact-preserving memory log.

Prior Turns:
${turnsText.slice(0, 6000)}

Guidelines:
- Extract completed user tasks, actions taken, active context, user preferences, and any code or files created.
- Accurately preserve facts without hallucinating unmentioned topics.
- Format as 2-4 concise bullet points.
- Maximum 150 words.`;

  const res = await chatCompletion(providerConfig, {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 300,
  });

  return res.choices[0]?.message?.content?.trim() || 'Prior turns summarized.';
}

export { recordTaskStart, recordTaskCompletion };
