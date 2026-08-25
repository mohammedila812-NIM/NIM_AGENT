/** Navigate the active tab or open a new tab. Must be called from background context. */
export async function navigateTo(url: string, newTab = false): Promise<number> {
  if (newTab) {
    const tab = await chrome.tabs.create({ url, active: true });
    return tab.id!;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) throw new Error('No active browser tab found');

  await chrome.tabs.update(activeTab.id, { url });

  // Wait for navigation complete
  await new Promise<void>((resolve) => {
    const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (tabId === activeTab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 10_000); // 10s fallback timeout
  });

  return activeTab.id;
}
