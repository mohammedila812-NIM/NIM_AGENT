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
): Promise<ReflectResult> {
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

async function pressEnterFallback(tabId: number): Promise<ReflectResult> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const active = document.activeElement as HTMLElement | null;
        if (active) {
          active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          active.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
        }
        // Also try submitting the nearest form
        const form = active?.closest('form') as HTMLFormElement | null;
        if (form) form.requestSubmit?.();
      },
    });
    return { strategy: 'press_enter', executed: true, note: 'Dispatched Enter key on focused element.' };
  } catch (e) {
    return { strategy: 'press_enter', executed: false, note: `Enter key failed: ${e}` };
  }
}

async function scrollToElementFallback(tabId: number, selector?: string): Promise<ReflectResult> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel?: string) => {
        const el = sel ? document.querySelector(sel) : document.activeElement;
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      },
      args: [selector],
    });
    // Give scroll time to settle
    await new Promise(res => setTimeout(res, 600));
    return { strategy: 'scroll_to_element', executed: true, note: `Scrolled ${selector ?? 'active element'} into viewport.` };
  } catch (e) {
    return { strategy: 'scroll_to_element', executed: false, note: `Scroll failed: ${e}` };
  }
}

async function dismissModalFallback(tabId: number): Promise<ReflectResult> {
  try {
    const dismissed = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
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
          if (el && el.offsetParent !== null) {
            el.click();
            return `Clicked: ${sel}`;
          }
        }
        // Try pressing Escape to close keyboard-dismissible overlays
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return 'Pressed Escape key';
      },
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
    // Return the screenshot as evidence — the caller (engine) should use it as a vision message
    return {
      strategy: 'visual_coordinate_click',
      executed: true,
      note: `SoM_SCREENSHOT:${screenshotDataUrl.slice(0, 80)}…`,
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

/**
 * Detects common CAPTCHA and 2FA challenges on the current page.
 * If detected, the engine should pause and show a user HUD.
 */
export async function detectSecurityChallenge(tabId: number): Promise<ChallengeState> {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = (document.body?.innerText ?? '').toLowerCase();
        const title = document.title.toLowerCase();

        if (document.querySelector('iframe[src*="recaptcha"]') || text.includes('i am not a robot')) {
          return { detected: true, type: 'captcha', message: 'reCAPTCHA detected.' };
        }
        if (document.querySelector('[id*="cf-challenge"]') || title.includes('just a moment')) {
          return { detected: true, type: 'cloudflare', message: 'Cloudflare challenge detected.' };
        }
        if (document.querySelector('iframe[src*="hcaptcha"]') || text.includes('verify you are human')) {
          return { detected: true, type: 'captcha', message: 'hCaptcha detected.' };
        }
        if (text.includes('enter the code') || text.includes('verification code') || text.includes('two-factor') || text.includes('authenticator app')) {
          return { detected: true, type: '2fa', message: '2FA / OTP verification detected.' };
        }
        return { detected: false };
      },
    });
    return (result[0]?.result as ChallengeState | undefined) ?? { detected: false };
  } catch {
    return { detected: false };
  }
}
