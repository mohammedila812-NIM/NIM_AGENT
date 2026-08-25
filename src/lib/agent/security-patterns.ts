/**
 * Canonical Security Patterns for NIM Agent
 * Single source of truth for destructive keywords and sensitive field detectors.
 */

export const DESTRUCTIVE_KEYWORDS: readonly string[] = [
  'submit',
  'delete',
  'purchase',
  'buy',
  'send',
  'post',
  'confirm',
  'pay',
  'checkout',
  'remove',
  'transfer',
  'order',
  'subscribe',
] as const;

export const SENSITIVE_FIELD_PATTERNS: readonly RegExp[] = [
  /password/i,
  /passcode/i,
  /secret/i,
  /credit.?card/i,
  /card.?number/i,
  /cvv/i,
  /cvc/i,
  /expir/i,
  /ssn/i,
  /social.?security/i,
  /bank.?account/i,
  /routing.?number/i,
  /iban/i,
  /account.?number/i,
  /otp/i,
  /2fa/i,
  /two.?factor/i,
  /auth.?code/i,
  /pin/i,
] as const;

/** Checks if a field name, ID, placeholder, type or aria label indicates a sensitive input. */
export function isSensitiveFieldName(fieldStr: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((p) => p.test(fieldStr));
}

/** Checks if an action string or button/link label indicates a destructive action requiring HITL confirmation. */
export function isDestructiveAction(actionStr: string): boolean {
  const lower = actionStr.toLowerCase();
  return DESTRUCTIVE_KEYWORDS.some((d) => lower.includes(d));
}
