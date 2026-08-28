/**
 * Scheduled & Triggered Monitoring (Watch Mode) Storage
 *
 * Persists watch targets and synchronizes with chrome.alarms.
 */

export type WatchType = 'element_text' | 'price' | 'dom_selector' | 'macro' | 'llm_condition';

export interface WatchTarget {
  watchId: string;
  name: string;
  url: string;
  type: WatchType;
  selector?: string;                  // CSS selector or element identifier
  conditionPrompt?: string;           // Optional semantic condition e.g. "Price < $650"
  macroId?: string;                   // Optional macro to execute before checking
  intervalMinutes: number;            // Polling interval in minutes (5, 15, 30, 60, etc.)
  lastSnapshot?: string;              // Last extracted text or JSON
  lastCheckedAt?: number;
  lastChangedAt?: number;
  status: 'active' | 'paused' | 'error';
  alertCount: number;
  notificationOnMatch: boolean;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_PREFIX = 'watch:';
export const ALARM_PREFIX = 'watch:';
export const MAX_WATCH_TARGETS = 30;

function storageKey(watchId: string): string {
  return `${STORAGE_PREFIX}${watchId}`;
}

export function alarmName(watchId: string): string {
  return `${ALARM_PREFIX}${watchId}`;
}

export async function saveWatch(watch: WatchTarget): Promise<void> {
  const key = storageKey(watch.watchId);
  const updated: WatchTarget = {
    ...watch,
    updatedAt: Date.now(),
  };

  await chrome.storage.local.set({ [key]: updated });

  // Sync alarm for this specific watch
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    const aName = alarmName(watch.watchId);
    if (updated.status === 'active') {
      await chrome.alarms.create(aName, {
        periodInMinutes: Math.max(1, updated.intervalMinutes),
        delayInMinutes: Math.max(1, updated.intervalMinutes),
      });
    } else {
      await chrome.alarms.clear(aName);
    }
  }
}

export async function loadWatch(watchId: string): Promise<WatchTarget | null> {
  const key = storageKey(watchId);
  const res = await chrome.storage.local.get(key);
  return (res[key] as WatchTarget | undefined) ?? null;
}

export async function listWatches(): Promise<WatchTarget[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(STORAGE_PREFIX))
    .map(([, v]) => v as WatchTarget)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteWatch(watchId: string): Promise<void> {
  const key = storageKey(watchId);
  await chrome.storage.local.remove(key);

  if (typeof chrome !== 'undefined' && chrome.alarms) {
    try {
      await chrome.alarms.clear(alarmName(watchId));
    } catch { /* ignore */ }
  }
}

export async function toggleWatchStatus(watchId: string): Promise<WatchTarget | null> {
  const watch = await loadWatch(watchId);
  if (!watch) return null;

  const nextStatus = watch.status === 'active' ? 'paused' : 'active';
  const updated: WatchTarget = {
    ...watch,
    status: nextStatus,
    updatedAt: Date.now(),
  };

  await saveWatch(updated);
  return updated;
}

/**
 * Synchronize all alarms on background service worker boot.
 */
export async function syncWatchAlarms(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;

  const watches = await listWatches();
  for (const watch of watches) {
    const aName = alarmName(watch.watchId);
    if (watch.status === 'active') {
      const existing = await chrome.alarms.get(aName);
      if (!existing) {
        await chrome.alarms.create(aName, {
          periodInMinutes: Math.max(1, watch.intervalMinutes),
          delayInMinutes: Math.max(1, watch.intervalMinutes),
        });
      }
    } else {
      await chrome.alarms.clear(aName);
    }
  }
}
