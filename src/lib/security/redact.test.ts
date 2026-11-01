import { describe, it, expect } from 'vitest';
import {
  redactString,
  redactUrl,
  redactHeaders,
  redactStorage,
  redactObject,
} from './redact';

describe('Security Redaction Helper (redact.ts)', () => {
  it('redacts JWT tokens from text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const text = `User session token: ${jwt} received.`;
    const sanitized = redactString(text);
    expect(sanitized).not.toContain(jwt);
    expect(sanitized).toContain('[REDACTED_JWT]');
  });

  it('redacts Authorization and Cookie headers from text', () => {
    const text = 'Authorization: Bearer my-secret-api-token-xyz\nCookie: session_id=abc123456; theme=dark';
    const sanitized = redactString(text);
    expect(sanitized).toContain('Authorization: [REDACTED_AUTH]');
    expect(sanitized).toContain('Cookie: [REDACTED_COOKIE]');
    expect(sanitized).not.toContain('my-secret-api-token-xyz');
    expect(sanitized).not.toContain('session_id=abc123456');
  });

  it('redacts sensitive query params in URLs', () => {
    const url = 'https://api.example.com/v1/data?api_key=secret999&user=alice&token=xyz789';
    const sanitized = redactUrl(url);
    expect(sanitized).not.toContain('secret999');
    expect(sanitized).not.toContain('xyz789');
    expect(sanitized).toContain('api_key=%5BREDACTED_PARAM%5D');
    expect(sanitized).toContain('user=alice');
  });

  it('redacts headers map', () => {
    const headers = {
      'content-type': 'application/json',
      'authorization': 'Bearer secret-key',
      'cookie': 'uid=100; sid=xyz',
      'x-custom': 'public-info',
    };
    const redacted = redactHeaders(headers);
    expect(redacted['content-type']).toBe('application/json');
    expect(redacted['authorization']).toBe('[REDACTED_HEADER]');
    expect(redacted['cookie']).toBe('[REDACTED_HEADER]');
    expect(redacted['x-custom']).toBe('public-info');
  });

  it('redacts storage key-values based on sensitive keys', () => {
    const storage = {
      user_id: '12345',
      auth_token: 'super-secret-auth-value',
      session_jwt: 'session-val',
      theme_preference: 'dark',
    };
    const redacted = redactStorage(storage);
    expect(redacted.user_id).toBe('12345');
    expect(redacted.auth_token).toBe('[REDACTED_STORAGE]');
    expect(redacted.session_jwt).toBe('[REDACTED_STORAGE]');
    expect(redacted.theme_preference).toBe('dark');
  });

  it('deeply scrubs objects containing nested secrets and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const obj = {
      meta: {
        page: 1,
        authToken: 'token123',
      },
      records: [
        { id: 1, desc: `Bearer ${jwt}` },
      ],
    };
    const cleaned = redactObject(obj) as typeof obj;
    expect(cleaned.meta.authToken).toBe('[REDACTED_STORAGE]');
    expect(cleaned.records[0].desc).toContain('[REDACTED_JWT]');
  });
});
