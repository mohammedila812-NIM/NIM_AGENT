/**
 * DOM Settle & Wait Utilities for NIM Agent.
 * Ensures SPAs have completed hydration and DOM mutations before the agent reads page state.
 */

export async function waitForDOMSettle(tabId: number, maxWaitMs = 1200): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (timeout: number) => {
        return new Promise<void>((resolve) => {
          let timer: number;
          let observer: MutationObserver | null = null;

          const done = () => {
            if (observer) observer.disconnect();
            clearTimeout(timer);
            resolve();
          };

          timer = window.setTimeout(done, timeout);

          // If document is not complete yet, wait for load
          if (document.readyState !== 'complete') {
            window.addEventListener('load', done, { once: true });
          }

          // Listen for DOM mutations settling
          let idleTimer: number;
          try {
            observer = new MutationObserver(() => {
              clearTimeout(idleTimer);
              idleTimer = window.setTimeout(done, 250); // 250ms with no DOM mutations = settled
            });

            observer.observe(document.body || document.documentElement, {
              childList: true,
              subtree: true,
              attributes: true,
            });
          } catch {
            // Fallback to basic timeout
          }
        });
      },
      args: [maxWaitMs],
    });
  } catch {
    // Ignore script execution errors on non-scriptable tabs
  }
}

export async function waitForSelector(
  tabId: number,
  selector: string,
  state: 'visible' | 'hidden' = 'visible',
  timeoutMs = 5000,
): Promise<{ success: boolean; error?: string }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel: string, targetState: string, maxWait: number) => {
        return new Promise<{ success: boolean; error?: string }>((resolve) => {
          const startTime = Date.now();

          const check = () => {
            const el = document.querySelector(sel);
            const isVisible = el
              ? (typeof (el as HTMLElement).checkVisibility === 'function'
                  ? (el as HTMLElement).checkVisibility()
                  : (el as HTMLElement).offsetWidth > 0 || (el as HTMLElement).offsetHeight > 0)
              : false;

            if (targetState === 'visible' && isVisible) {
              resolve({ success: true });
              return;
            }

            if (targetState === 'hidden' && (!el || !isVisible)) {
              resolve({ success: true });
              return;
            }

            if (Date.now() - startTime >= maxWait) {
              resolve({
                success: false,
                error: `Timed out after ${maxWait}ms waiting for "${sel}" to be ${targetState}`,
              });
              return;
            }

            requestAnimationFrame(check);
          };

          check();
        });
      },
      args: [selector, state, timeoutMs],
    });

    return results[0]?.result ?? { success: false, error: 'Script failed to execute' };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
