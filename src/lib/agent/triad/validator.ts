/**
 * Validator Agent — Phase 2 Triad
 *
 * Compares pre-action and post-action browser state snapshots to verify that
 * the Actor's tool call had real, observable effect.
 *
 * Inspired by Skyvern's verifier and Anthropic Computer Use's outcome checking.
 */

import { chatCompletion } from '../../llm/client';
import type { ProviderConfig } from '../../llm/types';
import type { DiscoveredModel } from '../../llm/model-registry';
import type { Milestone } from './planner';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageSnapshot {
  url: string;
  title: string;
  /** Compact DOM fingerprint — a hash of visible text / input values */
  domFingerprint: string;
  /** ISO timestamp of snapshot */
  capturedAt: string;
}

export type ValidationOutcome =
  | { verdict: 'passed'; evidence: string }
  | { verdict: 'unchanged'; suggestion: FallbackStrategy }
  | { verdict: 'error'; reason: string };

export type FallbackStrategy =
  | 'press_enter'
  | 'scroll_to_element'
  | 'dismiss_modal'
  | 'visual_coordinate_click'
  | 'retry_same';

// ─── Snapshot helpers ─────────────────────────────────────────────────────────

/**
 * Captures a lightweight snapshot of the current tab state.
 * Called in background context — uses chrome.scripting.executeScript.
 */
export async function captureSnapshot(tabId: number): Promise<PageSnapshot> {
  const tab = await chrome.tabs.get(tabId);

  const fingerprint = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // Collect visible text + input values for a cheap DOM fingerprint
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea, select'))
        .map(el => `${el.name ?? el.id}=${(el as HTMLInputElement).value ?? ''}`)
        .join('|');
      const bodyText = (document.body?.innerText ?? '').slice(0, 500);
      return btoa(encodeURIComponent(inputs + bodyText)).slice(0, 64);
    },
  });

  return {
    url: tab.url ?? '',
    title: tab.title ?? '',
    domFingerprint: fingerprint[0]?.result ?? '',
    capturedAt: new Date().toISOString(),
  };
}

// ─── Delta Evaluation ─────────────────────────────────────────────────────────

/**
 * Compares two snapshots and returns a quick heuristic verdict.
 * Used as a fast check before calling the LLM validator.
 */
export function computeSnapshotDelta(before: PageSnapshot, after: PageSnapshot): {
  urlChanged: boolean;
  titleChanged: boolean;
  domChanged: boolean;
} {
  return {
    urlChanged: before.url !== after.url,
    titleChanged: before.title !== after.title,
    domChanged: before.domFingerprint !== after.domFingerprint,
  };
}

// ─── LLM Validator ────────────────────────────────────────────────────────────

const VALIDATOR_SYSTEM = `You are the Validator component of a browser-automation agent named NIM Agent.

Your job is to determine if an actor's action succeeded by comparing BEFORE and AFTER browser snapshots.

INPUT: A JSON object with:
- "milestone": the step being validated
- "action": what the actor just tried to do
- "before": { url, title, domFingerprint }
- "after": { url, title, domFingerprint }
- "delta": { urlChanged, titleChanged, domChanged }

OUTPUT: Respond with ONLY valid JSON in one of these shapes:

Success:
{ "verdict": "passed", "evidence": "<one-sentence description of what changed and why it confirms success>" }

No change detected:
{ "verdict": "unchanged", "suggestion": "<one of: press_enter | scroll_to_element | dismiss_modal | visual_coordinate_click | retry_same>" }

Error:
{ "verdict": "error", "reason": "<short description of what went wrong>" }

RULES:
- If ANY of urlChanged, titleChanged, or domChanged is true, lean toward "passed" unless the change is clearly unrelated.
- "unchanged" means the action had zero visible effect — the element may have been blocked, overlaid, or mis-targeted.
- Only return "error" if the after state shows an explicit error (404, crash, exception message).
- No prose, no markdown. ONLY the JSON object.`;

/**
 * Validates whether the action achieved the milestone using LLM reasoning.
 * Falls back to heuristic delta if LLM call fails.
 */
export async function validateActionOutcome(
  milestone: Milestone,
  actionDescription: string,
  before: PageSnapshot,
  after: PageSnapshot,
  providerConfig: ProviderConfig,
  model: DiscoveredModel,
): Promise<ValidationOutcome> {
  const delta = computeSnapshotDelta(before, after);

  // Fast heuristic: if nothing changed at all, skip LLM and return 'unchanged' immediately
  if (!delta.urlChanged && !delta.titleChanged && !delta.domChanged) {
    return { verdict: 'unchanged', suggestion: chooseFallback(actionDescription) };
  }

  // For clear navigation successes, skip the LLM call too
  if (delta.urlChanged) {
    return { verdict: 'passed', evidence: `URL changed from ${before.url} to ${after.url}` };
  }

  // Call the LLM for nuanced cases (e.g. DOM mutation without URL change)
  try {
    const payload = {
      milestone: milestone.label,
      action: actionDescription,
      before: { url: before.url, title: before.title, domFingerprint: before.domFingerprint },
      after: { url: after.url, title: after.title, domFingerprint: after.domFingerprint },
      delta,
    };

    const response = await chatCompletion(
      providerConfig,
      {
        model: model.id,
        messages: [
          { role: 'system', content: VALIDATOR_SYSTEM },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        temperature: 0.1,
      },
    );

    const raw = ((response.choices[0]?.message?.content as string) ?? '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const result = JSON.parse(raw) as ValidationOutcome;
    return result;
  } catch {
    // Fallback: DOM changed = optimistic pass
    if (delta.domChanged) {
      return { verdict: 'passed', evidence: 'DOM content changed after action.' };
    }
    return { verdict: 'unchanged', suggestion: 'retry_same' };
  }
}

// ─── Fallback Strategy ────────────────────────────────────────────────────────

const MODAL_KEYWORDS = ['modal', 'overlay', 'popup', 'dialog', 'banner', 'cookie', 'gdpr', 'consent'];
const SCROLL_KEYWORDS = ['scroll', 'below', 'bottom', 'below the fold', 'out of viewport'];
const ENTER_KEYWORDS = ['type', 'search', 'input', 'form', 'submit', 'enter'];

/**
 * Picks the most likely recovery strategy based on the action description.
 */
export function chooseFallback(actionDescription: string): FallbackStrategy {
  const lower = actionDescription.toLowerCase();
  if (MODAL_KEYWORDS.some(k => lower.includes(k))) return 'dismiss_modal';
  if (SCROLL_KEYWORDS.some(k => lower.includes(k))) return 'scroll_to_element';
  if (ENTER_KEYWORDS.some(k => lower.includes(k))) return 'press_enter';
  return 'visual_coordinate_click';
}

/** Maps a FallbackStrategy to a human-readable instruction for the Actor. */
export function describeFallback(strategy: FallbackStrategy): string {
  const map: Record<FallbackStrategy, string> = {
    press_enter: 'Press the Enter key on the currently focused element.',
    scroll_to_element: 'Scroll the target element into the center of the viewport, then retry.',
    dismiss_modal: 'Dismiss any visible modal, cookie banner, or overlay first, then retry the action.',
    visual_coordinate_click: 'Use Set-of-Marks visual mode to identify and click the element by screen coordinate.',
    retry_same: 'Retry the same action after a short pause — the page may have been loading.',
  };
  return map[strategy];
}
