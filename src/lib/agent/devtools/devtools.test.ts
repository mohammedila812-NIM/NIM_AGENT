import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isMethodAllowedForTier,
  isForbiddenCDPMethod,
  isDevToolsBlockedUrl,
  FORBIDDEN_CDP_PATTERNS,
  getDevToolsSessionTier,
  setDevToolsSessionTier,
} from './policy';
import { cdpSession, computePayloadHash } from './cdp-session';
import { inspectElement, editElement, runInPage, trustedType, undoDevToolsEdit } from './tools';
import * as fs from 'fs';
import * as path from 'path';

describe('Chrome DevTools Protocol (CDP) Security & Architecture Test Suite', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await cdpSession.detachAll('Test reset');
  });

  // ── 1. Allowlist per Tier ──────────────────────────────────────────────────
  describe('Capability Tiers Allowlist', () => {
    it('T0 permits read-only DOM and console inspection but denies storage bodies and writes', () => {
      expect(isMethodAllowedForTier('DOM.enable', 'T0')).toBe(true);
      expect(isMethodAllowedForTier('DOM.disable', 'T0')).toBe(true);
      expect(isMethodAllowedForTier('DOM.getDocument', 'T0')).toBe(true);
      expect(isMethodAllowedForTier('CSS.enable', 'T0')).toBe(true);
      expect(isMethodAllowedForTier('CSS.disable', 'T0')).toBe(true);
      expect(isMethodAllowedForTier('CSS.getMatchedStylesForNode', 'T0')).toBe(true);
      expect(isMethodAllowedForTier('Console.enable', 'T0')).toBe(true);
      expect(isMethodAllowedForTier('Accessibility.enable', 'T0')).toBe(true);
      expect(isMethodAllowedForTier('Accessibility.getFullAXTree', 'T0')).toBe(true);

      // T1 method forbidden in T0
      expect(isMethodAllowedForTier('Network.getResponseBody', 'T0')).toBe(false);
      expect(isMethodAllowedForTier('DOMStorage.getDOMStorageItems', 'T0')).toBe(false);

      // T2 method forbidden in T0
      expect(isMethodAllowedForTier('DOM.setOuterHTML', 'T0')).toBe(false);
      expect(isMethodAllowedForTier('Debugger.setScriptSource', 'T0')).toBe(false);

      // T3 method forbidden in T0
      expect(isMethodAllowedForTier('Runtime.evaluate', 'T0')).toBe(false);
      expect(isMethodAllowedForTier('Input.dispatchMouseEvent', 'T0')).toBe(false);
    });

    it('T1 permits sensitive storage and response body reads but denies writes', () => {
      expect(isMethodAllowedForTier('DOM.getDocument', 'T1')).toBe(true);
      expect(isMethodAllowedForTier('Network.getResponseBody', 'T1')).toBe(true);
      expect(isMethodAllowedForTier('DOMStorage.getDOMStorageItems', 'T1')).toBe(true);

      expect(isMethodAllowedForTier('DOM.setOuterHTML', 'T1')).toBe(false);
      expect(isMethodAllowedForTier('Runtime.evaluate', 'T1')).toBe(false);
    });

    it('T2 permits DOM/CSS/Script edits but denies execution & input dispatching', () => {
      expect(isMethodAllowedForTier('DOM.setOuterHTML', 'T2')).toBe(true);
      expect(isMethodAllowedForTier('CSS.setStyleTexts', 'T2')).toBe(true);
      expect(isMethodAllowedForTier('Debugger.setScriptSource', 'T2')).toBe(true);
      expect(isMethodAllowedForTier('Fetch.enable', 'T2')).toBe(true);

      expect(isMethodAllowedForTier('Runtime.evaluate', 'T2')).toBe(false);
      expect(isMethodAllowedForTier('Input.dispatchMouseEvent', 'T2')).toBe(false);
    });

    it('T3 permits runtime evaluation and input events', () => {
      expect(isMethodAllowedForTier('Runtime.evaluate', 'T3')).toBe(true);
      expect(isMethodAllowedForTier('Input.dispatchMouseEvent', 'T3')).toBe(true);
      expect(isMethodAllowedForTier('Input.insertText', 'T3')).toBe(true);
    });

    it('elevates tab session tier up to configured ceiling when a tool requests a higher tier', async () => {
      await chrome.storage.local.set({ devtoolsMaxTier: 'T2' });
      await setDevToolsSessionTier(99, 'T0');

      const res = await cdpSession.send(99, 'CSS.setStyleTexts', { edits: [] }, { tier: 'T2', skipHitl: true });
      expect(res.error).toBeUndefined();
      const updatedTier = await getDevToolsSessionTier(99);
      expect(updatedTier).toBe('T2');
    });

    it('does not elevate tab session tier if requested tier exceeds configured ceiling', async () => {
      await chrome.storage.local.set({ devtoolsMaxTier: 'T1' });
      await setDevToolsSessionTier(98, 'T0');

      const res = await cdpSession.send(98, 'DOM.setOuterHTML', { nodeId: 1, outerHTML: '<div/>' }, { tier: 'T2', skipHitl: true });
      expect(res.success).toBe(false);
      expect(res.error).toContain('TIER_DENIED');
    });

    it('allows internal read-only evaluation with skipHitl: true at T0', async () => {
      await setDevToolsSessionTier(97, 'T0');
      const res = await cdpSession.send(97, 'Runtime.evaluate', { expression: '1+1' }, { tier: 'T0', skipHitl: true });
      expect(res.error).toBeUndefined();
    });
  });

  // ── 2. Explicit Denylist of Forbidden CDP Method Families ──────────────────
  describe('Forbidden CDP Method Families (Requirement 3: Negative Tests)', () => {
    it('denies Browser.* family', () => {
      expect(isForbiddenCDPMethod('Browser.getVersion')).toBe(true);
      expect(isForbiddenCDPMethod('Browser.close')).toBe(true);
      expect(isMethodAllowedForTier('Browser.getVersion', 'T3')).toBe(false);
    });

    it('denies Target.* family (multi-tab escape prevention)', () => {
      expect(isForbiddenCDPMethod('Target.createTarget')).toBe(true);
      expect(isForbiddenCDPMethod('Target.attachToTarget')).toBe(true);
      expect(isMethodAllowedForTier('Target.createTarget', 'T3')).toBe(false);
    });

    it('denies Storage.getCookies and Network.getAllCookies (cookie dump block)', () => {
      expect(isForbiddenCDPMethod('Storage.getCookies')).toBe(true);
      expect(isForbiddenCDPMethod('Network.getAllCookies')).toBe(true);
      expect(isMethodAllowedForTier('Storage.getCookies', 'T3')).toBe(false);
    });

    it('denies Security.* family', () => {
      expect(isForbiddenCDPMethod('Security.enable')).toBe(true);
      expect(isForbiddenCDPMethod('Security.setIgnoreCertificateErrors')).toBe(true);
      expect(isMethodAllowedForTier('Security.setIgnoreCertificateErrors', 'T3')).toBe(false);
    });

    it('denies Page.setDownloadBehavior', () => {
      expect(isForbiddenCDPMethod('Page.setDownloadBehavior')).toBe(true);
      expect(isMethodAllowedForTier('Page.setDownloadBehavior', 'T3')).toBe(false);
    });

    it('denies IO.* family (arbitrary file stream reading)', () => {
      expect(isForbiddenCDPMethod('IO.read')).toBe(true);
      expect(isForbiddenCDPMethod('IO.close')).toBe(true);
      expect(isMethodAllowedForTier('IO.read', 'T3')).toBe(false);
    });

    it('denies SystemInfo.* family', () => {
      expect(isForbiddenCDPMethod('SystemInfo.getInfo')).toBe(true);
      expect(isMethodAllowedForTier('SystemInfo.getInfo', 'T3')).toBe(false);
    });

    it('denies Emulation.* family', () => {
      expect(isForbiddenCDPMethod('Emulation.setDeviceMetricsOverride')).toBe(true);
      expect(isMethodAllowedForTier('Emulation.setDeviceMetricsOverride', 'T3')).toBe(false);
    });
  });

  // ── 3. Domain Blocklist & Lookalikes ─────────────────────────────────────────
  describe('Domain Blocklist & Lookalike Gate (Requirement 4)', () => {
    it('blocks banking, webmail, and auth domains', () => {
      expect(isDevToolsBlockedUrl('https://chase.com/account').blocked).toBe(true);
      expect(isDevToolsBlockedUrl('https://mail.google.com/mail/u/0').blocked).toBe(true);
      expect(isDevToolsBlockedUrl('https://web.whatsapp.com').blocked).toBe(true);
      expect(isDevToolsBlockedUrl('https://paypal.com/signin').blocked).toBe(true);
      expect(isDevToolsBlockedUrl('https://accounts.google.com/signin').blocked).toBe(true);
    });

    it('blocks internal browser schemes (chrome://, chrome-extension://)', () => {
      expect(isDevToolsBlockedUrl('chrome://settings').blocked).toBe(true);
      expect(isDevToolsBlockedUrl('chrome-extension://abcdef/options.html').blocked).toBe(true);
      expect(isDevToolsBlockedUrl('about:blank').blocked).toBe(true);
    });

    it('handles lookalike hosts correctly (subdomain vs malicious lookalike suffix)', () => {
      // Subdomain of blocked domain is BLOCKED
      expect(isDevToolsBlockedUrl('https://sub.chase.com/login').blocked).toBe(true);

      // Malicious lookalike where blocked domain is just a prefix is NOT matching chase.com suffix,
      // but if user or heuristic adds it, it will block. Here chase.com.evil.io host is evil.io!
      const checkEvil = isDevToolsBlockedUrl('https://chase.com.evil.io');
      expect(checkEvil.blocked).toBe(false); // evil.io is not chase.com

      // Lookalike string containing name is not the real domain
      const checkInstaFake = isDevToolsBlockedUrl('https://evil-instagram.com');
      expect(checkInstaFake.blocked).toBe(false);
    });

    it('fails closed on invalid URLs', () => {
      expect(isDevToolsBlockedUrl('').blocked).toBe(true);
      expect(isDevToolsBlockedUrl('not a url at all').blocked).toBe(true);
    });
  });

  // ── 4. HITL Hash Binding & TOCTOU Integrity ─────────────────────────────────
  describe('HITL Payload-Hash Binding & TOCTOU Prevention (Requirement 6)', () => {
    it('computes consistent cryptographic hash for CDP payloads', async () => {
      const payload1 = { method: 'DOM.setOuterHTML', params: { nodeId: 42, outerHTML: '<div>Safe</div>' } };
      const hash1 = await computePayloadHash(payload1);
      const hash2 = await computePayloadHash(payload1);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 hex length
    });

    it('detects payload shift and aborts execution when hash mismatch occurs', async () => {
      const originalPayload = { method: 'DOM.setOuterHTML', params: { nodeId: 42, outerHTML: '<div>Safe</div>' } };
      const originalHash = await computePayloadHash(originalPayload);

      // Attacker altered payload to inject script
      const alteredParams = { nodeId: 42, outerHTML: '<script>exfiltrate()</script>' };

      const res = await cdpSession.send(1, 'DOM.setOuterHTML', alteredParams, {
        tier: 'T2',
        expectedPayloadHash: originalHash,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('HITL_HASH_MISMATCH');
    });

    it('denies action when HITL callback declines or times out', async () => {
      const res = await cdpSession.send(1, 'DOM.setOuterHTML', { nodeId: 42, outerHTML: '<b>test</b>' }, {
        tier: 'T2',
        onHITLRequired: async () => false, // User clicked Decline
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('HITL_DENIED');
    });
  });

  // ── 5. Autonomous Context Restriction ──────────────────────────────────────
  describe('Autonomous-Context Safety (Requirement 7)', () => {
    it('allows autonomous tasks to inspect elements at T0', async () => {
      const res = await inspectElement({ tabId: 1, isAutonomous: true }, { selector: 'body' });
      expect(res).not.toContain('AUTONOMOUS_RESTRICTION');
    });

    it('strictly forbids autonomous tasks from executing T2 writes', async () => {
      const res = await editElement({ tabId: 1, isAutonomous: true }, { selector: 'h1', outerHTML: '<h1>Hacked</h1>' });
      expect(res).toContain('AUTONOMOUS_RESTRICTION');
      expect(res).toContain('strictly confined to DevTools Tier 0');
    });

    it('strictly forbids autonomous tasks from executing T3 code execution', async () => {
      const res = await runInPage({ tabId: 1, isAutonomous: true }, { expression: 'document.cookie' });
      expect(res).toContain('AUTONOMOUS_RESTRICTION');
      expect(res).toContain('strictly confined to DevTools Tier 0');
    });
  });

  // ── 6. Sensitive Field Refusal in Trusted Input ─────────────────────────────
  describe('Trusted Input Safety (Requirement 11)', () => {
    it('refuses to type into password or credential fields', async () => {
      const res = await trustedType({ tabId: 1 }, { text: 'mySecretPassword123', fieldName: 'user_password' });
      expect(res).toContain('SECURITY_BLOCKED');
      expect(res).toContain('Refusing to auto-type into a sensitive credential');
    });
  });

  // ── 7. Undo Snapshots & Restoration ─────────────────────────────────────────
  describe('Undo State Tracking (Requirement 9)', () => {
    it('pushes and restores undo snapshots in reverse order', async () => {
      cdpSession.pushUndoSnapshot({
        id: '1',
        tabId: 1,
        timestamp: Date.now(),
        type: 'html',
        target: '#button',
        previousValue: '<button>Old</button>',
        method: 'DOM.setOuterHTML',
      });

      const popped = cdpSession.popUndoSnapshot(1);
      expect(popped).toBeDefined();
      expect(popped?.previousValue).toBe('<button>Old</button>');

      // No more undo snapshots
      expect(cdpSession.popUndoSnapshot(1)).toBeUndefined();
    });
  });

  // ── 8. Rate Limiting ────────────────────────────────────────────────────────
  describe('Rate Limiter (Requirement 3c)', () => {
    it('blocks rapid commands exceeding 60 per minute', async () => {
      // Send 60 successful commands
      for (let i = 0; i < 60; i++) {
        await cdpSession.send(1, 'DOM.getDocument', {}, { tier: 'T0', skipHitl: true });
      }
      // The 61st command must hit rate limit
      const limitHit = await cdpSession.send(1, 'DOM.getDocument', {}, { tier: 'T0', skipHitl: true });
      expect(limitHit.success).toBe(false);
      expect(limitHit.error).toContain('RATE_LIMIT_EXCEEDED');
    });
  });

  // ── 9. Architecture Invariant: No other module calls chrome.debugger ───────
  describe('Architectural Invariant: Single Chokepoint (Requirement 13)', () => {
    it('proves that no file in src/ calls chrome.debugger except cdp-session.ts and test mocks', () => {
      const srcDir = path.resolve(__dirname, '../../../..');
      const violations: string[] = [];

      function checkDir(dir: string) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            if (file === 'node_modules' || file === '.git' || file === '.output' || file === '.wxt') continue;
            checkDir(fullPath);
          } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js')) {
            // Exclude cdp-session.ts, devtools.test.ts, and test-setup.ts
            const normalized = fullPath.replace(/\\/g, '/');
            if (
              normalized.endsWith('devtools/cdp-session.ts') ||
              normalized.endsWith('devtools/devtools.test.ts') ||
              normalized.endsWith('test-setup.ts')
            ) {
              continue;
            }

            const content = fs.readFileSync(fullPath, 'utf-8');
            if (/chrome\.debugger\b/.test(content)) {
              violations.push(normalized);
            }
          }
        }
      }

      checkDir(srcDir);
      expect(violations).toEqual([]);
    });
  });
});
