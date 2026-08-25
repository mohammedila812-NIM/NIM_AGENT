const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedEntry {
  selector: string;
  lastValidated: number;
  successCount: number;
}

function makeKey(hostname: string, description: string): string {
  return `selectorCache:${hostname}::${description.toLowerCase().trim()}`;
}

export async function getCachedSelector(
  hostname: string,
  description: string,
): Promise<string | null> {
  const key = makeKey(hostname, description);
  const r = await chrome.storage.local.get(key);
  const entry = r[key] as CachedEntry | undefined;
  if (!entry) return null;
  if (Date.now() - entry.lastValidated > TTL_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return entry.selector;
}

export async function cacheSelector(
  hostname: string,
  description: string,
  selector: string,
): Promise<void> {
  const key = makeKey(hostname, description);
  const r = await chrome.storage.local.get(key);
  const existing = r[key] as CachedEntry | undefined;
  await chrome.storage.local.set({
    [key]: {
      selector,
      lastValidated: Date.now(),
      successCount: (existing?.successCount ?? 0) + 1,
    } satisfies CachedEntry,
  });
}
