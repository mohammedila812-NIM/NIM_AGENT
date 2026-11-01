/**
 * Chrome DevTools Protocol (CDP) Policy & Capability Tiers
 *
 * Implements strict principle-of-least-privilege capability tiers,
 * explicit method allowlists, forbidden method blocks, and fail-closed
 * domain safety gates.
 */

import { hostMatches } from '../sentinel/host-matcher';

export type DevToolsTier = 'T0' | 'T1' | 'T2' | 'T3';

export const TIER_LEVELS: Record<DevToolsTier, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
};

// ── Explicit Denylist of Forbidden CDP Method Families ───────────────────────
// These methods can NEVER be executed at ANY tier.
export const FORBIDDEN_CDP_PATTERNS: readonly RegExp[] = [
  /^Browser\./i,
  /^Target\./i,
  /^Storage\.getCookies$/i,
  /^Network\.getAllCookies$/i,
  /^Security\./i,
  /^Page\.setDownloadBehavior$/i,
  /^IO\./i,
  /^SystemInfo\./i,
  /^Emulation\./i,
  /^Cast\./i,
  /^HeadlessExperimental\./i,
] as const;

// ── Tier Allowlists ──────────────────────────────────────────────────────────

export const T0_METHODS: readonly string[] = [
  'DOM.enable',
  'DOM.disable',
  'DOM.getDocument',
  'DOM.describeNode',
  'DOM.querySelector',
  'DOM.querySelectorAll',
  'DOM.getBoxModel',
  'DOM.requestNode',
  'CSS.enable',
  'CSS.disable',
  'CSS.getMatchedStylesForNode',
  'CSS.getComputedStyleForNode',
  'CSS.getInlineStylesForNode',
  'Log.enable',
  'Log.disable',
  'Console.enable',
  'Console.disable',
  'Runtime.enable',
  'Runtime.disable',
  'Network.enable',
  'Network.disable',
  'Network.getRequestPostData',
  'Accessibility.enable',
  'Accessibility.disable',
  'Accessibility.getFullAXTree',
  'Accessibility.getPartialAXTree',
  'Page.enable',
  'Page.disable',
  'Page.getResourceTree',
];

export const T1_METHODS: readonly string[] = [
  ...T0_METHODS,
  'Network.getResponseBody',
  'DOMStorage.enable',
  'DOMStorage.disable',
  'DOMStorage.getDOMStorageItems',
  'IndexedDB.enable',
  'IndexedDB.disable',
  'IndexedDB.requestDatabaseNames',
  'IndexedDB.requestData',
  'Network.getCookies',
];

export const T2_METHODS: readonly string[] = [
  ...T1_METHODS,
  'DOM.setOuterHTML',
  'DOM.setAttributeValue',
  'DOM.removeAttribute',
  'CSS.setStyleTexts',
  'CSS.setRuleSelector',
  'Debugger.enable',
  'Debugger.disable',
  'Debugger.setScriptSource',
  'Fetch.enable',
  'Fetch.disable',
  'Fetch.fulfillRequest',
  'Fetch.continueRequest',
  'Fetch.failRequest',
];

export const T3_METHODS: readonly string[] = [
  ...T2_METHODS,
  'Runtime.evaluate',
  'Runtime.callFunctionOn',
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
];

const TIER_ALLOWLISTS: Record<DevToolsTier, Set<string>> = {
  T0: new Set(T0_METHODS),
  T1: new Set(T1_METHODS),
  T2: new Set(T2_METHODS),
  T3: new Set(T3_METHODS),
};

// ── Domain Blocklist ─────────────────────────────────────────────────────────

export const DEFAULT_DEVTOOLS_BLOCKLIST: readonly string[] = [
  // Banking / Financial
  'paypal.com',
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'citi.com',
  'capitalone.com',
  'stripe.com',
  'coinbase.com',
  'fidelity.com',
  'schwab.com',
  // Webmail & Auth
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'mail.yahoo.com',
  'mail.proton.me',
  'accounts.google.com',
  'login.microsoftonline.com',
  'appleid.apple.com',
  // Password Managers
  '1password.com',
  'bitwarden.com',
  'dashlane.com',
  'lastpass.com',
  'passwords.google.com',
  // Private Messaging
  'web.whatsapp.com',
  'discord.com',
  'telegram.org',
  'slack.com',
  // Web Stores & Browser Internal Schemes
  'chromewebstore.google.com',
  'chrome.google.com',
  // LLM Provider Consoles
  'platform.openai.com',
  'console.anthropic.com',
  'console.groq.com',
  'build.nvidia.com',
  'aistudio.google.com',
] as const;

export const FORBIDDEN_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'data:',
  'view-source:',
];

/**
 * Checks if a given CDP method is explicitly forbidden across all tiers.
 */
export function isForbiddenCDPMethod(method: string): boolean {
  return FORBIDDEN_CDP_PATTERNS.some((pattern) => pattern.test(method));
}

/**
 * Checks if a CDP method is authorized under the given capability tier.
 */
export function isMethodAllowedForTier(method: string, tier: DevToolsTier): boolean {
  if (isForbiddenCDPMethod(method)) return false;
  return TIER_ALLOWLISTS[tier]?.has(method) ?? false;
}

/**
 * Checks if a URL or host is blocked from DevTools inspection. Fail-closed.
 */
export function isDevToolsBlockedUrl(
  urlStr: string,
  userBlocklist: readonly string[] = [],
): { blocked: boolean; reason?: string } {
  if (!urlStr) {
    return { blocked: true, reason: 'Empty or undefined URL' };
  }

  // 1. Check forbidden URI schemes
  const lowerUrl = urlStr.toLowerCase().trim();
  for (const scheme of FORBIDDEN_SCHEMES) {
    if (lowerUrl.startsWith(scheme)) {
      return { blocked: true, reason: `Inspection of internal browser scheme "${scheme}" is strictly forbidden` };
    }
  }

  // 2. Parse hostname
  let host = '';
  try {
    host = new URL(urlStr).hostname.toLowerCase();
  } catch {
    return { blocked: true, reason: 'Failed to parse URL hostname (fail-closed)' };
  }

  if (!host) {
    return { blocked: true, reason: 'URL has no valid hostname' };
  }

  // 3. Check combined domain blocklist (using exact or dot-suffix matching)
  const combinedList = [...DEFAULT_DEVTOOLS_BLOCKLIST, ...userBlocklist];
  for (const blockedDomain of combinedList) {
    if (hostMatches(host, blockedDomain)) {
      return { blocked: true, reason: `Domain "${host}" is in the DevTools security blocklist (${blockedDomain})` };
    }
  }

  return { blocked: false };
}

// ── Session Tier Storage ─────────────────────────────────────────────────────

const SESSION_TIER_KEY_PREFIX = 'devtools_tier_';

export async function getDevToolsSessionTier(tabId: number): Promise<DevToolsTier | null> {
  const key = `${SESSION_TIER_KEY_PREFIX}${tabId}`;
  const r = await chrome.storage.session.get(key);
  return (r[key] as DevToolsTier | undefined) ?? null;
}

export async function setDevToolsSessionTier(tabId: number, tier: DevToolsTier): Promise<void> {
  const key = `${SESSION_TIER_KEY_PREFIX}${tabId}`;
  await chrome.storage.session.set({ [key]: tier });
}

export async function clearDevToolsSessionTier(tabId: number): Promise<void> {
  const key = `${SESSION_TIER_KEY_PREFIX}${tabId}`;
  await chrome.storage.session.remove(key);
}
