import { describe, it, expect } from 'vitest';
import { normalizeNavigationUrl } from './navigator';

describe('Safe Navigator — URL Normalization & Protocol Security', () => {
  it('automatically prepends https:// to bare domain names', () => {
    expect(normalizeNavigationUrl('google.com')).toBe('https://google.com/');
    expect(normalizeNavigationUrl('amazon.com/dp/B09V3HN1KC')).toBe('https://amazon.com/dp/B09V3HN1KC');
    expect(normalizeNavigationUrl('subdomain.example.org/path?q=test#hash')).toBe('https://subdomain.example.org/path?q=test#hash');
  });

  it('preserves valid http and https URLs untouched', () => {
    expect(normalizeNavigationUrl('https://github.com/trending')).toBe('https://github.com/trending');
    expect(normalizeNavigationUrl('http://localhost:3000/dashboard')).toBe('http://localhost:3000/dashboard');
  });

  it('blocks dangerous javascript: and data: schemes for prompt injection defense', () => {
    expect(() => normalizeNavigationUrl('javascript:alert(1)')).toThrow('SECURITY_BLOCKED');
    expect(() => normalizeNavigationUrl('javascript://alert(document.cookie)')).toThrow('SECURITY_BLOCKED');
    expect(() => normalizeNavigationUrl('data:text/html,<script>alert(1)</script>')).toThrow('SECURITY_BLOCKED');
    expect(() => normalizeNavigationUrl('file:///etc/passwd')).toThrow('SECURITY_BLOCKED');
  });

  it('trims whitespace and rejects completely invalid URLs', () => {
    expect(normalizeNavigationUrl('   https://news.ycombinator.com   ')).toBe('https://news.ycombinator.com/');
    expect(() => normalizeNavigationUrl('')).toThrow('Invalid navigation URL');
  });
});
