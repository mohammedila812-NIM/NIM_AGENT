/**
 * Shared Persistent Scratchpad
 *
 * Ephemeral session key-value store shared across main agent turns and parallel sub-agents.
 * Survives transcript compression and tool execution breaks.
 */

const STORAGE_KEY = 'nim_scratchpad';

export interface ScratchpadEntry {
  key: string;
  value: string;
  notes?: string;
  updatedAt: number;
}

const memoryScratchpad = new Map<string, ScratchpadEntry>();

function hasSessionStorage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.session !== 'undefined'
  );
}

async function loadAllEntries(): Promise<Record<string, ScratchpadEntry>> {
  if (!hasSessionStorage()) {
    const obj: Record<string, ScratchpadEntry> = {};
    memoryScratchpad.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  }
  try {
    const res = await chrome.storage.session.get(STORAGE_KEY);
    return (res[STORAGE_KEY] as Record<string, ScratchpadEntry> | undefined) ?? {};
  } catch {
    const obj: Record<string, ScratchpadEntry> = {};
    memoryScratchpad.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  }
}

async function saveAllEntries(entries: Record<string, ScratchpadEntry>): Promise<void> {
  if (!hasSessionStorage()) {
    memoryScratchpad.clear();
    Object.entries(entries).forEach(([k, v]) => memoryScratchpad.set(k, v));
    return;
  }
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: entries });
  } catch {
    memoryScratchpad.clear();
    Object.entries(entries).forEach(([k, v]) => memoryScratchpad.set(k, v));
  }
}

export async function setScratchpadVar(
  key: string,
  value: string,
  notes?: string,
): Promise<ScratchpadEntry> {
  const cleanKey = key.trim().toLowerCase();
  const entry: ScratchpadEntry = {
    key: cleanKey,
    value: value.trim(),
    notes: notes?.trim() || undefined,
    updatedAt: Date.now(),
  };

  const all = await loadAllEntries();
  all[cleanKey] = entry;
  await saveAllEntries(all);
  return entry;
}

export async function getScratchpadVar(key: string): Promise<ScratchpadEntry | null> {
  const cleanKey = key.trim().toLowerCase();
  const all = await loadAllEntries();
  return all[cleanKey] ?? null;
}

export async function listScratchpadVars(): Promise<ScratchpadEntry[]> {
  const all = await loadAllEntries();
  return Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteScratchpadVar(key: string): Promise<boolean> {
  const cleanKey = key.trim().toLowerCase();
  const all = await loadAllEntries();
  if (cleanKey in all) {
    delete all[cleanKey];
    await saveAllEntries(all);
    return true;
  }
  return false;
}

export async function clearScratchpad(): Promise<void> {
  memoryScratchpad.clear();
  if (hasSessionStorage()) {
    try {
      await chrome.storage.session.remove(STORAGE_KEY);
    } catch { /* ignore */ }
  }
}

/**
 * Execute scratchpad_write tool action.
 */
export async function executeScratchpadWrite(
  key: string,
  value: string,
  notes?: string,
): Promise<string> {
  const entry = await setScratchpadVar(key, value, notes);
  const notesStr = entry.notes ? ` (Notes: "${entry.notes}")` : '';
  return `SCRATCHPAD UPDATED: Saved variable "${entry.key}" = "${entry.value}"${notesStr}`;
}

/**
 * Execute scratchpad_read tool action.
 */
export async function executeScratchpadRead(key?: string): Promise<string> {
  if (key && key.trim().length > 0) {
    const entry = await getScratchpadVar(key);
    if (!entry) {
      return `SCRATCHPAD: Variable "${key.trim()}" not found in session memory.`;
    }
    const time = new Date(entry.updatedAt).toLocaleTimeString();
    const notesStr = entry.notes ? `\nNotes: ${entry.notes}` : '';
    return `SCRATCHPAD [${entry.key}] (Updated: ${time}):\nValue: ${entry.value}${notesStr}`;
  }

  const all = await listScratchpadVars();
  if (all.length === 0) {
    return 'SCRATCHPAD: No variables stored in this session.';
  }

  const lines = all.map((e) => {
    const notes = e.notes ? ` — ${e.notes}` : '';
    return `- **${e.key}**: "${e.value}"${notes}`;
  });

  return `SCRATCHPAD (${all.length} variables stored):\n${lines.join('\n')}`;
}
