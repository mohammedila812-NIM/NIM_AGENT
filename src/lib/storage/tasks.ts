export type TaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'hitl_waiting' | 'plan_preview';

export interface StoredTask {
  taskId: string;
  instruction: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  result?: string;
}

export interface MacroAction {
  tool: string;
  args?: Record<string, unknown>;
  targetLabel?: string;      // Semantic element label (e.g. "Add to Cart", "Search")
  reasoning?: string;
}

export interface Macro {
  macroId: string;
  name: string;
  instruction: string;
  actionSequence: MacroAction[];
  createdAt: number;
  runCount: number;
}

export const MAX_STORED_TASKS = 50;
export const TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_RESEARCH_NOTES = 50;
export const MAX_MACROS = 30;

/** Prunes tasks older than 7 days or exceeding the LRU limit. */
export async function pruneTasks(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const taskEntries = Object.entries(all)
    .filter(([k]) => k.startsWith('task:'))
    .map(([k, v]) => ({ key: k, task: v as StoredTask }))
    .sort((a, b) => b.task.createdAt - a.task.createdAt);

  const keysToRemove: string[] = [];

  // Remove tasks older than TTL
  for (const entry of taskEntries) {
    if (now - entry.task.createdAt > TASK_TTL_MS) {
      keysToRemove.push(entry.key);
    }
  }

  // Remove excess tasks beyond MAX_STORED_TASKS
  if (taskEntries.length - keysToRemove.length > MAX_STORED_TASKS) {
    const activeEntries = taskEntries.filter((e) => !keysToRemove.includes(e.key));
    const excess = activeEntries.slice(MAX_STORED_TASKS);
    for (const e of excess) {
      keysToRemove.push(e.key);
    }
  }

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}

export async function saveTask(task: StoredTask): Promise<void> {
  await chrome.storage.local.set({ [`task:${task.taskId}`]: task });
  // Automatic background eviction to prevent unbounded storage growth
  void pruneTasks().catch(() => {});
}

export async function loadTask(taskId: string): Promise<StoredTask | null> {
  const r = await chrome.storage.local.get(`task:${taskId}`);
  return (r[`task:${taskId}`] as StoredTask | undefined) ?? null;
}

export async function listTasks(): Promise<StoredTask[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith('task:'))
    .map(([, v]) => v as StoredTask)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteTask(taskId: string): Promise<void> {
  await chrome.storage.local.remove(`task:${taskId}`);
}

export async function saveMacro(macro: Macro): Promise<void> {
  await chrome.storage.local.set({ [`macro:${macro.macroId}`]: macro });
  // Prune excess macros if over limit
  const macros = await listMacros();
  if (macros.length > MAX_MACROS) {
    const oldest = macros.slice(MAX_MACROS);
    await chrome.storage.local.remove(oldest.map((m) => `macro:${m.macroId}`));
  }
}

export async function loadMacro(macroId: string): Promise<Macro | null> {
  const result = await chrome.storage.local.get(`macro:${macroId}`);
  return (result[`macro:${macroId}`] as Macro | undefined) ?? null;
}

export async function listMacros(): Promise<Macro[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith('macro:'))
    .map(([, v]) => v as Macro)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteMacro(macroId: string): Promise<void> {
  await chrome.storage.local.remove(`macro:${macroId}`);
}

export interface ResearchNote {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  summary: string;
  timestamp: number;
}

export async function appendResearchNote(note: Omit<ResearchNote, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): Promise<void> {
  const r = await chrome.storage.local.get('researchNotes');
  const existing = (r['researchNotes'] as ResearchNote[] | undefined) ?? [];
  const newNote: ResearchNote = {
    id: note.id ?? crypto.randomUUID(),
    sourceUrl: note.sourceUrl,
    sourceTitle: note.sourceTitle || 'Web Research Note',
    summary: note.summary,
    timestamp: note.timestamp ?? Date.now(),
  };
  const updated = [newNote, ...existing].slice(0, MAX_RESEARCH_NOTES);
  await chrome.storage.local.set({ researchNotes: updated });
}

export async function listResearchNotes(): Promise<ResearchNote[]> {
  const r = await chrome.storage.local.get('researchNotes');
  return (r['researchNotes'] as ResearchNote[] | undefined) ?? [];
}

export async function clearResearchNotes(): Promise<void> {
  await chrome.storage.local.remove('researchNotes');
}
