/** Navigate the active tab or open a new tab. Must be called from background context. */
export async function navigateTo(url: string, newTab = false): Promise<number> {
  let targetTabId: number;

  if (newTab) {
    const tab = await chrome.tabs.create({ url, active: true });
    if (!tab.id) throw new Error('Failed to create new browser tab');
    targetTabId = tab.id;
  } else {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error('No active browser tab found');
    targetTabId = activeTab.id;
    await chrome.tabs.update(targetTabId, { url });
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

  // Short settle time for SPA hydration
  await new Promise((r) => setTimeout(r, 800));

  return targetTabId;
}
