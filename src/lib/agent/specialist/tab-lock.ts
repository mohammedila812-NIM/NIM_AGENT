/**
 * Specialist Tab Lock Manager
 *
 * Prevents race conditions and DOM corruption between the main agent and
 * specialist sub-agents. When a specialist holds T2 or T3 on a tab, mutating
 * tools on that tab are blocked until the job completes, aborts, or times out.
 */

import type { DevToolsTier } from '../devtools/policy';

export interface TabLock {
  jobId: string;
  role: string;
  tier: DevToolsTier;
  tabId: number;
  acquiredAt: number;
}

const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max lock duration

class TabLockManager {
  private locks = new Map<number, TabLock>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  /**
   * Acquires a mutating lock on a tab for T2 or T3 specialist operations.
   * T0 and T1 do not acquire mutating locks.
   */
  acquireLock(
    tabId: number,
    jobId: string,
    role: string,
    tier: DevToolsTier,
  ): { success: boolean; existingLock?: TabLock } {
    if (tier === 'T0' || tier === 'T1') {
      return { success: true };
    }

    const existing = this.locks.get(tabId);
    if (existing && existing.jobId !== jobId) {
      return { success: false, existingLock: existing };
    }

    // Set lock
    const lock: TabLock = {
      jobId,
      role,
      tier,
      tabId,
      acquiredAt: Date.now(),
    };
    this.locks.set(tabId, lock);

    // Reset lock auto-release timer
    const prevTimer = this.timers.get(tabId);
    if (prevTimer) clearTimeout(prevTimer);

    const timer = setTimeout(() => {
      console.warn(`[TabLock] Lock on tab ${tabId} by job ${jobId} timed out after 5 minutes. Releasing.`);
      this.releaseLock(tabId, jobId);
    }, LOCK_TIMEOUT_MS);

    this.timers.set(tabId, timer);
    return { success: true };
  }

  /**
   * Releases the lock on a tab.
   */
  releaseLock(tabId: number, jobId?: string): void {
    const existing = this.locks.get(tabId);
    if (existing) {
      if (jobId && existing.jobId !== jobId) {
        return; // Only owner can release
      }
      this.locks.delete(tabId);
      const timer = this.timers.get(tabId);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(tabId);
      }
      console.info(`[TabLock] Released lock on tab ${tabId} (held by ${existing.jobId})`);
    }
  }

  /**
   * Checks if a tab is currently locked for mutating operations.
   */
  isLocked(tabId: number): { locked: boolean; lock?: TabLock } {
    const lock = this.locks.get(tabId);
    if (lock) {
      return { locked: true, lock };
    }
    return { locked: false };
  }

  /**
   * Releases all active locks across all tabs.
   */
  releaseAll(): void {
    for (const [tabId] of this.locks) {
      this.releaseLock(tabId);
    }
    this.locks.clear();
    this.timers.clear();
  }
}

export const tabLockManager = new TabLockManager();
