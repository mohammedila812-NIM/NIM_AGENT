/**
 * Shared Security Redaction Helper
 *
 * Sanitizes sensitive credentials, JWTs, Authorization headers, Cookies,
 * URL tokens, passwords, and sensitive storage keys BEFORE data reaches
 * LLMs, specialist sub-agents, or logs.
 */

// ── Patterns ─────────────────────────────────────────────────────────────────

// JWT regex: header.payload.signature where header begins with eyJ (base64 encoded JSON)
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

// Sensitive URL query params
const SENSITIVE_PARAM_NAMES = [
  'api_key',
  'apikey',
  'token',
  'access_token',
  'auth',
  'authorization',
  'secret',
  'client_secret',
  'password',
  'id_token',
  'session',
  'session_id',
  'code',
  'refresh_token',
];

const URL_PARAM_PATTERN = new RegExp(
  `([?&](?:${SENSITIVE_PARAM_NAMES.join('|')})=)([^&\\s#]+)`,
  'gi',
);

// Header patterns in raw text (e.g. HTTP headers or console logs)
const AUTH_HEADER_PATTERN = /(authorization:\s*)(?:bearer|basic|token)?\s*([^\r\n,]+)/gi;
const COOKIE_HEADER_PATTERN = /(cookie:\s*)([^\r\n]+)/gi;
const SET_COOKIE_HEADER_PATTERN = /(set-cookie:\s*)([^\r\n]+)/gi;

// Sensitive JSON / key-value assignments
const SENSITIVE_KV_PATTERN = new RegExp(
  `(["']?(?:password|passcode|secret|api_?key|access_?token|auth_?token|private_?key)["']?\\s*[:=]\\s*["'])([^"'\r\n]+)(["'])`,
  'gi',
);

// Storage & URL query key patterns that hold tokens or secrets
const SENSITIVE_KEY_PATTERN = /token|auth|session|secret|credential|password|jwt|private|key/i;

// ── Public Redaction Helpers ─────────────────────────────────────────────────

/**
 * Redacts sensitive tokens, headers, JWTs, and passwords from raw strings.
 */
export function redactString(text: string): string {
  if (!text) return '';

  let out = text;

  // 1. Redact JWTs
  out = out.replace(JWT_PATTERN, '[REDACTED_JWT]');

  // 2. Redact Authorization headers
  out = out.replace(AUTH_HEADER_PATTERN, '$1[REDACTED_AUTH]');

  // 3. Redact Cookie / Set-Cookie headers
  out = out.replace(COOKIE_HEADER_PATTERN, '$1[REDACTED_COOKIE]');
  out = out.replace(SET_COOKIE_HEADER_PATTERN, '$1[REDACTED_SET_COOKIE]');

  // 4. Redact sensitive URL parameters
  out = out.replace(URL_PARAM_PATTERN, '$1[REDACTED_PARAM]');

  // 5. Redact sensitive key-value pairs (JSON / form data)
  out = out.replace(SENSITIVE_KV_PATTERN, '$1[REDACTED_SENSITIVE]$3');

  return out;
}

/**
 * Sanitizes URLs by redacting sensitive query parameter values.
 */
export function redactUrl(urlStr: string): string {
  if (!urlStr) return '';
  try {
    const url = new URL(urlStr);
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, '[REDACTED_PARAM]');
      }
    }
    return url.toString();
  } catch {
    // Fallback to string regex if not a valid full URL
    return urlStr.replace(URL_PARAM_PATTERN, '$1[REDACTED_PARAM]');
  }
}

/**
 * Redacts sensitive HTTP header maps.
 */
export function redactHeaders(
  headers: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> {
  if (!headers) return {};
  const redacted: Record<string, string | string[]> = {};

  const SENSITIVE_HEADERS = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
    'proxy-authorization',
    'apikey',
  ]);

  for (const [key, val] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lower)) {
      redacted[key] = Array.isArray(val) ? ['[REDACTED_HEADER]'] : '[REDACTED_HEADER]';
    } else {
      if (typeof val === 'string') {
        redacted[key] = redactString(val);
      } else if (Array.isArray(val)) {
        redacted[key] = val.map((v) => redactString(v));
      } else {
        redacted[key] = val;
      }
    }
  }

  return redacted;
}

/**
 * Redacts storage key-value records (localStorage, sessionStorage).
 * If key matches sensitive pattern, value is replaced with [REDACTED_STORAGE].
 * Otherwise values are still scrubbed for embedded JWTs/passwords.
 */
export function redactStorage(
  storageData: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [k, v] of Object.entries(storageData)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      result[k] = '[REDACTED_STORAGE]';
    } else {
      result[k] = redactString(v);
    }
  }

  return result;
}

/**
 * Deeply scrubs any JSON-compatible object or array.
 */
export function redactObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return redactString(obj) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k) && typeof v === 'string') {
        res[k] = '[REDACTED_STORAGE]';
      } else {
        res[k] = redactObject(v);
      }
    }
    return res as T;
  }

  return obj;
}
