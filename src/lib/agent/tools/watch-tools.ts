import {
  saveWatch,
  listWatches,
  deleteWatch,
  loadWatch,
  formatInterval,
  type WatchTarget,
  type WatchType,
} from '../../storage/watch';

export interface CreateWatchOptions {
  name: string;
  url: string;
  type?: WatchType;
  selector?: string;
  conditionPrompt?: string;
  /** Interval in seconds (preferred — use when user says "every 20 seconds"). */
  intervalSeconds?: number;
  /** Interval in minutes (legacy — use when user says "every 5 minutes"). */
  intervalMinutes?: number;
}

/**
 * Execute create_watch tool.
 */
export async function executeCreateWatch(options: CreateWatchOptions): Promise<string> {
  const watchId = crypto.randomUUID();

  // Resolve the true interval in seconds:
  // 1. intervalSeconds wins if provided
  // 2. intervalMinutes (in minutes) is converted to seconds
  // 3. Default: 30 minutes = 1800 seconds
  let intervalSeconds: number;
  if (options.intervalSeconds !== undefined) {
    intervalSeconds = options.intervalSeconds;
  } else if (options.intervalMinutes !== undefined) {
    intervalSeconds = options.intervalMinutes * 60;
  } else {
    intervalSeconds = 1800; // 30 minutes default
  }

  // Clamp to sane bounds: minimum 5 seconds, maximum 24 hours
  intervalSeconds = Math.max(5, Math.min(86400, intervalSeconds));
  const intervalMinutes = intervalSeconds / 60;

  const now = Date.now();

  const newWatch: WatchTarget = {
    watchId,
    name: options.name.trim(),
    url: options.url.trim(),
    type: options.type ?? 'price',
    selector: options.selector?.trim() || undefined,
    conditionPrompt: options.conditionPrompt?.trim() || undefined,
    intervalSeconds,
    intervalMinutes,
    status: 'active',
    alertCount: 0,
    notificationOnMatch: true,
    createdAt: now,
    updatedAt: now,
  };

  await saveWatch(newWatch);

  const humanInterval = formatInterval(intervalSeconds);
  const condPart = newWatch.conditionPrompt ? ` | Condition: "${newWatch.conditionPrompt}"` : '';
  const selPart = newWatch.selector ? ` | Selector: \`${newWatch.selector}\`` : '';
  const mv3Notice = intervalSeconds < 30
    ? '\n- **Notice:** In background watch mode, Chrome MV3 alarms enforce a 30-second minimum wake interval.'
    : '';

  return `MONITOR CREATED SUCCESSFULLY:
- **Name:** "${newWatch.name}"
- **URL:** ${newWatch.url}
- **Interval:** Every ${humanInterval}
- **Status:** 🟢 Active (Scheduled in background)${condPart}${selPart}${mv3Notice}
- **Watch ID:** \`${watchId}\`

NIM Agent will now automatically monitor this page in the background and trigger browser notifications when changes or threshold conditions are detected.`;
}

/**
 * Execute list_watches tool.
 */
export async function executeListWatches(): Promise<string> {
  const watches = await listWatches();
  if (watches.length === 0) {
    return 'SCHEDULED MONITORS: No active or saved page monitors found. Use create_watch to start monitoring a web page.';
  }

  const lines = watches.map((w, idx) => {
    const statusBadge = w.status === 'active' ? '🟢 Active' : w.status === 'paused' ? '⏸️ Paused' : '🔴 Error';
    const lastChecked = w.lastCheckedAt ? new Date(w.lastCheckedAt).toLocaleTimeString() : 'Never';
    const cond = w.conditionPrompt ? ` — Condition: "${w.conditionPrompt}"` : '';
    const lastVal = w.lastSnapshot ? `\n  - *Last Snapshot:* "${w.lastSnapshot.slice(0, 120)}..."` : '';
    // Back-compat: derive intervalSeconds if missing from older persisted records
    const intervalSeconds = w.intervalSeconds ?? w.intervalMinutes * 60;
    const intervalDisplay = formatInterval(intervalSeconds);
    return `${idx + 1}. **${w.name}** [${statusBadge}] (Every ${intervalDisplay} · Last checked: ${lastChecked} · Alerts: ${w.alertCount})${cond}\n  - URL: ${w.url}\n  - ID: \`${w.watchId}\`${lastVal}`;
  });

  return `SCHEDULED MONITORS (${watches.length}):\n\n${lines.join('\n\n')}`;
}

/**
 * Execute delete_watch tool.
 */
export async function executeDeleteWatch(watchId: string): Promise<string> {
  const existing = await loadWatch(watchId);
  if (!existing) {
    return `DELETE MONITOR: Watch with ID \`${watchId}\` was not found.`;
  }

  await deleteWatch(watchId);
  return `MONITOR DELETED: Successfully removed monitor "${existing.name}" (\`${watchId}\`) and cancelled its background alarm.`;
}
