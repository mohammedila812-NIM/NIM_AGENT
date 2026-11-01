/**
 * Self-Healing Reflection Loop — Phase 2 Triad
 *
 * When the Validator returns 'unchanged' (action had no effect), the Reflector
 * executes an ordered fallback strategy:
 *
 *   1. press_enter     — Submit focused element via keyboard
 *   2. scroll_to_element — Scroll target into viewport then retry
 *   3. dismiss_modal   — Close detected overlay/banner first
 *   4. visual_coordinate_click — Use Set-of-Marks screenshot-based click
 *   5. retry_same      — Wait 1.5s and retry exactly the same action
 *
 * Inspired by Skyvern's error recovery and Anthropic Computer Use.
 */

import type { FallbackStrategy } from './validator';
import { captureViewportWithMarks } from '../tools/set-of-marks';
import { hostMatchesAny } from '../sentinel/host-matcher';

export const EXCLUDED_AUTH_EXEMPT_DOMAINS = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'mail.yahoo.com',
  'mail.proton.me',
  'web.whatsapp.com',
  'instagram.com',
  'discord.com',
  'slack.com',
  'twitter.com',
  'x.com',
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReflectResult {
  strategy: FallbackStrategy;
  executed: boolean;
  note: string;
}

// ─── Recovery Executor ────────────────────────────────────────────────────────

/**
 * Executes a fallback recovery action in the target tab.
 * Returns a structured result describing what was attempted.
 */
export async function executeFallback(
  tabId: number,
  strategy: FallbackStrategy,
  elementSelector?: string,
  lastActionName?: string,
): Promise<ReflectResult> {
  if (strategy === 'retry_same' && lastActionName) {
    const lower = lastActionName.toLowerCase();
    const isNonIdempotent = /submit|pay|purchase|buy|delete|remove|send|post|transfer|order/i.test(lower);
    if (isNonIdempotent) {
      return {
        strategy: 'retry_same',
        executed: false,
        note: `NON_IDEMPOTENT_ACTION: Auto-retry prevented for non-idempotent action "${lastActionName}" to avoid duplicate transactions.`,
      };
    }
  }

  switch (strategy) {
    case 'press_enter':
      return pressEnterFallback(tabId);

    case 'scroll_to_element':
      return scrollToElementFallback(tabId, elementSelector);

    case 'dismiss_modal':
      return dismissModalFallback(tabId);

    case 'visual_coordinate_click':
      return visualCoordinateClickFallback(tabId);

    case 'retry_same':
      return retrySameFallback();

    default:
      return { strategy, executed: false, note: 'Unknown fallback strategy — no action taken.' };
  }
}

// ─── Strategy Implementations ─────────────────────────────────────────────────

export function pressEnterWorker() {
  const active = document.activeElement as HTMLElement | null;
  if (active) {
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    active.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
  }
  // Also try submitting the nearest form
  const form = active?.closest('form') as HTMLFormElement | null;
  if (form) form.requestSubmit?.();
}

async function pressEnterFallback(tabId: number): Promise<ReflectResult> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: pressEnterWorker,
    });
    return { strategy: 'press_enter', executed: true, note: 'Dispatched Enter key on focused element.' };
  } catch (e) {
    return { strategy: 'press_enter', executed: false, note: `Enter key failed: ${e}` };
  }
}

export function scrollToElementWorker(sel?: string) {
  const el = sel ? document.querySelector(sel) : document.activeElement;
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function scrollToElementFallback(tabId: number, selector?: string): Promise<ReflectResult> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: scrollToElementWorker,
      args: [selector],
    });
    // Give scroll time to settle
    await new Promise(res => setTimeout(res, 600));
    return { strategy: 'scroll_to_element', executed: true, note: `Scrolled ${selector ?? 'active element'} into viewport.` };
  } catch (e) {
    return { strategy: 'scroll_to_element', executed: false, note: `Scroll failed: ${e}` };
  }
}

export function dismissModalWorker() {
  // Common dismiss selectors: close buttons, cookie banners, gdpr overlays
  const candidates = [
    '[aria-label*="close" i]',
    '[aria-label*="dismiss" i]',
    'button[class*="close"]',
    'button[class*="dismiss"]',
    'button[class*="cookie"]',
    '.modal-close',
    '.popup-close',
    '[data-dismiss]',
    '[data-close]',
  ];
  for (const sel of candidates) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) {
      const isVisible = typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.offsetParent !== null;
      if (isVisible) {
        el.click();
        return `Clicked: ${sel}`;
      }
    }
  }
  // Try pressing Escape to close keyboard-dismissible overlays
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return 'Pressed Escape key';
}

async function dismissModalFallback(tabId: number): Promise<ReflectResult> {
  try {
    const dismissed = await chrome.scripting.executeScript({
      target: { tabId },
      func: dismissModalWorker,
    });
    const note = dismissed[0]?.result ?? 'Tried to dismiss modal.';
    return { strategy: 'dismiss_modal', executed: true, note };
  } catch (e) {
    return { strategy: 'dismiss_modal', executed: false, note: `Modal dismiss failed: ${e}` };
  }
}

async function visualCoordinateClickFallback(tabId: number): Promise<ReflectResult> {
  try {
    // Capture a Set-of-Marks screenshot so the LLM can select by visual number
    const screenshotDataUrl = await captureViewportWithMarks(tabId);
    // Return the full screenshot as evidence — the caller (engine) should use it as a vision message
    return {
      strategy: 'visual_coordinate_click',
      executed: true,
      note: `SoM_SCREENSHOT:${screenshotDataUrl}`,
    };
  } catch (e) {
    return { strategy: 'visual_coordinate_click', executed: false, note: `SoM screenshot failed: ${e}` };
  }
}

async function retrySameFallback(): Promise<ReflectResult> {
  await new Promise(res => setTimeout(res, 1500));
  return {
    strategy: 'retry_same',
    executed: true,
    note: 'Waited 1.5s for page to stabilize. Retrying the same action.',
  };
}

// ─── CAPTCHA / 2FA Detection ─────────────────────────────────────────────────

export interface ChallengeState {
  detected: boolean;
  type?: 'captcha' | '2fa' | 'cloudflare' | 'unknown';
  message?: string;
}

export interface ChallengeContext {
  url: string;
  title: string;
  bodyText: string;
  hasVisibleRecaptcha: boolean;
  hasVisibleHcaptcha: boolean;
  hasCfChallenge: boolean;
  hasActiveOtpInput: boolean;
  isDismissedByUser: boolean;
}

/** Pure evaluation of challenge state for unit testing & robust detection */
export function evaluateSecurityChallenge(ctx: ChallengeContext): ChallengeState {
  if (ctx.isDismissedByUser) {
    return { detected: false };
  }

  const host = (() => {
    try {
      return new URL(ctx.url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  // 1. Exclude Authenticated Webmail & Messaging Services
  // Email inboxes (Gmail, Outlook, Yahoo) and chat streams contain security/login notifications all day.
  // Unless we are on an actual auth login subdomain (e.g. accounts.google.com), never treat webmail as a 2FA challenge.
  const isWebmailOrFeed = hostMatchesAny(host, EXCLUDED_AUTH_EXEMPT_DOMAINS);

  // 2. CAPTCHA challenges (must be visible interactive challenge, not passive footer badges)
  if (ctx.hasVisibleRecaptcha) {
    return { detected: true, type: 'captcha', message: 'reCAPTCHA challenge detected.' };
  }
  if (ctx.hasVisibleHcaptcha) {
    return { detected: true, type: 'captcha', message: 'hCaptcha challenge detected.' };
  }
  if (ctx.hasCfChallenge || (ctx.title.toLowerCase().includes('just a moment') && ctx.bodyText.toLowerCase().includes('cloudflare'))) {
    return { detected: true, type: 'cloudflare', message: 'Cloudflare challenge detected.' };
  }

  // 3. Genuine 2FA / OTP challenges:
  // Requires:
  // a) It is NOT an authenticated webmail or feed app
  // b) A visible, dedicated OTP input field exists
  // c) The URL or page title reflects an active login / verification checkpoint
  if (!isWebmailOrFeed && ctx.hasActiveOtpInput) {
    const isAuthContext = /accounts\.google\.com\/signin\/(?:v2\/)?challenge/i.test(ctx.url) ||
      (!isWebmailOrFeed && (/login|signin|auth|checkpoint|challenge|verify|two-factor|2fa/i.test(ctx.url) ||
      /two-factor|verification code|verify your identity|security check|2-step verification|authenticator app/i.test(ctx.title)));
    if (isAuthContext) {
      return { detected: true, type: '2fa', message: '2FA / OTP verification detected.' };
    }
  }

  return { detected: false };
}

export function detectSecurityChallengeWorker() {
  const win = window as unknown as { __nimDismissedChallenge?: boolean };
  if (win.__nimDismissedChallenge) {
    return { detected: false };
  }

  const url = window.location.href;
  const host = window.location.hostname.toLowerCase();
  const title = document.title;
  const bodyText = (document.body?.innerText ?? '').slice(0, 10000);

  // Exclude authenticated webmail and chat feeds
  const excludedDomains = [
    'mail.google.com',
    'outlook.live.com',
    'outlook.office.com',
    'mail.yahoo.com',
    'mail.proton.me',
    'web.whatsapp.com',
    'instagram.com',
    'discord.com',
    'slack.com',
    'twitter.com',
    'x.com',
  ];
  const isWebmailOrFeed = excludedDomains.some((d) => host === d || host.endsWith('.' + d));

  // 1. Visible interactive CAPTCHAs
  const recaptchaIframe = document.querySelector<HTMLIFrameElement>('iframe[src*="recaptcha"]');
  const hasVisibleRecaptcha = !!(
    recaptchaIframe &&
    recaptchaIframe.offsetParent !== null &&
    recaptchaIframe.getBoundingClientRect().height > 40
  );

  const hcaptchaIframe = document.querySelector<HTMLIFrameElement>('iframe[src*="hcaptcha"]');
  const hasVisibleHcaptcha = !!(
    hcaptchaIframe &&
    hcaptchaIframe.offsetParent !== null &&
    hcaptchaIframe.getBoundingClientRect().height > 40
  );

  const cfEl = document.querySelector('[id*="cf-challenge"], #turnstile-wrapper iframe, #challenge-running');
  const hasCfChallenge = !!(cfEl && cfEl.getBoundingClientRect().height > 0);

  // 2. Active 2FA input field (never triggered purely by body text on webmail or articles)
  let hasActiveOtpInput = false;
  if (!isWebmailOrFeed) {
    const otpCandidates = Array.from(document.querySelectorAll<HTMLInputElement>(
      'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="2fa" i], input[id*="otp" i], input[id*="2fa" i], input[data-testid*="otp" i], input[data-testid*="verification-code" i], input[name*="totppin" i]'
    )).filter((el) => el.offsetParent !== null && !el.disabled);

    const singleDigitPins = Array.from(document.querySelectorAll<HTMLInputElement>('input[maxlength="1"]'))
      .filter((el) => el.offsetParent !== null && !el.disabled);

    hasActiveOtpInput = otpCandidates.length > 0 || singleDigitPins.length >= 4;
  }

  // Inline evaluation
  if (hasVisibleRecaptcha) {
    return { detected: true, type: 'captcha', message: 'reCAPTCHA challenge detected.' };
  }
  if (hasVisibleHcaptcha) {
    return { detected: true, type: 'captcha', message: 'hCaptcha challenge detected.' };
  }
  if (hasCfChallenge || (title.toLowerCase().includes('just a moment') && bodyText.toLowerCase().includes('cloudflare'))) {
    return { detected: true, type: 'cloudflare', message: 'Cloudflare challenge detected.' };
  }
  if (!isWebmailOrFeed && hasActiveOtpInput) {
    const isAuthContext = /accounts\.google\.com\/signin\/(?:v2\/)?challenge/i.test(url) ||
      (!isWebmailOrFeed && (/login|signin|auth|checkpoint|challenge|verify|two-factor|2fa/i.test(url) ||
      /two-factor|verification code|verify your identity|security check|2-step verification|authenticator app/i.test(title)));
    if (isAuthContext) {
      return { detected: true, type: '2fa', message: '2FA / OTP verification detected.' };
    }
  }

  return { detected: false };
}

/**
 * Detects common CAPTCHA and 2FA challenges on the current page.
 * If detected, the engine should pause and show a user HUD.
 */
export async function detectSecurityChallenge(tabId: number): Promise<ChallengeState> {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: detectSecurityChallengeWorker,
    });
    return (result[0]?.result as ChallengeState | undefined) ?? { detected: false };
  } catch {
    return { detected: false };
  }
}
