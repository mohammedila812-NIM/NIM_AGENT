import type { WatchPageChangesOptions } from './change-detector';

export interface ActiveSentinelWatcher {
  tabId: number;
  url: string;
  options: WatchPageChangesOptions;
  createdAt: number;
  lastAlertAt?: number;
}

export interface SentinelUnseenAlert {
  alertId: string;
  tabId: number;
  target: string;
  summary: string;
  timestamp: number;
  url: string;
}

const STORAGE_KEY_WATCHERS = 'nim_sentinel_active_watchers';
const STORAGE_KEY_ALERTS = 'nim_sentinel_unseen_alerts';

/** Get session or local storage based on environment */
function getStorage() {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    return chrome.storage.session;
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return chrome.storage.local;
  }
  return null;
}

/** Save an active sentinel watcher config keyed by tabId */
export async function saveActiveWatcher(tabId: number, watcher: ActiveSentinelWatcher): Promise<void> {
  const store = getStorage();
  if (!store) return;
  const data = (await store.get(STORAGE_KEY_WATCHERS)) as Record<string, Record<string, ActiveSentinelWatcher>>;
  const watchers = data[STORAGE_KEY_WATCHERS] || {};
  watchers[String(tabId)] = watcher;
  await store.set({ [STORAGE_KEY_WATCHERS]: watchers });
  await updateExtensionBadge();
}

/** Get active sentinel watcher config for a tab */
export async function getActiveWatcher(tabId: number): Promise<ActiveSentinelWatcher | null> {
  const store = getStorage();
  if (!store) return null;
  const data = (await store.get(STORAGE_KEY_WATCHERS)) as Record<string, Record<string, ActiveSentinelWatcher>>;
  const watchers = data[STORAGE_KEY_WATCHERS] || {};
  return watchers[String(tabId)] || null;
}

/** Remove active sentinel watcher for a tab */
export async function removeActiveWatcher(tabId: number): Promise<void> {
  const store = getStorage();
  if (!store) return;
  const data = (await store.get(STORAGE_KEY_WATCHERS)) as Record<string, Record<string, ActiveSentinelWatcher>>;
  const watchers = data[STORAGE_KEY_WATCHERS] || {};
  delete watchers[String(tabId)];
  await store.set({ [STORAGE_KEY_WATCHERS]: watchers });
  await updateExtensionBadge();
}

/** Get all registered active sentinel watchers across all tabs */
export async function getAllActiveWatchers(): Promise<ActiveSentinelWatcher[]> {
  const store = getStorage();
  if (!store) return [];
  const data = (await store.get(STORAGE_KEY_WATCHERS)) as Record<string, Record<string, ActiveSentinelWatcher>>;
  const watchers = data[STORAGE_KEY_WATCHERS] || {};
  return Object.values(watchers);
}

/** Persist unseen alert */
export async function saveUnseenAlert(alert: SentinelUnseenAlert): Promise<void> {
  const store = getStorage();
  if (!store) return;
  const data = (await store.get(STORAGE_KEY_ALERTS)) as Record<string, SentinelUnseenAlert[]>;
  const list = data[STORAGE_KEY_ALERTS] || [];
  list.push(alert);
  // Keep last 50 alerts
  const trimmed = list.slice(-50);
  await store.set({ [STORAGE_KEY_ALERTS]: trimmed });
  await updateExtensionBadge();
}

/** Retrieve all unseen alerts */
export async function getUnseenAlerts(): Promise<SentinelUnseenAlert[]> {
  const store = getStorage();
  if (!store) return [];
  const data = (await store.get(STORAGE_KEY_ALERTS)) as Record<string, SentinelUnseenAlert[]>;
  return data[STORAGE_KEY_ALERTS] || [];
}

/** Clear all unseen alerts */
export async function clearUnseenAlerts(): Promise<void> {
  const store = getStorage();
  if (!store) return;
  await store.set({ [STORAGE_KEY_ALERTS]: [] });
  await updateExtensionBadge();
}

/** Update extension action badge text */
export async function updateExtensionBadge(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;
  try {
    const alerts = await getUnseenAlerts();
    const watchers = await getAllActiveWatchers();

    if (alerts.length > 0) {
      await chrome.action.setBadgeText({ text: String(alerts.length) });
      await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red for alerts
    } else if (watchers.length > 0) {
      await chrome.action.setBadgeText({ text: '●' });
      await chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' }); // Blue for active watchers
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // Ignore badge errors in test environment
  }
}
