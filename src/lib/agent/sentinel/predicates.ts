/**
 * Sentinel Structured Predicate Evaluator (Zero-Token In-Page Engine)
 *
 * Supports structured condition expressions:
 * - "contains: <substring>"
 * - "regex: <pattern>"
 * - "appears" / "disappears"
 * - Numeric operators: "< 200", "> 50", "<= 99.99", ">= 10", "== 0", "!= 0"
 * - Fallback: case-insensitive phrase matching
 */

/** Extracts first numeric value after stripping currencies ($€£¥₹) and commas */
export function parseNumericValue(text: string): number | null {
  if (!text) return null;
  // Match number token after stripping currencies and thousand-separators
  const cleaned = text.replace(/[$€£¥₹]/g, '').replace(/,/g, '');
  const match = cleaned.match(/[-+]?\d*\.?\d+/);
  if (!match) return null;
  const val = parseFloat(match[0]);
  return isNaN(val) ? null : val;
}

/** 32-bit fast string hash (DJB2) */
export function fastStringHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return (hash >>> 0).toString(16);
}

/** Strips relative timestamps, times, and presence indicators from chat messages */
export function cleanMessagingSnippet(text: string): string {
  if (!text) return '';
  return text
    // 1. Multi-word relative times first (e.g. "10 mins ago", "2 hours ago")
    .replace(/\b\d+\s*(mins?|minutes?|hours?|hrs?|days?|secs?|seconds?|weeks?|months?|years?)\s*ago\b/gi, '')
    // 2. Timestamp bullets (e.g. "· 1m", "• 5h", "· 2d")
    .replace(/[·•]\s*\d+\s*[smhdwMy]/gi, '')
    .replace(/[·•]\s*(just now|yesterday|today)/gi, '')
    // 3. Standalone relative times with ago (e.g. "10m ago", "1h ago")
    .replace(/\b\d+\s*[smhdw]\s*ago\b/gi, '')
    // 4. Standalone clock times (e.g. "12:34 PM", "9:00am")
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, '')
    // 5. Presence and status indicators
    .replace(/\b(just now|active now|active \d+[smhd] ago|online|typing\.\.\.)\b/gi, '')
    // 6. Trailing bullets or separators
    .replace(/[·•]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PredicateEvaluation {
  matched: boolean;
  reason: string;
}

/**
 * Pure, in-page evaluation of structured condition predicates.
 */
export function evaluateConditionPredicate(
  condition: string,
  currText: string,
  prevText = '',
  elementExists = true,
): PredicateEvaluation {
  const cond = condition.trim();

  // If condition is generic or empty, any change matches
  if (!cond || cond.toLowerCase() === 'any' || cond.toLowerCase() === 'any change') {
    return { matched: true, reason: 'Matched: any change detected.' };
  }

  // 1. "appears" condition
  if (cond.toLowerCase() === 'appears') {
    if (elementExists && prevText === '__NOT_FOUND__') {
      return { matched: true, reason: 'Condition satisfied: target element appeared on page.' };
    }
    return { matched: false, reason: 'Element has not newly appeared.' };
  }

  // 2. "disappears" condition
  if (cond.toLowerCase() === 'disappears') {
    if (!elementExists) {
      return { matched: true, reason: 'Condition satisfied: target element disappeared from page.' };
    }
    return { matched: false, reason: 'Element is still present.' };
  }

  // 3. "contains: <text>"
  if (/^contains:\s*/i.test(cond)) {
    const targetSubstring = cond.replace(/^contains:\s*/i, '').trim().toLowerCase();
    if (currText.toLowerCase().includes(targetSubstring)) {
      return { matched: true, reason: `Condition satisfied: content contains "${targetSubstring}".` };
    }
    return { matched: false, reason: `Content does not contain "${targetSubstring}".` };
  }

  // 4. "regex: <pattern>"
  if (/^regex:\s*/i.test(cond)) {
    const patternStr = cond.replace(/^regex:\s*/i, '').trim();
    try {
      const reg = new RegExp(patternStr, 'i');
      if (reg.test(currText)) {
        return { matched: true, reason: `Condition satisfied: content matched regex /${patternStr}/i.` };
      }
      return { matched: false, reason: `Content does not match regex /${patternStr}/i.` };
    } catch (err) {
      return { matched: false, reason: `Invalid regex pattern: "${patternStr}".` };
    }
  }

  // 5. Numeric comparisons: e.g. "< 200", ">= 99.99", "<= $500", "> 10"
  const numericOpMatch = cond.match(/^([<>!=]=?)\s*[$€£¥₹]?\s*([0-9.,]+)/);
  if (numericOpMatch) {
    const op = numericOpMatch[1];
    const threshold = parseNumericValue(numericOpMatch[2]);
    const currentVal = parseNumericValue(currText);

    if (threshold !== null && currentVal !== null) {
      let isMet = false;
      switch (op) {
        case '<':  isMet = currentVal < threshold; break;
        case '<=': isMet = currentVal <= threshold; break;
        case '>':  isMet = currentVal > threshold; break;
        case '>=': isMet = currentVal >= threshold; break;
        case '==': isMet = Math.abs(currentVal - threshold) < 0.0001; break;
        case '!=': isMet = Math.abs(currentVal - threshold) >= 0.0001; break;
      }
      if (isMet) {
        return {
          matched: true,
          reason: `Condition satisfied: numeric value ${currentVal} meets "${op} ${threshold}".`,
        };
      }
      return {
        matched: false,
        reason: `Numeric value ${currentVal} does not meet "${op} ${threshold}".`,
      };
    }
  }

  // 6. Generic phrase matching fallback
  if (currText.toLowerCase().includes(cond.toLowerCase())) {
    return { matched: true, reason: `Condition satisfied: text matched "${cond}".` };
  }

  return { matched: false, reason: `Text did not match condition: "${cond}".` };
}
