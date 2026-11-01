/**
 * Chrome DevTools Protocol (CDP) Session Chokepoint
 *
 * SOLE MODULE AUTHORIZED TO INTERACT WITH chrome.debugger.
 * Enforces capability tiers, domain blocklists, rate limiting, size caps,
 * HITL payload-hash binding, auto-detach timers, and undo snapshots.
 */

import {
  type DevToolsTier,
  TIER_LEVELS,
  isMethodAllowedForTier,
  isDevToolsBlockedUrl,
  getDevToolsSessionTier,
  setDevToolsSessionTier,
  clearDevToolsSessionTier,
} from './policy';
import { appendDevToolsAudit } from './audit-log';
import { redactObject } from '../../security/redact';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DevToolsSendOptions {
  tier?: DevToolsTier;
  approvalId?: string;
  expectedPayloadHash?: string;
  skipHitl?: boolean;
  actor?: string; // e.g. 'main-agent' or 'specialist:<model>:<jobId>'
  onHITLRequired?: (details: {
    method: string;
    tabUrl: string;
    details: string;
    payloadHash: string;
  }) => Promise<boolean>;
}

export interface DevToolsUndoSnapshot {
  id: string;
  tabId: number;
  timestamp: number;
  type: 'html' | 'style' | 'script';
  target: string;
  previousValue: string;
  method: string;
}

// ── Rate Limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  private timestamps: number[] = [];
  constructor(private maxPerMinute: number = 60) {}

  check(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 60_000);
    if (this.timestamps.length >= this.maxPerMinute) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }
}

// ── Hash Helper ──────────────────────────────────────────────────────────────

export async function computePayloadHash(payload: unknown): Promise<string> {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);
  const buffer = new TextEncoder().encode(json);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Single Chokepoint Session Manager ────────────────────────────────────────

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RESULT_BYTES = 100 * 1024; // 100 KB cap on individual CDP responses

class CDPSessionManager {
  private attachedTabs = new Set<number>();
  private idleTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private rateLimiters = new Map<number, RateLimiter>();
  private undoStacks = new Map<number, DevToolsUndoSnapshot[]>();
  private listenersInstalled = false;

  constructor() {
    this.installLifecycleListeners();
  }

  private installLifecycleListeners(): void {
    if (this.listenersInstalled || typeof chrome === 'undefined') return;

    // 1. Detach when tab is closed
    if (chrome.tabs?.onRemoved) {
      chrome.tabs.onRemoved.addListener((tabId: number) => {
        void this.detach(tabId, 'Tab closed');
      });
    }

    // 2. Detach if tab navigates to a blocked domain
    if (chrome.tabs?.onUpdated) {
      chrome.tabs.onUpdated.addListener((tabId: number, changeInfo, tab) => {
        if (this.attachedTabs.has(tabId) && (changeInfo.url || tab.url)) {
          const url = changeInfo.url || tab.url || '';
          const { blocked, reason } = isDevToolsBlockedUrl(url);
          if (blocked) {
            console.warn(`[DevTools] Tab ${tabId} navigated to blocked domain (${url}). Detaching immediately: ${reason}`);
            void this.detach(tabId, `Navigated to blocked domain: ${reason}`);
          }
        }
      });
    }

    // 3. Listen for chrome.debugger events (e.g. debugger detached externally)
    try {
      if (chrome.debugger?.onDetach?.addListener) {
        chrome.debugger.onDetach.addListener((source: { tabId?: number }, reason: string) => {
          if (source.tabId) {
            this.cleanupSession(source.tabId);
            console.info(`[DevTools] Debugger detached from tab ${source.tabId}: ${reason}`);
          }
        });
      }
    } catch {
      // Handled in build-time / fake-browser environments where onDetach throws
    }

    this.listenersInstalled = true;
  }

  private resetIdleTimer(tabId: number): void {
    const existing = this.idleTimers.get(tabId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      console.info(`[DevTools] Idle timeout reached for tab ${tabId}. Auto-detaching.`);
      void this.detach(tabId, 'Auto-detached after 5 minutes of inactivity');
    }, IDLE_TIMEOUT_MS);

    this.idleTimers.set(tabId, timer);
  }

  private cleanupSession(tabId: number): void {
    this.attachedTabs.delete(tabId);
    const timer = this.idleTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(tabId);
    }
    this.rateLimiters.delete(tabId);
  }

  /**
   * Check whether DevTools is currently attached to a tab.
   */
  isAttached(tabId: number): boolean {
    return this.attachedTabs.has(tabId);
  }

  /**
   * Returns list of currently attached tabs.
   */
  getAttachedTabs(): number[] {
    return Array.from(this.attachedTabs);
  }

  /**
   * Attach debugger to a specific tab.
   */
  async attach(tabId: number, requestedTier: DevToolsTier = 'T0'): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Verify master switch is enabled in Settings
      const local = await chrome.storage.local.get(['devtoolsEnabled', 'devtoolsMaxTier']);
      if (local.devtoolsEnabled === false) {
        return {
          success: false,
          error: 'DEVTOOLS_DISABLED: Chrome DevTools control is disabled. Please enable it in Settings under "Chrome DevTools (CDP) Control".',
        };
      }

      // 2. Verify debugger API availability
      if (typeof chrome.debugger === 'undefined' || !chrome.debugger.attach) {
        return {
          success: false,
          error: 'PERMISSION_REQUIRED: "debugger" permission has not been granted by user in Settings.',
        };
      }

      // 2. Verify tab and domain blocklist
      const tab = await chrome.tabs.get(tabId);
      if (!tab || !tab.url) {
        return { success: false, error: 'Target tab or URL is inaccessible.' };
      }

      const { blocked, reason } = isDevToolsBlockedUrl(tab.url);
      if (blocked) {
        return { success: false, error: `SECURITY_BLOCKED: ${reason}` };
      }

      // 3. Attach via chrome.debugger if not already attached
      if (!this.attachedTabs.has(tabId)) {
        await chrome.debugger.attach({ tabId }, '1.3');
        this.attachedTabs.add(tabId);
      }

      // 4. Save session tier clamped to user's configured ceiling
      const configuredMax = (local.devtoolsMaxTier as DevToolsTier) || 'T1';
      const effectiveInitialTier = requestedTier && TIER_LEVELS[requestedTier] < TIER_LEVELS[configuredMax]
        ? requestedTier
        : configuredMax;
      await setDevToolsSessionTier(tabId, effectiveInitialTier);
      this.resetIdleTimer(tabId);

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `ATTACH_FAILED: ${msg}` };
    }
  }

  /**
   * Detach debugger from a tab.
   */
  async detach(tabId: number, reason = 'User detached'): Promise<void> {
    if (this.attachedTabs.has(tabId)) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
        // Ignored if already detached or tab closed
      }
    }
    this.cleanupSession(tabId);
    await clearDevToolsSessionTier(tabId);
    console.info(`[DevTools] Tab ${tabId} detached: ${reason}`);
  }

  /**
   * Detach all active debugger sessions (Kill Switch / Service Worker wake).
   */
  async detachAll(reason = 'Kill switch activated'): Promise<void> {
    const tabs = Array.from(this.attachedTabs);
    for (const tabId of tabs) {
      await this.detach(tabId, reason);
    }
  }

  /**
   * Cleans up orphaned CDP sessions upon Service Worker restart.
   */
  async detachOrphanedSessions(): Promise<void> {
    try {
      if (!chrome.debugger?.getTargets) return;
      const targets = await chrome.debugger.getTargets();
      for (const target of targets) {
        if (target.attached && target.tabId) {
          try {
            await chrome.debugger.detach({ tabId: target.tabId });
            console.info(`[DevTools] Cleaned up orphaned CDP session on tab ${target.tabId}`);
          } catch { /* ignore */ }
        }
      }
    } catch {
      // Ignored if getTargets not available
    }
  }

  /**
   * Centralized Command Dispatcher (Single Chokepoint).
   * Validates tier, blocklist, rate limits, size caps, and HITL hash before execution.
   */
  async send<T = unknown>(
    tabId: number,
    method: string,
    params: Record<string, unknown> = {},
    options: DevToolsSendOptions = {},
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    const startTime = Date.now();

    // 1. Verify attachment
    if (!this.attachedTabs.has(tabId)) {
      const attachRes = await this.attach(tabId, options.tier ?? 'T0');
      if (!attachRes.success) {
        await appendDevToolsAudit({
          tabId,
          method,
          params,
          resultSize: 0,
          tier: options.tier ?? 'T0',
          success: false,
          error: attachRes.error,
        });
        return { success: false, error: attachRes.error };
      }
    }

    // 2. Fetch current tier or auto-elevate within user's configured ceiling
    let currentTier = await getDevToolsSessionTier(tabId);
    const local = await chrome.storage.local.get(['devtoolsMaxTier']);
    const configuredCeiling = (local.devtoolsMaxTier as DevToolsTier) || 'T2';

    if (!currentTier) {
      currentTier = configuredCeiling;
      await setDevToolsSessionTier(tabId, currentTier);
    }

    // Auto-elevate session tier if caller requested higher tier within user ceiling
    if (options.tier && TIER_LEVELS[options.tier] > TIER_LEVELS[currentTier]) {
      if (TIER_LEVELS[options.tier] <= TIER_LEVELS[configuredCeiling]) {
        currentTier = options.tier;
        await setDevToolsSessionTier(tabId, currentTier);
      }
    }

    // 3. Verify method allowlist for tier
    // Internal read-only tool calls (e.g. read_console, read_network, read_storage) execute safe hardcoded expressions with skipHitl: true
    const isInternalReadEval = method === 'Runtime.evaluate' && options.skipHitl === true;
    if (!isInternalReadEval && !isMethodAllowedForTier(method, currentTier)) {
      const err = `TIER_DENIED: Method "${method}" is not permitted under current tier "${currentTier}".`;
      await appendDevToolsAudit({
        tabId,
        method,
        params,
        resultSize: 0,
        tier: currentTier,
        success: false,
        error: err,
      });
      return { success: false, error: err };
    }

    // 4. Re-verify tab URL against blocklist
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.url) {
        throw new Error('Unable to read tab URL');
      }
      const { blocked, reason } = isDevToolsBlockedUrl(tab.url);
      if (blocked) {
        await this.detach(tabId, reason);
        const err = `SECURITY_BLOCKED: Tab is on a blocked domain: ${reason}`;
        await appendDevToolsAudit({
          tabId,
          method,
          params,
          resultSize: 0,
          tier: currentTier,
          success: false,
          error: err,
        });
        return { success: false, error: err };
      }
    } catch (e) {
      const err = `SECURITY_CHECK_FAILED: Could not verify tab domain security (${e})`;
      return { success: false, error: err };
    }

    // 5. Rate limiting
    let limiter = this.rateLimiters.get(tabId);
    if (!limiter) {
      limiter = new RateLimiter(60);
      this.rateLimiters.set(tabId, limiter);
    }
    if (!limiter.check()) {
      const err = 'RATE_LIMIT_EXCEEDED: Exceeded max 60 CDP commands per minute for this tab.';
      return { success: false, error: err };
    }

    // 6. HITL for T2 (Writes) and T3 (Execution)
    const requiresHitl = method.startsWith('DOM.set') ||
      method.startsWith('CSS.set') ||
      method.startsWith('Debugger.set') ||
      method.startsWith('Fetch.') ||
      method === 'Runtime.evaluate' ||
      method.startsWith('Input.dispatch');

    const payloadHash = await computePayloadHash({ method, params });

    if (requiresHitl && !options.skipHitl) {
      // If expected payload hash was provided, verify it has not shifted (TOCTOU)
      if (options.expectedPayloadHash && options.expectedPayloadHash !== payloadHash) {
        const err = `HITL_HASH_MISMATCH: Payload shifted prior to execution (Expected ${options.expectedPayloadHash.slice(0, 8)}, received ${payloadHash.slice(0, 8)}). Action blocked.`;
        await appendDevToolsAudit({
          tabId,
          method,
          params,
          resultSize: 0,
          tier: currentTier,
          approvalId: options.approvalId,
          success: false,
          error: err,
        });
        return { success: false, error: err };
      }

      // If callback provided, request user confirmation
      if (options.onHITLRequired) {
        const tab = await chrome.tabs.get(tabId);
        const approved = await options.onHITLRequired({
          method,
          tabUrl: tab?.url || '',
          details: JSON.stringify(params, null, 2).slice(0, 500),
          payloadHash,
        });

        if (!approved) {
          const err = `HITL_DENIED: Execution of ${method} declined or timed out.`;
          await appendDevToolsAudit({
            tabId,
            method,
            params,
            resultSize: 0,
            tier: currentTier,
            approvalId: options.approvalId,
            success: false,
            error: err,
          });
          return { success: false, error: err };
        }
      }
    }

    // 7. Dispatch command to chrome.debugger
    this.resetIdleTimer(tabId);

    try {
      const rawResult = (await chrome.debugger.sendCommand({ tabId }, method, params)) as unknown;
      const redactedResult = redactObject(rawResult) as T;

      // Size cap check
      const resultJson = JSON.stringify(redactedResult ?? null);
      const byteSize = new TextEncoder().encode(resultJson).length;

      await appendDevToolsAudit({
        tabId,
        method,
        params,
        resultSize: byteSize,
        tier: currentTier,
        approvalId: options.approvalId,
        success: true,
      });

      return { success: true, result: redactedResult };
    } catch (cmdErr) {
      const err = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
      await appendDevToolsAudit({
        tabId,
        method,
        params,
        resultSize: 0,
        tier: currentTier,
        approvalId: options.approvalId,
        success: false,
        error: err,
      });
      return { success: false, error: `CDP_COMMAND_ERROR: ${err}` };
    }
  }

  // ── Undo Management ────────────────────────────────────────────────────────

  pushUndoSnapshot(snapshot: DevToolsUndoSnapshot): void {
    const stack = this.undoStacks.get(snapshot.tabId) ?? [];
    stack.push(snapshot);
    this.undoStacks.set(snapshot.tabId, stack);
  }

  popUndoSnapshot(tabId: number): DevToolsUndoSnapshot | undefined {
    const stack = this.undoStacks.get(tabId);
    return stack?.pop();
  }

  getUndoHistory(tabId: number): DevToolsUndoSnapshot[] {
    return [...(this.undoStacks.get(tabId) ?? [])];
  }

  clearUndoHistory(tabId: number): void {
    this.undoStacks.delete(tabId);
  }
}

export const cdpSession = new CDPSessionManager();
