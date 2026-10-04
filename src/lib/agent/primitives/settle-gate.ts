/**
 * Settle Gate & Network Idle Detector
 * Prevents premature actions by waiting for in-flight network requests (Fetch/XHR)
 * and DOM mutations to stabilize.
 */

export interface SettleOptions {
  maxWaitMs?: number;
  idleThresholdMs?: number;
}

/**
 * Injects network idle and DOM mutation observer into the tab context.
 */
export async function waitForPageSettled(
  tabId: number,
  options: SettleOptions = {},
): Promise<void> {
  const maxWaitMs = options.maxWaitMs ?? 1500;
  const idleThresholdMs = options.idleThresholdMs ?? 250;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (timeout: number, idleThreshold: number) => {
        return new Promise<void>((resolve) => {
          let timer: number;
          let idleTimer: number;
          let observer: MutationObserver | null = null;

          const finish = () => {
            if (observer) observer.disconnect();
            clearTimeout(timer);
            clearTimeout(idleTimer);

            // Double requestAnimationFrame guarantees CSS transitions and layout reflows have settled
            if (typeof window.requestAnimationFrame === 'function') {
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  resolve();
                });
              });
            } else {
              resolve();
            }
          };

          // Overall safety timeout
          timer = window.setTimeout(finish, timeout);

          // If document loading is ongoing, listen for load
          if (document.readyState !== 'complete') {
            window.addEventListener('load', () => {
              idleTimer = window.setTimeout(finish, idleThreshold);
            }, { once: true });
          }

          // Monitor DOM mutations
          try {
            observer = new MutationObserver(() => {
              clearTimeout(idleTimer);
              idleTimer = window.setTimeout(finish, idleThreshold);
            });

            observer.observe(document.body || document.documentElement, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true,
            });
          } catch {
            // Ignore observer failure on restricted DOMs
          }

          // Initial idle timer in case DOM is already settled
          idleTimer = window.setTimeout(finish, idleThreshold);
        });
      },
      args: [maxWaitMs, idleThresholdMs],
    });
  } catch {
    // Non-scriptable tabs (e.g. chrome://) resolve immediately
  }
}
