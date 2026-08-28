import { loadWatch, saveWatch, type WatchTarget } from '../storage/watch';
import { loadMacro } from '../storage/tasks';
import { executeMacro } from './macro-executor';
import { checkBudget, recordUsage } from './cost-guard';
import { appendSecurityEvent } from '../security/audit-log';
import { loadWorkerConfig } from '../storage/secure';
import { chatCompletion } from '../llm/client';

export interface WatchCheckResult {
  watchId: string;
  success: boolean;
  changed: boolean;
  newSnapshot?: string;
  previousSnapshot?: string;
  summary?: string;
  error?: string;
}

/**
 * Extract clean numeric price from a string (e.g. "$1,299.99" → 1299.99).
 */
export function extractNumericPrice(text: string): number | null {
  const match = text.replace(/,/g, '').match(/(?:[\$€£₹¥]\s*)?(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  return isNaN(num) ? null : num;
}

/**
 * Execute a single background monitoring check for a WatchTarget.
 * @param watchId  ID of the stored WatchTarget to check.
 * @param manual   If true, skips the paused-status guard (Check Now button).
 */
export async function executeWatchCheck(
  watchId: string,
  manual = false,
): Promise<WatchCheckResult> {
  const watch = await loadWatch(watchId);
  if (!watch) {
    return { watchId, success: false, changed: false, error: 'Watch not found' };
  }

  if (watch.status !== 'active' && !manual) {
    return { watchId, success: false, changed: false, error: 'Watch is paused' };
  }

  // 1. Budget check — 500 estimated tokens, 0 cost/million (free providers)
  const budgetCheck = await checkBudget(500, 0);
  if (!budgetCheck.allowed) {
    const errorMsg = `Monitor paused: ${budgetCheck.reason ?? 'Cost limit reached'}`;
    await saveWatch({ ...watch, status: 'paused', errorMessage: errorMsg });
    return { watchId, success: false, changed: false, error: errorMsg };
  }

  let createdTabId: number | null = null;

  try {
    // 2. Open invisible background tab
    const tab = await chrome.tabs.create({ url: watch.url, active: false });
    createdTabId = tab.id ?? null;
    if (!createdTabId) throw new Error('Failed to create background tab');

    // Wait for tab load with a 20-second timeout
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 20_000);

      const listener = (tid: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (tid === createdTabId && changeInfo.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Settle delay for client-side rendered frameworks
    await new Promise((r) => setTimeout(r, 2000));

    // 3. Extract target element text or page body
    const extractionResults = await chrome.scripting.executeScript({
      target: { tabId: createdTabId },
      func: (rawSelector: string) => {
        const selector = rawSelector || undefined;
        if (selector) {
          try {
            const el = document.querySelector(selector);
            if (el) return (el.textContent ?? '').trim().replace(/\s+/g, ' ');
          } catch { /* invalid selector */ }
        }
        // Attempt standard price elements first
        const priceEl = document.querySelector('.price, [data-price], [itemprop="price"], #price, .a-price');
        if (priceEl) return (priceEl.textContent ?? '').trim().replace(/\s+/g, ' ');
        // Fallback: first 2000 chars of body text
        return ((document.body as HTMLElement).innerText ?? '').slice(0, 2000).replace(/\s+/g, ' ');
      },
      args: [watch.selector ?? ''],
    });

    const currentText = ((extractionResults[0]?.result as string | undefined) ?? '').trim();
    if (!currentText) throw new Error('Could not extract content from watched page');

    // 4. Diff & condition evaluation
    let changed = false;
    let summary = '';
    const previousSnapshot = watch.lastSnapshot;

    if (!previousSnapshot) {
      // First run — just establish baseline
      summary = `Initial baseline captured: "${currentText.slice(0, 100)}..."`;
    } else if (watch.conditionPrompt && watch.conditionPrompt.trim().length > 0) {
      // Semantic condition check via LLM (if config available)
      const workerConfig = await loadWorkerConfig();
      if (workerConfig?.apiKey) {
        try {
          const providerConfig = {
            id: workerConfig.providerId,
            label: workerConfig.providerId,
            baseUrl: workerConfig.baseUrl ?? '',
            apiKey: workerConfig.apiKey,
          };
          const modelId = workerConfig.modelId ?? 'default';
          const evalPrompt = `PAGE CONTENT:\n${currentText.slice(0, 3000)}\n\nPREVIOUS SNAPSHOT:\n${previousSnapshot}\n\nEvaluate this condition: "${watch.conditionPrompt}". Did a meaningful change occur or is the condition satisfied? Answer with exactly one line starting with YES: or NO:`;

          const res = await chatCompletion(providerConfig as Parameters<typeof chatCompletion>[0], {
            model: modelId,
            messages: [{ role: 'user', content: evalPrompt }],
            temperature: 0.1,
            max_tokens: 80,
          });
          const evalResult = (res.choices[0]?.message?.content ?? '').trim();

          if (evalResult.toLowerCase().startsWith('yes')) {
            changed = true;
            summary = evalResult.replace(/^yes:?\s*/i, '');
          } else {
            summary = evalResult.replace(/^no:?\s*/i, '');
          }

          // Record minimal token usage (prompt ~350 + completion ~30)
          await recordUsage(380, 0);
        } catch {
          // LLM eval failed — fall back to direct string diff
          changed = currentText !== previousSnapshot;
          summary = changed ? 'Content changed on watched page.' : 'No change detected.';
        }
      } else {
        changed = currentText !== previousSnapshot;
        summary = changed ? 'Content changed (no LLM config available for condition eval).' : 'No change.';
      }
    } else if (watch.type === 'price') {
      // Numeric price diff
      const oldPrice = extractNumericPrice(previousSnapshot);
      const newPrice = extractNumericPrice(currentText);
      if (oldPrice !== null && newPrice !== null) {
        if (newPrice < oldPrice) {
          changed = true;
          summary = `Price dropped from $${oldPrice} → $${newPrice}!`;
        } else if (newPrice > oldPrice) {
          changed = true;
          summary = `Price increased from $${oldPrice} → $${newPrice}.`;
        }
      } else {
        changed = currentText !== previousSnapshot;
        summary = changed ? 'Price or text changed.' : 'No change.';
      }
    } else {
      // Standard string diff
      changed = currentText !== previousSnapshot;
      summary = changed ? 'Content changed on watched page.' : 'No change detected.';
    }

    // 5. If changed and macro attached, execute macro deterministically
    let macroSummary = '';
    if (changed && watch.macroId && createdTabId) {
      try {
        const attachedMacro = await loadMacro(watch.macroId);
        if (attachedMacro) {
          const macroRes = await executeMacro(attachedMacro, createdTabId);
          if (macroRes.success) {
            macroSummary = ` | Executed macro "${attachedMacro.name}" (${macroRes.stepsCompleted}/${macroRes.totalSteps} steps)`;
          } else {
            macroSummary = ` | Macro "${attachedMacro.name}" failed: ${macroRes.error || 'Unknown error'}`;
          }

          await appendSecurityEvent({
            type: 'watch_triggered_macro',
            watchId: watch.watchId,
            macroId: watch.macroId,
            success: macroRes.success,
            detail: macroSummary,
          });
        }
      } catch (mErr: unknown) {
        macroSummary = ` | Macro error: ${mErr instanceof Error ? mErr.message : String(mErr)}`;
      }
    }

    const fullAlertMessage = `${summary}${macroSummary}`.trim();

    // 6. Fire desktop notification if changed
    if (changed && watch.notificationOnMatch !== false) {
      if (typeof chrome !== 'undefined' && chrome.notifications) {
        const notifId = `watch-alert-${watch.watchId}-${Date.now()}`;
        try {
          await chrome.notifications.create(notifId, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon/128.png'),
            title: `⚡ NIM Monitor: ${watch.name}`,
            message: fullAlertMessage || `Change detected on ${watch.name}`,
            priority: 2,
            requireInteraction: true,
          });
        } catch { /* notifications API error — silently ignore */ }
      }

      await appendSecurityEvent({
        type: 'action_warned',
        action: `watch_alert:${watch.watchId}`,
        reason: fullAlertMessage,
        userApproved: false,
      });
    }

    // 6. Persist updated snapshot
    const updatedWatch: WatchTarget = {
      ...watch,
      lastSnapshot: currentText.slice(0, 2000),
      lastCheckedAt: Date.now(),
      lastChangedAt: changed ? Date.now() : watch.lastChangedAt,
      alertCount: changed ? watch.alertCount + 1 : watch.alertCount,
      errorMessage: undefined,
      updatedAt: Date.now(),
    };
    await saveWatch(updatedWatch);

    return {
      watchId,
      success: true,
      changed,
      newSnapshot: currentText.slice(0, 500),
      previousSnapshot: previousSnapshot?.slice(0, 500),
      summary,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await saveWatch({
      ...watch,
      lastCheckedAt: Date.now(),
      errorMessage: errorMsg,
      updatedAt: Date.now(),
    });
    return { watchId, success: false, changed: false, error: errorMsg };
  } finally {
    // 7. Always close the background tab — prevent memory leaks
    if (createdTabId) {
      try { await chrome.tabs.remove(createdTabId); } catch { /* tab already closed */ }
    }
  }
}
