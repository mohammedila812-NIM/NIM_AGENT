/**
 * Chrome DevTools Protocol (CDP) Audit Logger
 *
 * Persists an immutable ring-buffer of all CDP actions, methods, redacted payloads,
 * sizes, capability tiers, and approval IDs in chrome.storage.local.
 */

import { redactObject } from '../../security/redact';

export interface DevToolsAuditEntry {
  id: string;
  timestamp: number;
  tabId: number;
  method: string;
  redactedParams: unknown;
  resultSize: number;
  tier: string;
  approvalId?: string;
  success: boolean;
  error?: string;
}

const DEVTOOLS_AUDIT_STORAGE_KEY = 'devtools_audit_log';
const MAX_AUDIT_ENTRIES = 200;

/**
 * Appends a verified CDP command to the persistent audit log.
 */
export async function appendDevToolsAudit(entry: Omit<DevToolsAuditEntry, 'id' | 'timestamp' | 'redactedParams'> & {
  params?: unknown;
}): Promise<void> {
  const sanitizedParams = redactObject(entry.params ?? {});

  const record: DevToolsAuditEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    tabId: entry.tabId,
    method: entry.method,
    redactedParams: sanitizedParams,
    resultSize: entry.resultSize,
    tier: entry.tier,
    approvalId: entry.approvalId,
    success: entry.success,
    error: entry.error,
  };

  try {
    const existing = await loadDevToolsAuditLog();
    const updated = [...existing, record].slice(-MAX_AUDIT_ENTRIES);
    await chrome.storage.local.set({ [DEVTOOLS_AUDIT_STORAGE_KEY]: updated });
  } catch (err) {
    console.error('[DevTools Audit] Failed to write audit record:', err);
  }
}

/**
 * Loads the current CDP audit history.
 */
export async function loadDevToolsAuditLog(): Promise<DevToolsAuditEntry[]> {
  try {
    const res = await chrome.storage.local.get(DEVTOOLS_AUDIT_STORAGE_KEY);
    return (res[DEVTOOLS_AUDIT_STORAGE_KEY] as DevToolsAuditEntry[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/**
 * Clears the CDP audit history.
 */
export async function clearDevToolsAuditLog(): Promise<void> {
  await chrome.storage.local.remove(DEVTOOLS_AUDIT_STORAGE_KEY);
}

/**
 * Formats the audit history for JSON export.
 */
export async function exportDevToolsAuditLogJson(): Promise<string> {
  const entries = await loadDevToolsAuditLog();
  return JSON.stringify(entries, null, 2);
}
