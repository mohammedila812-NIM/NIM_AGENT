/**
 * Scheduled & Triggered Monitoring (Watch Mode) Storage
 *
 * Persists watch targets and synchronizes with chrome.alarms.
 *
 * Sub-minute intervals (e.g. 20 seconds) are stored in `intervalSeconds`
 * and scheduled using fractional periodInMinutes in chrome.alarms.
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
  intervalMinutes: number;            // Polling interval in minutes (display/alarm, may be fractional for sub-minute)
  intervalSeconds?: number;           // True interval in seconds (source of truth). Derived as intervalMinutes*60 when absent (back-compat).
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

/**
 * Minimum period supported by chrome.alarms in production Manifest V3 (in minutes).
 * Chrome enforces 0.5 minutes (30 seconds) in modern Chromium; values below this
 * produce runtime warnings and are clamped by the browser.
 */
export const MIN_MV3_ALARM_PERIOD_MINUTES = 0.5; // 30 seconds

/**
 * Parse a natural-language or numeric duration string into seconds.
 *
 * Supported formats:
 *   - "20sec" | "20s" | "20 seconds"   → 20 seconds
 *   - "2min"  | "2m" | "2 minutes"     → 120 seconds
 *   - "1h"    | "1 hour" | "1 hours"   → 3600 seconds
 *   - 15 (bare number)                 → treated as minutes by default (15 * 60 = 900 seconds)
 *
 * @param raw - A string or number from the user or LLM
 * @param defaultSeconds - Fallback if parsing fails (default: 1800 = 30 min)
 * @param defaultUnit - Unit assumed for bare numbers (default: 'minutes')
 */
export function parseDuration(
  raw: string | number | undefined,
  defaultSeconds = 1800,
  defaultUnit: 'seconds' | 'minutes' = 'minutes',
): number {
  if (raw === undefined || raw === null) return defaultSeconds;

  if (typeof raw === 'number') {
    if (isNaN(raw) || raw <= 0) return defaultSeconds;
    return defaultUnit === 'seconds' ? raw : Math.round(raw * 60);
  }

  const s = String(raw).trim().toLowerCase();
  if (!s) return defaultSeconds;

  // Match explicit seconds: "20sec", "20s", "20 seconds", "20second"
  const secMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:sec(?:ond)?s?|s)$/);
  if (secMatch) return Math.round(parseFloat(secMatch[1]));

  // Match explicit minutes: "2min", "2m", "2 minutes", "2minute"
  const minMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?|m)$/);
  if (minMatch) return Math.round(parseFloat(minMatch[1]) * 60);

  // Match explicit hours: "1h", "1hr", "1 hour", "1hours"
  const hrMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:h(?:r|our)?s?)$/);
  if (hrMatch) return Math.round(parseFloat(hrMatch[1]) * 3600);

  // Bare number string: "15", "30", etc.
  const num = parseFloat(s);
  if (!isNaN(num) && num > 0) {
    return defaultUnit === 'seconds' ? num : Math.round(num * 60);
  }

  return defaultSeconds;
}

/** Format an interval in seconds to a human-readable string (e.g. "20 seconds", "5 minutes"). */
export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  const mins = seconds / 60;
  if (mins < 60) return `${mins % 1 === 0 ? mins : mins.toFixed(1)} minute${mins !== 1 ? 's' : ''}`;
  const hrs = seconds / 3600;
  return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hour${hrs !== 1 ? 's' : ''}`;
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

  // Back-compat: if an old persisted record is missing intervalSeconds, derive it from intervalMinutes
  const intervalSeconds = watch.intervalSeconds ?? watch.intervalMinutes * 60;
  const periodInMinutes = intervalSeconds / 60; // fractional minutes are valid in chrome.alarms MV3

  const updated: WatchTarget = {
    ...watch,
    intervalSeconds,
    intervalMinutes: periodInMinutes,
    updatedAt: Date.now(),
  };

  await chrome.storage.local.set({ [key]: updated });

  // Sync alarm for this specific watch
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    const aName = alarmName(watch.watchId);
    if (updated.status === 'active') {
      // In production Chrome MV3, alarms enforce a minimum period of 0.5 minutes (30s).
      const safeAlarmPeriod = Math.max(MIN_MV3_ALARM_PERIOD_MINUTES, periodInMinutes);
      await chrome.alarms.create(aName, {
        periodInMinutes: safeAlarmPeriod,
        delayInMinutes: safeAlarmPeriod,
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
        // Back-compat: derive intervalSeconds if missing from old stored records
        const intervalSeconds = watch.intervalSeconds ?? watch.intervalMinutes * 60;
        const periodInMinutes = intervalSeconds / 60;
        const safeAlarmPeriod = Math.max(MIN_MV3_ALARM_PERIOD_MINUTES, periodInMinutes);
        await chrome.alarms.create(aName, {
          periodInMinutes: safeAlarmPeriod,
          delayInMinutes: safeAlarmPeriod,
        });
      }
    } else {
      await chrome.alarms.clear(aName);
    }
  }
}
