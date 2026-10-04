import { waitForPageSettled } from '../primitives/settle-gate';

/**
 * Normalizes input URL by trimming, validating safe protocols, and auto-prepending https:// if omitted.
 */
export function normalizeNavigationUrl(rawUrl: string): string {
  let trimmed = rawUrl.trim();
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    throw new Error(`SECURITY_BLOCKED: Disallowed navigation scheme in "${trimmed}"`);
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Invalid protocol: ${parsed.protocol}`);
    }
    return parsed.href;
  } catch (err) {
    throw new Error(`Invalid navigation URL: "${rawUrl}" - ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Navigate the active tab or open a new tab with automatic protocol resolution and settle verification. */
export async function navigateTo(url: string, newTab = false): Promise<number> {
  const safeUrl = normalizeNavigationUrl(url);
  let targetTabId: number;

  if (newTab) {
    const tab = await chrome.tabs.create({ url: safeUrl, active: true });
    if (!tab.id) throw new Error('Failed to create new browser tab');
    targetTabId = tab.id;
  } else {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error('No active browser tab found');
    targetTabId = activeTab.id;
    await chrome.tabs.update(targetTabId, { url: safeUrl });
  }

  // Wait for navigation and document complete
  await new Promise<void>((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    const timer = setTimeout(cleanup, 12_000); // 12s fallback timeout

    const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (tabId === targetTabId && info.status === 'complete') {
        clearTimeout(timer);
        cleanup();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });

  // Verify page settlement and hydration via Dual Settle Gate
  await waitForPageSettled(targetTabId, { maxWaitMs: 2000, idleThresholdMs: 300 });

  return targetTabId;
}

