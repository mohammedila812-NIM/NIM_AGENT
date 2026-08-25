/**
 * INTERACTION POLICY — enforced in the executor, not in the prompt.
 *
 * STEP 1: DOM extraction (always first — fast and cheap)
 * STEP 2: DOM self-heal via accessibility tree (check selector cache first)
 * STEP 3: Vision fallback — ONLY when conditions below are met
 * NEVER use vision speculatively or for "confirmation".
 */

export const MIN_DOM_CHARS = 200;

/**
 * Returns true only when vision is genuinely warranted.
 * This is the ONLY gate for vision in engine.ts — the LLM cannot bypass it.
 */
export function shouldUseFallbackVision(
  domContent: string,
  failedDomAttempts: number,
  visionOptIn: boolean,
): boolean {
  if (visionOptIn) return true;
  if (domContent.trim().length < MIN_DOM_CHARS) return true;
  if (failedDomAttempts >= 2) return true;
  return false;
}
