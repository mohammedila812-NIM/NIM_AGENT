/**
 * Sentinel Change Detector Engine 2.0 (High-Security & SPA Resilient)
 *
 * Real-time, continuous in-page sentinel watcher engineered specifically for:
 * - High-security and heavily obfuscated single-page apps (Instagram, WhatsApp Web, Discord, Slack, Messenger, Gmail)
 * - Dynamic Virtual DOM & React Fiber architectures (prevents observer detachment)
 * - Multi-layer detection: Unread Badges, Per-Thread Fingerprinting, Tab Title Alerts, & Deep Element Mutators
 *
 * Zero token consumption while idling.
 */

import { cleanMessagingSnippet } from './predicates';

export interface WatchPageChangesOptions {
  action?: 'start' | 'stop' | 'status';
  target?: string;
  changeType?: 'any' | 'text' | 'mutation' | 'attribute' | 'count';
  condition?: string;
  actionOnDetect?: 'ask' | 'auto_act' | 'notify';
  autonomousInstruction?: string;
  allowSending?: boolean;
  stopAfterChange?: boolean;
  timeoutSeconds?: number;
}

export interface ElementSnapshot {
  text: string;
  childCount: number;
  attributes: Record<string, string>;
  value?: string;
  timestamp: number;
}

export interface UnreadFingerprint {
  title: string;
  unreadCount: number;
  unreadBadgeText: string;
  activeDots: number;
  conversationSnippet: string;
}

export interface ChangeDelta {
  changed: boolean;
  type: 'text' | 'count' | 'attribute' | 'value' | 'mutation' | 'none';
  previousSnippet: string;
  currentSnippet: string;
  summary: string;
}

/** Pure delta calculation between two element snapshots for testing & verification */
export function detectElementDelta(
  prev: ElementSnapshot,
  curr: ElementSnapshot,
  preferredType: 'any' | 'text' | 'mutation' | 'attribute' | 'count' = 'any',
): ChangeDelta {
  // 1. Child node count change (e.g. new chat message, new post)
  if (prev.childCount !== curr.childCount && (preferredType === 'any' || preferredType === 'count' || preferredType === 'mutation')) {
    const diff = curr.childCount - prev.childCount;
    const direction = diff > 0 ? `added ${diff} new item(s)` : `removed ${Math.abs(diff)} item(s)`;
    return {
      changed: true,
      type: 'count',
      previousSnippet: `Items: ${prev.childCount}`,
      currentSnippet: `Items: ${curr.childCount}`,
      summary: `Container structure changed: ${direction}. Current content: "${curr.text.slice(0, 100)}"`,
    };
  }

  // 2. Input value change
  if (prev.value !== undefined && curr.value !== undefined && prev.value !== curr.value) {
    return {
      changed: true,
      type: 'value',
      previousSnippet: prev.value,
      currentSnippet: curr.value,
      summary: `Input value changed from "${prev.value.slice(0, 50)}" to "${curr.value.slice(0, 50)}"`,
    };
  }

  // 3. Text content change (e.g. price update, status text, unread badge counter)
  if (prev.text !== curr.text && (preferredType === 'any' || preferredType === 'text')) {
    return {
      changed: true,
      type: 'text',
      previousSnippet: prev.text.slice(0, 80),
      currentSnippet: curr.text.slice(0, 80),
      summary: `Text updated from "${prev.text.slice(0, 50)}" to "${curr.text.slice(0, 50)}"`,
    };
  }

  // 4. Attribute / state change (e.g. disabled flag, class change)
  if (preferredType === 'any' || preferredType === 'attribute') {
    const allKeys = Array.from(new Set([...Object.keys(prev.attributes), ...Object.keys(curr.attributes)]));
    for (const k of allKeys) {
      if (prev.attributes[k] !== curr.attributes[k]) {
        return {
          changed: true,
          type: 'attribute',
          previousSnippet: `${k}="${prev.attributes[k] ?? ''}"`,
          currentSnippet: `${k}="${curr.attributes[k] ?? ''}"`,
          summary: `Attribute "${k}" changed from "${prev.attributes[k] ?? '(none)'}" to "${curr.attributes[k] ?? '(none)'}"`,
        };
      }
    }
  }

  return {
    changed: false,
    type: 'none',
    previousSnippet: prev.text.slice(0, 40),
    currentSnippet: curr.text.slice(0, 40),
    summary: 'No detectable changes',
  };
}

/** Pure delta calculation for unread indicators, titles, and conversation lists */
export function detectUnreadDelta(prev: UnreadFingerprint, curr: UnreadFingerprint): ChangeDelta {
  // 1. Title unread changes, e.g. "(1) Instagram" or title text change
  if (prev.title !== curr.title) {
    const prevMatch = prev.title.match(/\((\d+)\)/);
    const currMatch = curr.title.match(/\((\d+)\)/);
    const prevCount = prevMatch ? parseInt(prevMatch[1], 10) : 0;
    const currCount = currMatch ? parseInt(currMatch[1], 10) : 0;

    // Finding 13a: Ignore decreases in unread count from title (e.g. reading a message)
    if (currCount >= prevCount && curr.title !== prev.title) {
      const countStr = currMatch ? `${currMatch[1]} unread notification(s)` : 'status change';
      return {
        changed: true,
        type: 'text',
        previousSnippet: prev.title,
        currentSnippet: curr.title,
        summary: `Tab title updated: "${curr.title}" (${countStr})`,
      };
    }
  }

  // 2. Unread indicator dot appeared (e.g. Instagram blue dot or WhatsApp green dot) - only on increase
  if (curr.activeDots > prev.activeDots) {
    const diff = curr.activeDots - prev.activeDots;
    return {
      changed: true,
      type: 'mutation',
      previousSnippet: `Active unread dots: ${prev.activeDots}`,
      currentSnippet: `Active unread dots: ${curr.activeDots}`,
      summary: `New unread message dot indicator detected (+${diff} new chat alert)`,
    };
  }

  // 3. Unread badge count INCREASED (Finding 13a: never alert on decrease)
  if (curr.unreadCount > prev.unreadCount) {
    const diff = curr.unreadCount - prev.unreadCount;
    return {
      changed: true,
      type: 'attribute',
      previousSnippet: `Unread badges: ${prev.unreadCount}`,
      currentSnippet: `Unread badges: ${curr.unreadCount}`,
      summary: `New unread badge / message alert (+${diff}): "${curr.unreadBadgeText.slice(0, 90)}"`,
    };
  }

  // 4. Conversation row changed (e.g. Ali: Hi · 1m)
  // Finding 8 & 13b: clean timestamps and ignore own messages
  const prevClean = cleanMessagingSnippet(prev.conversationSnippet);
  const currClean = cleanMessagingSnippet(curr.conversationSnippet);
  const isOwnMessage = /(?:^|\b)(?:You:\s*|You sent|You reacted)/i.test(curr.conversationSnippet);

  if (!isOwnMessage && prevClean !== currClean && currClean.length > 0) {
    return {
      changed: true,
      type: 'text',
      previousSnippet: prevClean.slice(0, 50),
      currentSnippet: currClean.slice(0, 50),
      summary: `New message arrived in chat list: "${currClean.slice(0, 90)}"`,
    };
  }

  return {
    changed: false,
    type: 'none',
    previousSnippet: '',
    currentSnippet: '',
    summary: 'No unread alerts detected',
  };
}

/**
 * Start the Sentinel in-page change detector on the specified browser tab.
 */
export async function startPageChangeDetector(
  tabId: number,
  options: WatchPageChangesOptions,
): Promise<string> {
  const targetDesc = options.target || 'page';
  const actionOnDetect = options.actionOnDetect || 'ask';
  const stopAfterChange = options.stopAfterChange ?? true;
  // Finding 14: Clamp timeoutSeconds to [5, 86400]
  const timeoutSec = Math.max(5, Math.min(86400, options.timeoutSeconds || 3600));
  const changeType = options.changeType || 'any';
  const condition = options.condition || 'any change';
  const autoInstruction = options.autonomousInstruction || '';

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: sentinelInjectedWatcher,
    args: [
      targetDesc,
      changeType,
      condition,
      actionOnDetect,
      autoInstruction,
      stopAfterChange,
      timeoutSec,
    ],
  });

  const res = results[0]?.result;
  // Finding 11: If target selector was specified and not found, return an error to the agent
  if (res && res.success === false) {
    return `ERROR: Failed to start Sentinel change detector. ${res.error || `Element matching "${targetDesc}" was not found on the page.`}`;
  }

  const autoMsg = autoInstruction
    ? `\n- **Autonomous Action Configured:** When change occurs, will autonomously execute: "${autoInstruction}".`
    : `\n- **Notification Mode:** When change occurs, will alert with an audio chime and ask what to do next.`;

  return `SENTINEL CHANGE DETECTOR ACTIVE:
- **Watching Target:** "${targetDesc}" (Type: ${changeType})
- **Condition:** "${condition}"
- **Mode:** ${actionOnDetect.toUpperCase()}${autoMsg}
- **Stop After Change:** ${stopAfterChange ? 'Yes (fires on first detected change)' : 'No (continuous monitoring)'}
- **Max Duration:** ${timeoutSec} seconds

The Sentinel 2.0 engine is now actively observing with full SPA & React virtualization resilience (watching unread message dots, conversation lists, and document title). ZERO API token consumption while watching.`;
}

/**
 * Stop the Sentinel in-page change detector on the specified browser tab.
 */
export async function stopPageChangeDetector(tabId: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: sentinelInjectedStopper,
  });

  const res = results[0]?.result;
  return res?.success
    ? `Stopped Sentinel change detector. Total changes observed: ${res.count}.`
    : `Sentinel was not active: ${res?.reason}`;
}

/**
 * Get current status of the Sentinel change detector on the tab.
 */
export async function getPageChangeDetectorStatus(tabId: number): Promise<string> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: sentinelInjectedStatusGetter,
  });

  const s = results[0]?.result;
  return `Sentinel Status: ${s?.active ? 'ACTIVE' : 'IDLE'} | Target: "${s?.target ?? 'none'}" | Changes Detected: ${s?.count ?? 0}.`;
}

/**
 * Injected script executed in page context via chrome.scripting.executeScript.
 * Must be 100% self-contained: NO free variables or references to outer module scope!
 */
export function sentinelInjectedWatcher(
  tgt: string,
  typePreference: string,
  condText: string,
  detectAction: string,
  instruction: string,
  shouldStopAfterChange: boolean,
  timeoutS: number,
) {
  const win = window as unknown as {
    __nimSentinelWatcher?: {
      stop: () => { count: number };
      getStatus: () => { active: boolean; count: number; target: string };
    };
  };

  if (win.__nimSentinelWatcher) {
    win.__nimSentinelWatcher.stop();
  }

  // --- Self-contained Pure In-Page Utilities ---
  function hostMatches(host: string, domain: string): boolean {
    const h = (host || '').toLowerCase();
    const d = (domain || '').toLowerCase();
    return h === d || h.endsWith('.' + d);
  }

  function parseNumeric(val: string): number | null {
    if (!val) return null;
    const cleaned = val.replace(/[$€£¥₹,\s]/g, '').trim();
    const match = cleaned.match(/[-+]?\d*\.?\d+/);
    if (!match) return null;
    const num = parseFloat(match[0]);
    return Number.isFinite(num) ? num : null;
  }

  function fastHash(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return (hash >>> 0).toString(16);
  }

  function cleanSnippet(snippet: string): string {
    if (!snippet) return '';
    return snippet
      .replace(/\b\d+\s*(mins?|minutes?|hours?|hrs?|days?|secs?|seconds?|weeks?|months?|years?)\s*ago\b/gi, '')
      .replace(/[·•]\s*\d+\s*[smhdwMy]/gi, '')
      .replace(/[·•]\s*(just now|yesterday|today)/gi, '')
      .replace(/\b\d+\s*[smhdw]\s*ago\b/gi, '')
      .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, '')
      .replace(/\b(just now|active now|active \d+[smhd] ago|online|typing\.\.\.)\b/gi, '')
      .replace(/[·•]\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function evaluatePredicate(condition: string, currText: string, _prevText?: string): boolean {
    if (!condition || condition === 'any' || condition === 'any change') return true;
    const cond = condition.trim();
    const lowerCond = cond.toLowerCase();
    const lowerCurr = (currText || '').toLowerCase();

    if (lowerCond === 'appears') {
      return (currText || '').trim().length > 0;
    }
    if (lowerCond === 'disappears') {
      return (currText || '').trim().length === 0;
    }
    if (lowerCond.startsWith('contains:')) {
      const needle = cond.slice('contains:'.length).trim().toLowerCase();
      return lowerCurr.includes(needle);
    }
    if (lowerCond.startsWith('regex:')) {
      const pattern = cond.slice('regex:'.length).trim();
      try {
        const re = new RegExp(pattern, 'i');
        return re.test(currText || '');
      } catch {
        return false;
      }
    }

    // Numeric comparison: <, <=, >, >=, ==, !=
    const numOpMatch = cond.match(/^([<>]=?|[!=]=?)\s*([$€£¥₹\s]*[\d,.]+)/);
    if (numOpMatch) {
      const op = numOpMatch[1];
      const targetNum = parseNumeric(numOpMatch[2]);
      const currNum = parseNumeric(currText);
      if (targetNum === null || currNum === null) return false;

      switch (op) {
        case '<': return currNum < targetNum;
        case '<=': return currNum <= targetNum;
        case '>': return currNum > targetNum;
        case '>=': return currNum >= targetNum;
        case '==':
        case '=': return currNum === targetNum;
        case '!=': return currNum !== targetNum;
      }
    }

    // Default substring match
    return lowerCurr.includes(lowerCond);
  }

  let changeCount = 0;
  let isWatching = true;
  let isSettled = false; // Finding 13c: Settle gate prevents false positives during page load
  let lastAlertTimestamp = 0; // Finding 14: Coalesce alerts within 3 seconds

  // Detect Platform and Target Scope
  const hostname = window.location.hostname || '';
  const isInstagram = hostMatches(hostname, 'instagram.com');
  const isWhatsApp = hostMatches(hostname, 'whatsapp.com');
  const isGmail = hostMatches(hostname, 'mail.google.com');
  const isDiscord = hostMatches(hostname, 'discord.com');
  const isSlack = hostMatches(hostname, 'slack.com');
  const isMessagingSite = isInstagram || isWhatsApp || isGmail || isDiscord || isSlack ||
    /messenger\.com|twitter\.com|x\.com|telegram\.org|teams\.microsoft\.com/i.test(hostname);

  const isGeneric = !tgt || tgt === 'page' || tgt === 'body' || tgt === 'main' || tgt === 'div[role="main"]' || tgt === '[role="main"]' || tgt === 'content';

  const displayTarget = isMessagingSite && isGeneric
    ? (isInstagram ? 'Instagram Direct Messages' : isGmail ? 'Gmail Inbox' : 'Messages & Activity')
    : (tgt || 'Page');

  // Locate target element
  function resolveTarget(): HTMLElement | null {
    if (!tgt || isGeneric) {
      const mainCandidate = document.querySelector<HTMLElement>('main, [role="main"], article');
      return mainCandidate || document.body;
    }
    try {
      const found = document.querySelector<HTMLElement>(tgt);
      if (found) return found;
    } catch { /* invalid CSS selector */ }

    // Fallback: search by aria-label, id, or class substring
    const all = Array.from(document.querySelectorAll<HTMLElement>('main, section, div, button, a, [role="region"], [role="main"]'));
    const lower = tgt.toLowerCase();
    const match = all.find((e) =>
      (e.getAttribute('aria-label') || '').toLowerCase().includes(lower) ||
      (e.getAttribute('id') || '').toLowerCase().includes(lower) ||
      (e.className || '').toLowerCase().includes(lower)
    );
    return match || null;
  }

  let targetEl = resolveTarget();

  // Finding 11: Fail fast if explicit selector wasn't found
  if (tgt && !isGeneric && !targetEl) {
    return { success: false, error: `Target element "${tgt}" was not found on the page.` };
  }

  // Audio alert chime using single, reusable Web Audio API context (Finding 14)
  let audioCtx: AudioContext | null = null;
  async function playChime() {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new AudioCtx();
      }
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.28, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.55);
    } catch { /* ignore */ }
  }

  // Snapshot 1: Real visible content snapshotting (Finding 11)
  function captureElementSnapshot(): { text: string; hash: string; deepCount: number; val?: string; attrStr: string } {
    if (!targetEl || targetEl === document.body) {
      const mainEl = document.querySelector<HTMLElement>('main, [role="main"], article') || document.body;
      const rawText = ((mainEl as HTMLElement).innerText || mainEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 10000);
      const hash = fastHash(rawText);
      const deepCount = mainEl.children.length;
      return { text: rawText.slice(0, 500), hash, deepCount, val: undefined, attrStr: '' };
    }
    const rawText = ((targetEl as HTMLElement).innerText || targetEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 10000);
    const hash = fastHash(rawText);
    const deepCount = targetEl.children.length;
    const val = (targetEl as HTMLInputElement).value;
    const attrStr = Array.from(targetEl.attributes).map(a => `${a.name}=${a.value}`).join(';');
    return { text: rawText.slice(0, 500), hash, deepCount, val, attrStr };
  }

  // Snapshot 2: Unread Badges & Per-Thread Fingerprinting (Finding 13b & 13d)
  interface ThreadFingerprint {
    key: string;
    cleanSnippet: string;
    hash: string;
    unread: boolean;
  }

  function captureUnreadFingerprint(): {
    title: string;
    unreadCount: number;
    activeDots: number;
    threads: ThreadFingerprint[];
    unreadBadgeText: string;
    conversationSnippet: string;
  } {
    const title = document.title || '';
    let unreadCount = 0;
    let activeDots = 0;
    const threads: ThreadFingerprint[] = [];
    let unreadBadgeText = '';
    let conversationSnippet = '';

    if (isInstagram) {
      // Instagram direct messages adapter (no layout-thrashing computed-style loops)
      const rows = Array.from(document.querySelectorAll<HTMLElement>(
        'a[href*="/direct/t/"], div[role="listitem"]'
      )).slice(0, 12);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const link = row.tagName.toLowerCase() === 'a'
          ? (row as HTMLAnchorElement).href
          : (row.querySelector<HTMLAnchorElement>('a')?.href || '');
        const fullText = (row.textContent || '').replace(/\s+/g, ' ').trim();
        const isOwn = /(?:^|\b)(?:You:\s*|You sent|You reacted)/i.test(fullText);
        const cleaned = cleanSnippet(fullText);

        const unreadEl = row.querySelector('[aria-label*="unread" i], svg[aria-label*="unread" i]');
        const hasUnread = !!unreadEl || (row.getAttribute('aria-label') || '').toLowerCase().includes('unread');

        if (hasUnread) {
          unreadCount++;
          activeDots++;
        }

        const key = link || (row.getAttribute('id') || `insta-row-${i}`);
        if (!isOwn && cleaned) {
          conversationSnippet += cleaned.slice(0, 50) + '||';
        }

        threads.push({
          key,
          cleanSnippet: isOwn ? '' : cleaned,
          hash: isOwn ? 'own' : fastHash(cleaned),
          unread: hasUnread,
        });
      }
    } else if (isWhatsApp) {
      // WhatsApp Web adapter
      const rows = Array.from(document.querySelectorAll<HTMLElement>(
        '#pane-side div[role="listitem"], #pane-side div[data-testid="cell-frame-container"]'
      )).slice(0, 12);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const fullText = (row.textContent || '').replace(/\s+/g, ' ').trim();
        const isOwn = /(?:^|\b)(?:You:\s*|You sent|You reacted)/i.test(fullText);
        const cleaned = cleanSnippet(fullText);

        const unreadBadge = row.querySelector('span[data-icon="unread-count"], span[data-testid="icon-unread-count"], [aria-label*="unread" i]');
        const badgeCount = unreadBadge ? (parseNumeric(unreadBadge.textContent || '1') || 1) : 0;

        if (badgeCount > 0) {
          unreadCount += badgeCount;
          activeDots++;
        }

        if (!isOwn && cleaned) {
          conversationSnippet += cleaned.slice(0, 50) + '||';
        }

        threads.push({
          key: `wa-row-${i}`,
          cleanSnippet: isOwn ? '' : cleaned,
          hash: isOwn ? 'own' : fastHash(cleaned),
          unread: badgeCount > 0,
        });
      }
    } else if (isGmail) {
      // Gmail adapter: tr.zE is Gmail's permanent class for unread threads
      const unreadRows = Array.from(document.querySelectorAll<HTMLElement>('tr.zE, tr[class*="zE"]'));
      unreadCount = unreadRows.length;
      activeDots = unreadCount > 0 ? 1 : 0;

      const tabBadges = Array.from(document.querySelectorAll<HTMLElement>('span.aKz, div[aria-label*="new" i]'));
      for (const b of tabBadges) {
        const c = parseNumeric(b.textContent || '');
        if (c) unreadCount += c;
      }
      unreadBadgeText = `${unreadCount} unread emails`;
    } else {
      // Generic messaging & standard DOM
      const unreadEls = Array.from(document.querySelectorAll<HTMLElement>(
        '[aria-label*="unread" i], [aria-label*="new message" i], [title*="unread" i], [data-badge], span[data-icon="unread-count"], [class*="unread" i]'
      ));
      unreadCount = unreadEls.length;
      unreadBadgeText = unreadEls.slice(0, 5).map(e => e.getAttribute('aria-label') || e.textContent || '').join(' | ');

      const rows = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="listitem"], [role="row"], div[data-testid*="conversation"], div[data-testid*="chat"]'
      )).slice(0, 12);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const fullText = (row.textContent || '').replace(/\s+/g, ' ').trim();
        const isOwn = /(?:^|\b)(?:You:\s*|You sent|You reacted)/i.test(fullText);
        const cleaned = cleanSnippet(fullText);
        const hasUnread = !!row.querySelector('[aria-label*="unread" i], svg[aria-label*="unread" i]');
        if (hasUnread) activeDots++;

        if (!isOwn && cleaned) {
          conversationSnippet += cleaned.slice(0, 50) + '||';
        }

        threads.push({
          key: `gen-row-${i}`,
          cleanSnippet: isOwn ? '' : cleaned,
          hash: isOwn ? 'own' : fastHash(cleaned),
          unread: hasUnread,
        });
      }
    }

    return { title, unreadCount, activeDots, threads, unreadBadgeText, conversationSnippet };
  }

  let baselineEl = captureElementSnapshot();
  let baselineFingerprint = captureUnreadFingerprint();

  // Finding 13c: Settle gate on start (1000ms delay to establish stable baseline after SPA hydration)
  setTimeout(() => {
    if (!isWatching) return;
    baselineEl = captureElementSnapshot();
    baselineFingerprint = captureUnreadFingerprint();
    isSettled = true;
  }, 1000);

  // Create isolated UI host with closed Shadow DOM (DOM XSS immune)
  const hostId = 'nim-sentinel-host';
  const existingHost = document.getElementById(hostId);
  if (existingHost) existingHost.remove();

  const host = document.createElement('div');
  host.id = hostId;
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  // Floating Sentinel Status Pill
  const hud = document.createElement('div');
  hud.id = 'nim-sentinel-hud';
  hud.style.cssText = `
    position: fixed;
    bottom: 28px;
    left: 28px;
    z-index: 2147483647;
    pointer-events: auto;
    background: rgba(15, 23, 42, 0.94);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(59, 130, 246, 0.6);
    border-radius: 9999px;
    padding: 8px 16px;
    color: #f8fafc;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 12px;
    font-weight: 500;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    gap: 12px;
    user-select: none;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  const badgeGroup = document.createElement('div');
  badgeGroup.style.cssText = 'display:flex;align-items:center;gap:6px;';
  const pulseDot = document.createElement('span');
  pulseDot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6;box-shadow:0 0 10px #3b82f6;';
  const badgeTitle = document.createElement('span');
  badgeTitle.style.cssText = 'font-weight:600;color:#93c5fd;letter-spacing:0.02em;';
  badgeTitle.textContent = 'SENTINEL';
  badgeGroup.appendChild(pulseDot);
  badgeGroup.appendChild(badgeTitle);

  const divider = document.createElement('span');
  divider.style.cssText = 'height:12px;width:1px;background:rgba(255,255,255,0.2);';

  const targetSpan = document.createElement('span');
  targetSpan.style.cssText = 'color:#e2e8f0;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const targetLabel = document.createTextNode('Watching: ');
  const targetBold = document.createElement('b');
  targetBold.style.cssText = 'color:#ffffff;';
  targetBold.textContent = displayTarget;
  targetSpan.appendChild(targetLabel);
  targetSpan.appendChild(targetBold);

  const alertBadge = document.createElement('span');
  alertBadge.id = 'nim-sentinel-changes';
  alertBadge.style.cssText = 'color:#94a3b8;font-size:11px;';
  alertBadge.textContent = '0 alerts';

  const stopBtn = document.createElement('button');
  stopBtn.id = 'nim-sentinel-stop-btn';
  stopBtn.style.cssText = 'background:rgba(239,68,68,0.2);color:#fca5a5;border:1px solid rgba(239,68,68,0.4);padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;';
  stopBtn.textContent = 'Stop';
  stopBtn.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    win.__nimSentinelWatcher?.stop();
  });

  hud.appendChild(badgeGroup);
  hud.appendChild(divider);
  hud.appendChild(targetSpan);
  hud.appendChild(alertBadge);
  hud.appendChild(stopBtn);

  shadow.appendChild(hud);
  document.body.appendChild(host);

  // In-Page Notification Card (Finding 14: show at most one card at any time)
  function renderNotificationCard(summary: string) {
    const existingCard = shadow.getElementById('nim-sentinel-notification-card');
    if (existingCard) {
      existingCard.remove();
    }

    const card = document.createElement('div');
    card.id = 'nim-sentinel-notification-card';
    card.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 2147483647;
      pointer-events: auto;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(59, 130, 246, 0.8);
      border-radius: 16px;
      padding: 14px 18px;
      color: #f8fafc;
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      max-width: 380px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
    `;

    const cardHeader = document.createElement('div');
    cardHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;';
    const cardHeaderLeft = document.createElement('div');
    cardHeaderLeft.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const cardDot = document.createElement('span');
    cardDot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:#3b82f6;box-shadow:0 0 10px #3b82f6;';
    const cardTitle = document.createElement('span');
    cardTitle.style.cssText = 'font-weight:700;color:#93c5fd;font-size:12px;letter-spacing:0.02em;';
    cardTitle.textContent = 'NIM SENTINEL ALERT';
    cardHeaderLeft.appendChild(cardDot);
    cardHeaderLeft.appendChild(cardTitle);
    cardHeader.appendChild(cardHeaderLeft);

    const cardSummary = document.createElement('p');
    cardSummary.style.cssText = 'font-size:12px;color:#f1f5f9;margin:0 0 10px 0;line-height:1.4;word-break:break-word;';
    cardSummary.textContent = summary;

    const cardActions = document.createElement('div');
    cardActions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    const dismissBtn = document.createElement('button');
    dismissBtn.id = 'nim-card-dismiss-btn';
    dismissBtn.style.cssText = 'background:rgba(255,255,255,0.1);color:#cbd5e1;border:none;padding:4px 12px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      card.remove();
    });

    const actionBtn = document.createElement('button');
    actionBtn.id = 'nim-card-action-btn';
    actionBtn.style.cssText = 'background:#2563eb;color:#ffffff;border:none;padding:4px 12px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;';
    actionBtn.textContent = instruction ? 'Execute Action' : 'Open NIM';
    actionBtn.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'SENTINEL_TRIGGER_ACTION',
          instruction: instruction || 'Analyze and react to the detected change.',
          changeSummary: summary,
        });
      }
      card.remove();
    });

    cardActions.appendChild(dismissBtn);
    cardActions.appendChild(actionBtn);

    card.appendChild(cardHeader);
    card.appendChild(cardSummary);
    card.appendChild(cardActions);
    shadow.appendChild(card);

    setTimeout(() => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(-10px)';
      card.style.transition = 'all 0.4s ease';
      setTimeout(() => card.remove(), 400);
    }, 12000);
  }

  // Trigger Alert Modal on Change
  function triggerChangeAlert(summary: string) {
    const now = Date.now();
    // Finding 14: Coalesce rapid duplicate alerts within 3 seconds
    if (now - lastAlertTimestamp < 3000) {
      return;
    }
    lastAlertTimestamp = now;

    try {
      changeCount++;
      void playChime();

      if (alertBadge) alertBadge.textContent = `${changeCount} alert(s)`;
      renderNotificationCard(summary);

      // Notify extension background worker
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'PAGE_CHANGE_DETECTED',
          target: displayTarget,
          summary,
          actionOnDetect: detectAction,
          autonomousInstruction: instruction,
          url: window.location.href,
          timestamp: now,
        });
      }
    } catch (err) {
      console.warn('[Sentinel] Alert trigger error:', err);
    } finally {
      if (shouldStopAfterChange) {
        win.__nimSentinelWatcher?.stop();
      } else {
        baselineEl = captureElementSnapshot();
        baselineFingerprint = captureUnreadFingerprint();
      }
    }
  }

  // Evaluation tick
  function checkDelta() {
    if (!isWatching || !isSettled) return;

    // Finding 11: Re-resolve target every tick if disconnected (DOM node replacement resilience)
    if (tgt && !isGeneric) {
      if (!targetEl || !targetEl.isConnected) {
        targetEl = resolveTarget();
        if (!targetEl) {
          if (condText.toLowerCase() === 'disappears') {
            triggerChangeAlert(`Target element "${tgt}" disappeared from the page.`);
          }
          return;
        }
      }
    }

    // A. Check Global Messaging & Unread Deltas
    const currFingerprint = captureUnreadFingerprint();

    // 1. Title change (e.g. "(1) Instagram • Chats")
    if (currFingerprint.title !== baselineFingerprint.title) {
      const prevMatch = baselineFingerprint.title.match(/\((\d+)\)/);
      const currMatch = currFingerprint.title.match(/\((\d+)\)/);
      const prevCount = prevMatch ? parseInt(prevMatch[1], 10) : 0;
      const currCount = currMatch ? parseInt(currMatch[1], 10) : 0;

      // Finding 13a: Ignore decreases in unread count from title
      if (currCount >= prevCount) {
        const countDesc = currMatch ? `${currMatch[1]} unread item(s)` : 'tab status changed';
        triggerChangeAlert(`Activity alert: Tab title changed to "${currFingerprint.title}" (${countDesc})`);
        return;
      }
    }

    // 2. Active unread dot appeared (Instagram blue dot, WhatsApp green dot) - only on increase
    if (currFingerprint.activeDots > baselineFingerprint.activeDots) {
      const diff = currFingerprint.activeDots - baselineFingerprint.activeDots;
      triggerChangeAlert(`New unread message dot detected (+${diff})`);
      return;
    }

    // 3. Unread badges count INCREASED (Finding 13a: never alert on decrease)
    if (currFingerprint.unreadCount > baselineFingerprint.unreadCount) {
      const diff = currFingerprint.unreadCount - baselineFingerprint.unreadCount;
      triggerChangeAlert(`New unread notification badge (+${diff})`);
      return;
    }

    // 4. Per-thread changes (Finding 13b)
    for (const currThread of currFingerprint.threads) {
      if (currThread.hash === 'own' || !currThread.cleanSnippet) continue;
      const prevThread = baselineFingerprint.threads.find(t => t.key === currThread.key);
      if (!prevThread) {
        triggerChangeAlert(`New incoming message detected in chat list: "${currThread.cleanSnippet.slice(0, 90)}"`);
        return;
      } else if (prevThread.hash !== currThread.hash) {
        triggerChangeAlert(`New message received in chat: "${currThread.cleanSnippet.slice(0, 90)}"`);
        return;
      }
    }

    // B. Check Target Element Deltas (for specific element or generic page)
    if (targetEl && targetEl.isConnected) {
      const currEl = captureElementSnapshot();

      // Generic page / body target snapshot comparison (Finding 11)
      if (targetEl === document.body) {
        if (currEl.hash !== baselineEl.hash) {
          if (condText && condText !== 'any' && condText !== 'any change') {
            if (!evaluatePredicate(condText, currEl.text, baselineEl.text)) return;
          }
          triggerChangeAlert(`Page content updated: "${currEl.text.slice(0, 80)}"`);
          return;
        }
      } else {
        // Child node additions (DOM tree growth)
        if (currEl.deepCount !== baselineEl.deepCount && (typePreference === 'any' || typePreference === 'count' || typePreference === 'mutation')) {
          const diff = currEl.deepCount - baselineEl.deepCount;
          if (Math.abs(diff) > 0) {
            if (condText && condText !== 'any' && condText !== 'any change') {
              if (!evaluatePredicate(condText, currEl.text, baselineEl.text)) return;
            }
            const summary = diff > 0
              ? `DOM updated (+${diff} elements in "${tgt || 'page'}")`
              : `Container updated (${Math.abs(diff)} elements removed)`;
            triggerChangeAlert(summary);
            return;
          }
        }

        // Input values
        if (currEl.val !== undefined && baselineEl.val !== undefined && currEl.val !== baselineEl.val) {
          if (condText && condText !== 'any' && condText !== 'any change') {
            if (!evaluatePredicate(condText, currEl.val, baselineEl.val)) return;
          }
          triggerChangeAlert(`Input value changed to: "${currEl.val.slice(0, 50)}"`);
          return;
        }

        // Text content updates
        if (currEl.text !== baselineEl.text && (typePreference === 'any' || typePreference === 'text')) {
          if (condText && condText !== 'any' && condText !== 'any change') {
            if (!evaluatePredicate(condText, currEl.text, baselineEl.text)) return;
          }
          triggerChangeAlert(`Content updated: "${currEl.text.slice(0, 90)}"`);
          return;
        }

        // Attribute changes
        if (currEl.attrStr !== baselineEl.attrStr && (typePreference === 'any' || typePreference === 'attribute')) {
          triggerChangeAlert(`Element attributes modified on "${tgt || 'element'}"`);
          return;
        }
      }
    }
  }

  // Throttled Scheduler: Prevents event loop starvation / freezes on high-frequency SPAs
  let isChecking = false;
  let throttleTimer: number | null = null;
  let lastCheckTimestamp = 0;

  function scheduleCheck() {
    if (!isWatching || isChecking) return;
    const now = Date.now();
    // Cooldown of at least 800ms between evaluations
    if (now - lastCheckTimestamp < 800) {
      if (!throttleTimer) {
        throttleTimer = window.setTimeout(() => {
          throttleTimer = null;
          scheduleCheck();
        }, 800 - (now - lastCheckTimestamp));
      }
      return;
    }

    lastCheckTimestamp = now;
    isChecking = true;
    try {
      checkDelta();
    } finally {
      isChecking = false;
    }
  }

  // Root Mutation Observer: ignores attributes across entire body to eliminate React microtask thrashing
  const observer = new MutationObserver(() => {
    scheduleCheck();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: false,
    attributes: false,
  });

  // Dedicated Title Observer
  const titleEl = document.querySelector('title') || document.head;
  if (titleEl) {
    observer.observe(titleEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Heartbeat Polling Interval (runs throttled at 1200ms)
  const interval = setInterval(scheduleCheck, 1200);

  // Auto-timeout
  const timeoutTimer = setTimeout(() => {
    win.__nimSentinelWatcher?.stop();
  }, timeoutS * 1000);

  win.__nimSentinelWatcher = {
    stop: () => {
      isWatching = false;
      clearInterval(interval);
      clearTimeout(timeoutTimer);
      if (throttleTimer) clearTimeout(throttleTimer);
      observer.disconnect();

      if (audioCtx && audioCtx.state !== 'closed') {
        try {
          audioCtx.close().catch(() => {});
        } catch { /* ignore */ }
        audioCtx = null;
      }

      hud.style.opacity = '0';
      hud.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => host.remove(), 300);
      delete win.__nimSentinelWatcher;
      return { count: changeCount };
    },
    getStatus: () => ({ active: isWatching, count: changeCount, target: displayTarget }),
  };

  return { success: true, target: displayTarget };
}

export function sentinelInjectedStopper() {
  const win = window as unknown as {
    __nimSentinelWatcher?: { stop: () => { count: number } };
  };
  if (win.__nimSentinelWatcher) {
    const res = win.__nimSentinelWatcher.stop();
    return { success: true, count: res?.count ?? 0 };
  }
  return { success: false, reason: 'No active Sentinel watcher was running on this tab.' };
}

export function sentinelInjectedStatusGetter() {
  const win = window as unknown as {
    __nimSentinelWatcher?: { getStatus: () => { active: boolean; count: number; target: string } };
  };
  if (win.__nimSentinelWatcher) {
    return win.__nimSentinelWatcher.getStatus();
  }
  return { active: false, count: 0, target: 'none' };
}
