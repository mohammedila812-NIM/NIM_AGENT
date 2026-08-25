import type { ChatMessage } from '../llm/types';
import type { AgentAction } from '../messaging/protocol';

export type CheckpointStatus = 'running' | 'paused' | 'hitl_waiting' | 'plan_preview' | 'done' | 'error';

export interface AgentCheckpoint {
  version: 1;
  taskId: string;
  status: CheckpointStatus;
  currentStepIndex: number;
  originalIntent: string;
  taskScopeDomains: string[];
  transcript: ChatMessage[];
  pendingToolCall?: AgentAction;
  actionLog: Array<{ action: AgentAction; timestamp: number; undone?: boolean }>;
  timestamp: number;
}

const PREFIX = 'checkpoint:';

export async function saveCheckpoint(cp: AgentCheckpoint): Promise<void> {
  await chrome.storage.local.set({ [`${PREFIX}${cp.taskId}`]: { ...cp, timestamp: Date.now() } });
}

export async function loadCheckpoint(taskId: string): Promise<AgentCheckpoint | null> {
  const r = await chrome.storage.local.get(`${PREFIX}${taskId}`);
  return (r[`${PREFIX}${taskId}`] as AgentCheckpoint | undefined) ?? null;
}

export async function deleteCheckpoint(taskId: string): Promise<void> {
  await chrome.storage.local.remove(`${PREFIX}${taskId}`);
}

/** Return all checkpoints with status 'running' (interrupted tasks). */
export async function findInterruptedTasks(): Promise<AgentCheckpoint[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k, v]) => k.startsWith(PREFIX) && (v as AgentCheckpoint).status === 'running')
    .map(([, v]) => v as AgentCheckpoint);
}
