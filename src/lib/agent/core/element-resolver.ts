/**
 * Element Resolver & TOCTOU Integrity Guard
 *
 * Centralized in-page element discovery and strong fingerprinting for:
 * - ID-based target resolution ([data-nim-id="..."])
 * - CSS selector and semantic text fallback
 * - Coordinate-based resolution (document.elementFromPoint)
 * - TOCTOU (Time-Of-Check to Time-Of-Use) verification after Human-In-The-Loop approvals
 */

export interface ElementFingerprint {
  tag: string;
  normalizedText: string;
  ariaLabel: string;
  role: string;
  href: string;
  name: string;
  nimId: string;
}

/**
 * Creates a strong fingerprint of an element for TOCTOU verification.
 * Injected and executed in page context.
 */
export function extractElementFingerprint(el: HTMLElement): ElementFingerprint {
  const tag = el.tagName.toLowerCase();
  const rawText = (el.textContent || '').replace(/\s+/g, ' ').trim();
  const normalizedText = rawText.slice(0, 60);
  const ariaLabel = el.getAttribute('aria-label') || '';
  const role = el.getAttribute('role') || '';
  const href = (el as HTMLAnchorElement).href || (el.getAttribute('href') || '');
  const name = (el as HTMLInputElement).name || '';
  const nimId = el.getAttribute('data-nim-id') || '';

  return {
    tag,
    normalizedText,
    ariaLabel,
    role,
    href,
    name,
    nimId,
  };
}

/**
 * Verifies that a resolved element matches its pre-HITL expected fingerprint.
 * Returns true if the element still represents the exact same interactive item.
 */
export function verifyElementFingerprint(
  current: HTMLElement,
  expected: ElementFingerprint,
): { matched: boolean; reason?: string } {
  const currFingerprint = extractElementFingerprint(current);

  // 1. Tag name must match
  if (currFingerprint.tag !== expected.tag) {
    return {
      matched: false,
      reason: `Tag changed from <${expected.tag}> to <${currFingerprint.tag}>`,
    };
  }

  // 2. If target had a specific href, it must match
  if (expected.href && currFingerprint.href && currFingerprint.href !== expected.href) {
    return {
      matched: false,
      reason: `Link destination changed from "${expected.href}" to "${currFingerprint.href}"`,
    };
  }

  // 3. If target had a data-nim-id, verify consistency
  if (expected.nimId && currFingerprint.nimId && currFingerprint.nimId !== expected.nimId) {
    return {
      matched: false,
      reason: `Element ID changed from [${expected.nimId}] to [${currFingerprint.nimId}]`,
    };
  }

  // 4. Text matching
  if (expected.normalizedText && currFingerprint.normalizedText) {
    if (currFingerprint.normalizedText !== expected.normalizedText) {
      return {
        matched: false,
        reason: `Content shifted: expected "${expected.normalizedText}", found "${currFingerprint.normalizedText}"`,
      };
    }
  }

  // 5. Aria-label matching
  if (expected.ariaLabel && currFingerprint.ariaLabel) {
    if (currFingerprint.ariaLabel !== expected.ariaLabel) {
      return {
        matched: false,
        reason: `Aria-label changed: expected "${expected.ariaLabel}", found "${currFingerprint.ariaLabel}"`,
      };
    }
  }

  return { matched: true };
}
