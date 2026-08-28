import { listTasks, type StoredTask } from '../storage/tasks';

/**
 * Session Store — Two-Tier On-Demand Session Recall
 *
 * Tier 1: Per-Task turns (for intra-task recovery after context compression)
 * Tier 2: Global Session Log & Stored Tasks (for cross-task session recall across chat turns)
 *
 * Uses chrome.storage.session (ephemeral, tab-lifetime) with in-memory Map fallback.
 */

const MAX_TURNS_PER_TASK = 200;
const MAX_GLOBAL_TURNS = 300;
const STORAGE_KEY_PREFIX = 'session_recall:';
const GLOBAL_SESSION_KEY = 'session_recall:global';

export interface SessionTurn {
  step: number;
  tool: string;
  targetUrl?: string;
  content: string; // Sanitized tool result or message content
  timestamp: number;
  taskId?: string;
  taskInstruction?: string;
}

// In-memory fallback for environments where chrome.storage.session is missing
const memoryFallback = new Map<string, SessionTurn[]>();

function storageKey(taskId: string): string {
  return taskId === 'global' ? GLOBAL_SESSION_KEY : `${STORAGE_KEY_PREFIX}${taskId}`;
}

function hasSessionStorage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.session !== 'undefined'
  );
}

export async function readTurns(taskId: string): Promise<SessionTurn[]> {
  const key = storageKey(taskId);
  if (!hasSessionStorage()) {
    return memoryFallback.get(key) ?? [];
  }
  try {
    const result = await chrome.storage.session.get(key);
    return (result[key] as SessionTurn[] | undefined) ?? [];
  } catch {
    return memoryFallback.get(key) ?? [];
  }
}

async function saveTurns(taskId: string, turns: SessionTurn[]): Promise<void> {
  const key = storageKey(taskId);
  if (!hasSessionStorage()) {
    memoryFallback.set(key, turns);
    return;
  }
  try {
    await chrome.storage.session.set({ [key]: turns });
  } catch {
    memoryFallback.set(key, turns);
  }
}

/**
 * Record a tool execution turn.
 * Writes to both the per-task store and the global cross-task session log.
 */
export async function writeTurn(
  taskId: string,
  turn: Omit<SessionTurn, 'timestamp'>,
): Promise<void> {
  const sanitizedContent = turn.content
    .replace(/\[IMAGE_DATA:[^\]]{0,2000}\]/g, '[image captured]')
    .slice(0, 2000);

  const newTurn: SessionTurn = {
    ...turn,
    content: sanitizedContent,
    timestamp: Date.now(),
    taskId,
  };

  // 1. Save to per-task store
  const taskTurns = await readTurns(taskId);
  if (taskTurns.length >= MAX_TURNS_PER_TASK) {
    taskTurns.splice(0, taskTurns.length - MAX_TURNS_PER_TASK + 1);
  }
  taskTurns.push(newTurn);
  await saveTurns(taskId, taskTurns);

  // 2. Save to global session log
  const globalTurns = await readTurns('global');
  if (globalTurns.length >= MAX_GLOBAL_TURNS) {
    globalTurns.splice(0, globalTurns.length - MAX_GLOBAL_TURNS + 1);
  }
  globalTurns.push(newTurn);
  await saveTurns('global', globalTurns);
}

/**
 * Record when a task starts so cross-task recall knows what user instructions were asked.
 */
export async function recordTaskStart(taskId: string, instruction: string): Promise<void> {
  await writeTurn(taskId, {
    step: 0,
    tool: 'user_prompt',
    content: instruction,
    taskInstruction: instruction,
  });
}

/**
 * Record when a task completes with its final response.
 */
export async function recordTaskCompletion(
  taskId: string,
  instruction: string,
  finalResult: string,
): Promise<void> {
  await writeTurn(taskId, {
    step: 999,
    tool: 'agent_response',
    content: finalResult.slice(0, 1500),
    taskInstruction: instruction,
  });
}

/**
 * Query across both current task and global session history.
 */
export async function queryTurns(
  taskId: string,
  query: string,
  limit = 5,
): Promise<SessionTurn[]> {
  // Combine current task turns and global session turns
  const currentTaskTurns = await readTurns(taskId);
  const globalTurns = await readTurns('global');

  // De-duplicate turns by timestamp + tool + step
  const seen = new Set<string>();
  const allTurns: SessionTurn[] = [];

  for (const t of [...currentTaskTurns, ...globalTurns]) {
    const key = `${t.taskId || ''}:${t.step}:${t.tool}:${t.timestamp}`;
    if (!seen.has(key)) {
      seen.add(key);
      allTurns.push(t);
    }
  }

  if (allTurns.length === 0) return [];

  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 2);

  if (keywords.length === 0) {
    return allTurns.slice(-limit);
  }

  const scored = allTurns.map((turn) => {
    const haystack = `${turn.tool} ${turn.targetUrl ?? ''} ${turn.taskInstruction ?? ''} ${turn.content}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (haystack.includes(kw)) {
        score += 1;
        const occurrences = haystack.split(kw).length - 1;
        score += Math.min(occurrences - 1, 3) * 0.2;
      }
    }
    return { turn, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.turn.timestamp - a.turn.timestamp)
    .slice(0, limit)
    .map((s) => s.turn);
}

/**
 * Return the last `n` turns across the session (most recent first).
 */
export async function getRecentTurns(taskId: string, n: number): Promise<SessionTurn[]> {
  const currentTaskTurns = await readTurns(taskId);
  const globalTurns = await readTurns('global');

  // Combine and deduplicate
  const seen = new Set<string>();
  const allTurns: SessionTurn[] = [];

  for (const t of [...globalTurns, ...currentTaskTurns]) {
    const key = `${t.taskId || ''}:${t.step}:${t.tool}:${t.timestamp}`;
    if (!seen.has(key)) {
      seen.add(key);
      allTurns.push(t);
    }
  }

  return allTurns.slice(-Math.min(n, MAX_GLOBAL_TURNS)).reverse();
}

export async function getTurnCount(taskId: string): Promise<number> {
  const turns = await readTurns(taskId);
  return turns.length;
}

export async function clearSession(taskId: string): Promise<void> {
  const key = storageKey(taskId);
  memoryFallback.delete(key);
  if (!hasSessionStorage()) return;
  try {
    await chrome.storage.session.remove(key);
  } catch { /* ignore */ }
}

export async function clearAllSessions(): Promise<void> {
  memoryFallback.clear();
  if (!hasSessionStorage()) return;
  try {
    const all = await chrome.storage.session.get(null);
    const keysToRemove = Object.keys(all).filter((k) => k.startsWith(STORAGE_KEY_PREFIX));
    if (keysToRemove.length > 0) {
      await chrome.storage.session.remove(keysToRemove);
    }
  } catch { /* ignore */ }
}

/**
 * Format recalled turns and past session tasks as a clean markdown block.
 */
export function formatTurnsAsRecall(
  turns: SessionTurn[],
  pastTasks: StoredTask[] = [],
  query?: string,
): string {
  const sections: string[] = [];

  // 1. Previous Tasks in this Session (if any)
  if (pastTasks.length > 0) {
    const taskLines = pastTasks.slice(0, 5).map((t, idx) => {
      const time = new Date(t.createdAt).toLocaleTimeString();
      const statusBadge = t.status === 'done' ? '✅ Completed' : `[${t.status}]`;
      return `### Past Task ${idx + 1} (${time} · ${statusBadge}):\n- **User Prompt:** "${t.instruction}"\n- **Final Answer / Outcome:**\n${t.result ? t.result.slice(0, 600) : '(No output recorded)'}`;
    });
    sections.push(`## PREVIOUS TASKS IN SESSION (${pastTasks.length}):\n\n${taskLines.join('\n\n')}`);
  }

  // 2. Specific Tool Turns & Step Findings
  if (turns.length > 0) {
    const turnHeader = query
      ? `## MATCHING STEPS & FINDINGS (Query: "${query}"):`
      : `## RECENT STEPS & TOOL ACTIONS:`;

    const turnLines = turns.map((t) => {
      const time = new Date(t.timestamp).toLocaleTimeString();
      const urlPart = t.targetUrl ? ` · ${t.targetUrl}` : '';
      const toolLabel = t.tool === 'user_prompt' ? 'User Question' : t.tool === 'agent_response' ? 'Agent Final Answer' : `Step ${t.step} · ${t.tool}${urlPart}`;
      return `[${toolLabel} · ${time}]\n${t.content.slice(0, 800)}`;
    });

    sections.push(`${turnHeader}\n\n${turnLines.join('\n\n---\n\n')}`);
  }

  if (sections.length === 0) {
    return query
      ? `SESSION RECALL: No past tasks or tool turns found matching "${query}".`
      : `SESSION RECALL: No previous tasks or actions recorded in this session.`;
  }

  return sections.join('\n\n========================================\n\n');
}
