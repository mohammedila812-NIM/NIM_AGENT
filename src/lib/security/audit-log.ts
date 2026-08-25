export type SecurityEvent =
  | { type: 'injection_detected'; url: string; snippet: string; layer: 'dom' | 'quarantine' | 'validator' }
  | { type: 'action_blocked'; action: string; reason: string }
  | { type: 'action_warned'; action: string; reason: string; userApproved: boolean }
  | { type: 'sender_rejected'; senderId: string; portName?: string }
  | { type: 'out_of_scope_domain'; domain: string; taskId: string }
  | { type: 'tool_validation_error'; rawCall: unknown; errors: string }
  | { type: 'cost_limit_hit'; limitType: 'per_task' | 'per_day'; detail: string };

export interface SecurityLogEntry {
  id: string;
  timestamp: number;
  event: SecurityEvent;
}

const STORAGE_KEY = 'securityLog';
const MAX_ENTRIES = 200;
const AUDIT_LOG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function appendSecurityEvent(event: SecurityEvent): Promise<void> {
  const entry: SecurityLogEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    event,
  };
  const existing = await loadSecurityLog();
  const updated = [...existing, entry].slice(-MAX_ENTRIES);
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
}

export async function loadSecurityLog(): Promise<SecurityLogEntry[]> {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  const raw = (r[STORAGE_KEY] as SecurityLogEntry[] | undefined) ?? [];
  const now = Date.now();
  // Filter out events older than 7 days
  return raw.filter((entry) => now - entry.timestamp <= AUDIT_LOG_TTL_MS);
}

export async function clearSecurityLog(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
