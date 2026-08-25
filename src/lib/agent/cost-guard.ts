import { appendSecurityEvent } from '../security/audit-log';

export interface CostLimits {
  perTaskTokens: number; // default 50,000
  perDayTokens: number; // default 200,000
  perDayUsd: number; // default $2.00
}

export const DEFAULT_LIMITS: CostLimits = {
  perTaskTokens: 200_000,
  perDayTokens: 1_000_000,
  perDayUsd: 5.0,
};

export interface CostState {
  todayDate: string;
  todayTokens: number;
  todayCostUsd: number;
  taskTokens: number;
  taskCostUsd: number;
}

const KEY = 'costState';
const workerTokenUsage = new Map<string, number>();

async function loadState(): Promise<CostState> {
  const today = new Date().toISOString().slice(0, 10);
  const r = await chrome.storage.local.get(KEY);
  const stored = r[KEY] as CostState | undefined;
  if (!stored || stored.todayDate !== today) {
    return { todayDate: today, todayTokens: 0, todayCostUsd: 0, taskTokens: 0, taskCostUsd: 0 };
  }
  return stored;
}

async function saveState(state: CostState): Promise<void> {
  await chrome.storage.local.set({ [KEY]: state });
}

export async function resetTaskCounters(): Promise<void> {
  const state = await loadState();
  await saveState({ ...state, taskTokens: 0, taskCostUsd: 0 });
  workerTokenUsage.clear();
}

export async function resetDailyCounters(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await saveState({ todayDate: today, todayTokens: 0, todayCostUsd: 0, taskTokens: 0, taskCostUsd: 0 });
}

/** Check if next call is within budget. */
export async function checkBudget(
  estimatedTokens: number,
  costPerMillionTokens: number,
  limits: CostLimits = DEFAULT_LIMITS,
): Promise<{ allowed: boolean; reason?: string }> {
  const state = await loadState();
  const estimatedCost = (estimatedTokens / 1_000_000) * costPerMillionTokens;

  if (state.taskTokens + estimatedTokens > limits.perTaskTokens) {
    const reason = `Per-task token limit (${limits.perTaskTokens.toLocaleString()}) would be exceeded`;
    await appendSecurityEvent({ type: 'cost_limit_hit', limitType: 'per_task', detail: reason });
    return { allowed: false, reason };
  }
  if (state.todayTokens + estimatedTokens > limits.perDayTokens) {
    const reason = `Daily token limit (${limits.perDayTokens.toLocaleString()}) would be exceeded`;
    await appendSecurityEvent({ type: 'cost_limit_hit', limitType: 'per_day', detail: reason });
    return { allowed: false, reason };
  }
  if (state.todayCostUsd + estimatedCost > limits.perDayUsd) {
    const reason = `Daily cost limit ($${limits.perDayUsd.toFixed(2)}) would be exceeded`;
    await appendSecurityEvent({ type: 'cost_limit_hit', limitType: 'per_day', detail: reason });
    return { allowed: false, reason };
  }
  return { allowed: true };
}

/** Allocate and check token budget for an individual sub-agent worker. */
export function checkWorkerBudget(
  workerId: string,
  estimatedTokens: number,
  workerMaxTokens = 25_000,
): { allowed: boolean; reason?: string } {
  const current = workerTokenUsage.get(workerId) ?? 0;
  if (current + estimatedTokens > workerMaxTokens) {
    return {
      allowed: false,
      reason: `Worker token allocation (${workerMaxTokens.toLocaleString()}) exceeded for sub-agent ${workerId}`,
    };
  }
  return { allowed: true };
}

/** Record usage for an individual worker sub-agent. */
export function recordWorkerUsage(workerId: string, tokensUsed: number): void {
  const current = workerTokenUsage.get(workerId) ?? 0;
  workerTokenUsage.set(workerId, current + tokensUsed);
}

/** Clear worker quota when worker completes. */
export function clearWorkerBudget(workerId: string): void {
  workerTokenUsage.delete(workerId);
}

/** Record usage after completing an LLM step. */
export async function recordUsage(tokensUsed: number, costUsd: number): Promise<CostState> {
  const state = await loadState();
  const updated: CostState = {
    ...state,
    todayTokens: state.todayTokens + tokensUsed,
    todayCostUsd: state.todayCostUsd + costUsd,
    taskTokens: state.taskTokens + tokensUsed,
    taskCostUsd: state.taskCostUsd + costUsd,
  };
  await saveState(updated);
  return updated;
}

export async function getCurrentCostState(): Promise<CostState> {
  return loadState();
}
