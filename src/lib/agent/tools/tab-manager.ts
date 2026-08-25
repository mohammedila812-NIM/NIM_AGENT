/**
 * Multi-tab orchestration tool for NIM Agent.
 * Allows listing open tabs, creating background/foreground tabs, switching between tabs, and closing tabs.
 */

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

/** List all tabs in current window. */
export async function listTabs(): Promise<TabInfo[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.map((t) => ({
    id: t.id ?? 0,
    title: t.title ?? 'Untitled Tab',
    url: t.url ?? '',
    active: !!t.active,
  }));
}

/** Switch active tab by tabId or URL substring. */
export async function switchTab(tabIdOrUrl: number | string): Promise<{ success: boolean; tab?: TabInfo; error?: string }> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  let targetTab: chrome.tabs.Tab | undefined;

  if (typeof tabIdOrUrl === 'number') {
    targetTab = tabs.find((t) => t.id === tabIdOrUrl);
  } else {
    const query = String(tabIdOrUrl).toLowerCase();
    targetTab = tabs.find((t) => (t.url?.toLowerCase().includes(query) || t.title?.toLowerCase().includes(query)));
  }

  if (!targetTab?.id) {
    return { success: false, error: `Tab matching "${tabIdOrUrl}" not found.` };
  }

  await chrome.tabs.update(targetTab.id, { active: true });
  return {
    success: true,
    tab: {
      id: targetTab.id,
      title: targetTab.title ?? '',
      url: targetTab.url ?? '',
      active: true,
    },
  };
}

/** Close a tab by tabId or close current active tab. */
export async function closeTab(tabId?: number): Promise<{ success: boolean; error?: string }> {
  if (tabId) {
    try {
      await chrome.tabs.remove(tabId);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id) {
    await chrome.tabs.remove(activeTab.id);
    return { success: true };
  }

  return { success: false, error: 'No active tab found to close.' };
}

/** Close multiple tabs concurrently. */
export async function closeTabs(tabIds: number[]): Promise<void> {
  const validIds = tabIds.filter(id => id > 0);
  if (validIds.length > 0) {
    try {
      await chrome.tabs.remove(validIds);
    } catch {
      // ignore tabs already closed
    }
  }
}

/** Open a URL in a non-focused background tab and wait until loaded (or timeout). */
export async function openBackgroundTab(url: string, timeoutMs = 10000): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.create({ url, active: false });

  if (!tab.id) return tab;

  const tabId = tab.id;
  await new Promise<void>((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    const timer = setTimeout(cleanup, timeoutMs);

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        cleanup();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });

  // Background tab wake-up trigger: Chrome throttles inactive tabs.
  // Dispatch synthetic visibility, layout, and scroll events to unstall SPA hydration.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
          Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        } catch { /* ignore */ }
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('scroll'));
        window.scrollBy({ top: 300, behavior: 'instant' as ScrollBehavior });
        setTimeout(() => window.scrollBy({ top: -300, behavior: 'instant' as ScrollBehavior }), 100);
      },
    });
    // Brief settling pause
    await new Promise((r) => setTimeout(r, 600));
  } catch {
    // Ignore script errors on non-scriptable background tabs
  }

  return tab;
}

/** Read visible text directly from any background tab by tabId using visibility-aware extraction. */
export async function readTabContent(tabId: number, maxChars = 12000): Promise<string> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (limit: number) => {
        const NOISE_SELECTORS = [
          'nav', 'header', 'footer', 'aside',
          '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
          '[role="complementary"]', '.cookie', '.gdpr', '.consent',
          '.ad', '.ads', '.advertisement', '.popup', '.modal-overlay',
          '#cookie-banner', '#consent', '.sidebar',
        ].join(',');

        const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'META', 'HEAD', 'SVG', 'CANVAS']);

        function isVisible(el: Element): boolean {
          if (typeof (el as HTMLElement).checkVisibility === 'function') {
            return (el as HTMLElement).checkVisibility();
          }
          const style = getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }

        const noiseEls = new Set<Element>();
        try {
          document.querySelectorAll(NOISE_SELECTORS).forEach((e) => noiseEls.add(e));
        } catch { /* ignore */ }

        function inNoise(el: Element): boolean {
          let cur: Element | null = el;
          while (cur) {
            if (noiseEls.has(cur)) return true;
            cur = cur.parentElement;
          }
          return false;
        }

        // Extract main visible text content using live-DOM TreeWalker
        const seen = new Set<string>();
        const lines: string[] = [];
        let charBudget = limit;

        const mainEl =
          document.querySelector('main, article, [role="main"], #content, #main, .content, .main') ??
          document.body;

        const walker = document.createTreeWalker(mainEl, NodeFilter.SHOW_ELEMENT);
        let node = walker.nextNode() as Element | null;
        while (node && charBudget > 0) {
          const tag = node.tagName;
          if (SKIP_TAGS.has(tag) || inNoise(node)) {
            node = walker.nextNode() as Element | null;
            continue;
          }
          if (!isVisible(node)) {
            node = walker.nextNode() as Element | null;
            continue;
          }
          if (node.childElementCount === 0) {
            const t = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
            if (t.length > 1 && !seen.has(t)) {
              seen.add(t);
              const prefix = /^H[1-6]$/.test(tag) ? '\n## ' : '';
              lines.push(`${prefix}${t}`);
              charBudget -= t.length;
            }
          }
          node = walker.nextNode() as Element | null;
        }

        return lines.join('\n');
      },
      args: [maxChars],
    });

    return results[0]?.result ?? '';
  } catch (err) {
    return `[Could not read background tab ${tabId}: ${err instanceof Error ? err.message : String(err)}]`;
  }
}
