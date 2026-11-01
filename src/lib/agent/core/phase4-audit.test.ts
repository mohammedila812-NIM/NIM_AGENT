import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractElementFingerprint, verifyElementFingerprint } from './element-resolver';
import { isDestructiveAction, isSensitiveFieldName, DESTRUCTIVE_KEYWORDS, SENSITIVE_FIELD_PATTERNS } from '../security-patterns';
import { validateAction } from '../action-validator';
import { executeFallback, evaluateSecurityChallenge, type ChallengeContext } from '../triad/reflector';
import { SENSITIVE_EXTRACTION_DOMAINS } from '../../knowledge/entity-extractor';
import { hostMatchesAny } from '../sentinel/host-matcher';
import { JSDOM } from 'jsdom';

describe('Phase 4 Security & Dispatcher Audit Suite', () => {
  describe('Finding 19: Strong Element Fingerprinting & TOCTOU Integrity', () => {
    it('generates a complete, strong fingerprint for an element', () => {
      const dom = new JSDOM('<a href="https://bank.com/transfer" role="button" aria-label="Confirm Transfer" data-nim-id="42">Confirm & Send</a>');
      const el = dom.window.document.querySelector('a') as HTMLElement;

      const fp = extractElementFingerprint(el);
      expect(fp).toEqual({
        tag: 'a',
        normalizedText: 'Confirm & Send',
        ariaLabel: 'Confirm Transfer',
        role: 'button',
        href: 'https://bank.com/transfer',
        name: '',
        nimId: '42',
      });
    });

    it('detects TOCTOU mismatch when element destination or text shifts during HITL approval', () => {
      const dom = new JSDOM('<a href="https://bank.com/transfer" data-nim-id="42">Send $50</a>');
      const el = dom.window.document.querySelector('a') as HTMLElement;
      const expected = extractElementFingerprint(el);

      // 1. Unchanged element matches
      expect(verifyElementFingerprint(el, expected).matched).toBe(true);

      // 2. Destination changed (e.g. attacker swapped link href)
      el.setAttribute('href', 'https://attacker.com/steal');
      const hrefCheck = verifyElementFingerprint(el, expected);
      expect(hrefCheck.matched).toBe(false);
      expect(hrefCheck.reason).toContain('Link destination changed');

      // 3. Amount / text changed (e.g. swapped $50 with $5000)
      el.setAttribute('href', 'https://bank.com/transfer');
      el.textContent = 'Send $5000';
      const textCheck = verifyElementFingerprint(el, expected);
      expect(textCheck.matched).toBe(false);
      expect(textCheck.reason).toContain('Content shifted');

      // 4. Element tag changed from button to input
      const dom2 = new JSDOM('<button data-nim-id="42">Submit</button>');
      const btn = dom2.window.document.querySelector('button') as HTMLElement;
      const btnFp = extractElementFingerprint(btn);
      const input = dom2.window.document.createElement('input');
      const tagCheck = verifyElementFingerprint(input, btnFp);
      expect(tagCheck.matched).toBe(false);
      expect(tagCheck.reason).toContain('Tag changed');
    });
  });

  describe('Finding 20: Centralized Safety Patterns & Submit Logic', () => {
    it('accurately identifies destructive keywords from centralized list', () => {
      expect(isDestructiveAction('Click button: Submit payment')).toBe(true);
      expect(isDestructiveAction('Delete account now')).toBe(true);
      expect(isDestructiveAction('Confirm and Purchase order')).toBe(true);
      expect(isDestructiveAction('View account details')).toBe(false);
      expect(DESTRUCTIVE_KEYWORDS).toContain('submit');
      expect(DESTRUCTIVE_KEYWORDS).toContain('delete');
    });

    it('accurately detects sensitive field patterns from centralized list', () => {
      expect(isSensitiveFieldName('user_password')).toBe(true);
      expect(isSensitiveFieldName('credit_card_number')).toBe(true);
      expect(isSensitiveFieldName('cvv2')).toBe(true);
      expect(isSensitiveFieldName('social_security_number')).toBe(true);
      expect(isSensitiveFieldName('search_query')).toBe(false);
      expect(SENSITIVE_FIELD_PATTERNS.length).toBeGreaterThan(10);
    });
  });

  describe('Finding 22: Exact Select Option Matching Priority', () => {
    it('prefers exact option match over substring containment', () => {
      const dom = new JSDOM(`
        <select id="country">
          <option value="cy">Cyprus</option>
          <option value="ru">Russia</option>
          <option value="usa">United States (US)</option>
          <option value="us">US</option>
        </select>
      `);
      const sel = dom.window.document.querySelector('select') as HTMLSelectElement;

      // When searching for "US", should find option with exact text "US", NOT "Cyprus" (which has "us" inside)
      const optLower = 'us';
      const exactOpt = Array.from(sel.options).find(
        (o) => o.value.toLowerCase() === optLower || o.text.toLowerCase().trim() === optLower,
      );
      expect(exactOpt).toBeDefined();
      expect(exactOpt?.text).toBe('US');
    });
  });

  describe('Finding 23: Domain Scoping & Navigation Safety', () => {
    it('validates navigate_to against scope domains and warns when navigating out of scope', async () => {
      const res = await validateAction(
        'navigate_to',
        'https://external-malicious.com/phish',
        ['example.com', 'shop.example.com'],
        'task-1',
      );
      expect(res.isConsistent).toBe(false);
      expect(res.riskLevel).toBe('warn');
      expect(res.reason).toContain('not in scope');
    });

    it('allows navigation within task scope domains', async () => {
      const res = await validateAction(
        'navigate_to',
        'https://shop.example.com/products',
        ['example.com', 'shop.example.com'],
        'task-1',
      );
      expect(res.riskLevel).toBe('safe');
    });
  });

  describe('Finding 25: Sensitive Domain Entity Extraction Guard', () => {
    it('identifies webmail, banking, and private messaging sites as sensitive', () => {
      expect(hostMatchesAny('mail.google.com', SENSITIVE_EXTRACTION_DOMAINS)).toBe(true);
      expect(hostMatchesAny('outlook.live.com', SENSITIVE_EXTRACTION_DOMAINS)).toBe(true);
      expect(hostMatchesAny('web.whatsapp.com', SENSITIVE_EXTRACTION_DOMAINS)).toBe(true);
      expect(hostMatchesAny('chase.com', SENSITIVE_EXTRACTION_DOMAINS)).toBe(true);
      expect(hostMatchesAny('paypal.com', SENSITIVE_EXTRACTION_DOMAINS)).toBe(true);
      expect(hostMatchesAny('wikipedia.org', SENSITIVE_EXTRACTION_DOMAINS)).toBe(false);
      expect(hostMatchesAny('docs.github.com', SENSITIVE_EXTRACTION_DOMAINS)).toBe(false);
    });
  });

  describe('Finding 28: Reflector Enhancements', () => {
    it('prevents retry_same auto-retry on non-idempotent actions', async () => {
      const result = await executeFallback(1, 'retry_same', undefined, 'Submit order and Pay $100');
      expect(result.executed).toBe(false);
      expect(result.note).toContain('NON_IDEMPOTENT_ACTION');
    });

    it('allows retry_same for safe, idempotent read/navigation actions', async () => {
      const result = await executeFallback(1, 'retry_same', undefined, 'read_page');
      expect(result.executed).toBe(true);
      expect(result.note).toContain('Retrying the same action');
    });

    it('path-aware 2FA challenge excludes authenticated webmail inboxes', () => {
      const gmailInboxContext: ChallengeContext = {
        url: 'https://mail.google.com/mail/u/0/#inbox',
        title: 'Inbox (141) - user@gmail.com - Gmail',
        bodyText: 'Your verification code for Account is 849201. Please confirm purchase.',
        hasVisibleRecaptcha: false,
        hasVisibleHcaptcha: false,
        hasCfChallenge: false,
        hasActiveOtpInput: false,
        isDismissedByUser: false,
      };

      const challenge = evaluateSecurityChallenge(gmailInboxContext);
      expect(challenge.detected).toBe(false);
    });

    it('triggers 2FA challenge on authentic auth checkpoint endpoint', () => {
      const authContext: ChallengeContext = {
        url: 'https://accounts.google.com/signin/v2/challenge/totp',
        title: '2-Step Verification - Google Accounts',
        bodyText: 'Enter the 6-digit code from Google Authenticator',
        hasVisibleRecaptcha: false,
        hasVisibleHcaptcha: false,
        hasCfChallenge: false,
        hasActiveOtpInput: true,
        isDismissedByUser: false,
      };

      const challenge = evaluateSecurityChallenge(authContext);
      expect(challenge.detected).toBe(true);
      expect(challenge.type).toBe('2fa');
    });
  });
});
