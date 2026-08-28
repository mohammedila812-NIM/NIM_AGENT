import {
  saveWatch,
  listWatches,
  deleteWatch,
  loadWatch,
  type WatchTarget,
  type WatchType,
} from '../../storage/watch';

export interface CreateWatchOptions {
  name: string;
  url: string;
  type?: WatchType;
  selector?: string;
  conditionPrompt?: string;
  intervalMinutes?: number;
}

/**
 * Execute create_watch tool.
 */
export async function executeCreateWatch(options: CreateWatchOptions): Promise<string> {
  const watchId = crypto.randomUUID();
  const interval = Math.max(1, options.intervalMinutes ?? 30);
  const now = Date.now();

  const newWatch: WatchTarget = {
    watchId,
    name: options.name.trim(),
    url: options.url.trim(),
    type: options.type ?? 'price',
    selector: options.selector?.trim() || undefined,
    conditionPrompt: options.conditionPrompt?.trim() || undefined,
    intervalMinutes: interval,
    status: 'active',
    alertCount: 0,
    notificationOnMatch: true,
    createdAt: now,
    updatedAt: now,
  };

  await saveWatch(newWatch);

  const condPart = newWatch.conditionPrompt ? ` | Condition: "${newWatch.conditionPrompt}"` : '';
  const selPart = newWatch.selector ? ` | Selector: \`${newWatch.selector}\`` : '';

  return `MONITOR CREATED SUCCESSFULLY:
- **Name:** "${newWatch.name}"
- **URL:** ${newWatch.url}
- **Interval:** Every ${interval} minute(s)
- **Status:** 🟢 Active (Scheduled in background)${condPart}${selPart}
- **Watch ID:** \`${watchId}\`

NIM Agent will now automatically monitor this page in the background and trigger desktop notifications when changes or threshold conditions are detected.`;
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
    return `${idx + 1}. **${w.name}** [${statusBadge}] (Every ${w.intervalMinutes}m · Last checked: ${lastChecked} · Alerts: ${w.alertCount})${cond}\n  - URL: ${w.url}\n  - ID: \`${w.watchId}\`${lastVal}`;
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
