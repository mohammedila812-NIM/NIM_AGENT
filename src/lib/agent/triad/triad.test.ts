/**
 * Phase 2 Triad — Unit Tests
 * Tests the Planner helpers, Validator delta logic, and Reflector fallback chooser.
 * All tests run in jsdom (no real chrome APIs needed for the pure functions).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  planMilestones,
  getActiveMilestone,
  completeMilestone,
  failMilestone,
  advanceMilestone,
  isChecklistComplete,
  renderChecklist,
  type MilestoneChecklist,
} from './planner';
import {
  computeSnapshotDelta,
  chooseFallback,
  describeFallback,
  type PageSnapshot,
} from './validator';
import {
  evaluateSecurityChallenge,
  type ChallengeContext,
} from './reflector';

// ─── Planner Tests ────────────────────────────────────────────────────────────

describe('Planner', () => {
  const makeChecklist = (): MilestoneChecklist => ({
    taskSummary: 'Search Amazon for headphones',
    milestones: [
      { id: 'm1', label: 'Navigate to Amazon', status: 'pending' },
      { id: 'm2', label: 'Search for headphones', status: 'pending' },
      { id: 'm3', label: 'Extract top 5 prices', status: 'pending' },
    ],
    createdAt: Date.now(),
  });

  it('getActiveMilestone returns first pending milestone', () => {
    const cl = makeChecklist();
    const active = getActiveMilestone(cl);
    expect(active?.id).toBe('m1');
  });

  it('completeMilestone marks status=done and records evidence', () => {
    const cl = makeChecklist();
    completeMilestone(cl, 'm1', 'URL changed to https://amazon.com');
    expect(cl.milestones[0].status).toBe('done');
    expect(cl.milestones[0].evidence).toContain('amazon.com');
  });

  it('failMilestone records reason and marks status=failed', () => {
    const cl = makeChecklist();
    failMilestone(cl, 'm2', 'Search box not found after 3 retries');
    expect(cl.milestones[1].status).toBe('failed');
    expect(cl.milestones[1].failReason).toContain('Search box');
  });

  it('advanceMilestone activates next pending item', () => {
    const cl = makeChecklist();
    completeMilestone(cl, 'm1');
    const next = advanceMilestone(cl);
    expect(next?.id).toBe('m2');
    expect(next?.status).toBe('active');
  });

  it('isChecklistComplete returns true only when all done/failed', () => {
    const cl = makeChecklist();
    expect(isChecklistComplete(cl)).toBe(false);
    completeMilestone(cl, 'm1');
    completeMilestone(cl, 'm2');
    completeMilestone(cl, 'm3');
    expect(isChecklistComplete(cl)).toBe(true);
  });

  it('renderChecklist produces markdown with icons', () => {
    const cl = makeChecklist();
    completeMilestone(cl, 'm1', 'amazon.com loaded');
    const md = renderChecklist(cl);
    expect(md).toContain('✅');
    expect(md).toContain('⬜');
    expect(md).toContain('amazon.com loaded');
  });
});

// ─── Validator Tests ──────────────────────────────────────────────────────────

describe('Validator — Snapshot Delta', () => {
  const snap = (url: string, title: string, fp: string): PageSnapshot => ({
    url, title, domFingerprint: fp, capturedAt: new Date().toISOString(),
  });

  it('detects URL change', () => {
    const delta = computeSnapshotDelta(
      snap('https://a.com', 'A', 'fp1'),
      snap('https://b.com', 'B', 'fp1'),
    );
    expect(delta.urlChanged).toBe(true);
    expect(delta.domChanged).toBe(false);
  });

  it('detects DOM-only change', () => {
    const delta = computeSnapshotDelta(
      snap('https://a.com', 'A', 'fp1'),
      snap('https://a.com', 'A', 'fp2'),
    );
    expect(delta.urlChanged).toBe(false);
    expect(delta.domChanged).toBe(true);
  });

  it('detects unchanged state', () => {
    const delta = computeSnapshotDelta(
      snap('https://a.com', 'A', 'fp1'),
      snap('https://a.com', 'A', 'fp1'),
    );
    expect(delta.urlChanged).toBe(false);
    expect(delta.domChanged).toBe(false);
    expect(delta.titleChanged).toBe(false);
  });
});

describe('Validator — Fallback Chooser', () => {
  it('suggests press_enter for search/input actions', () => {
    expect(chooseFallback('type the search query into the search input')).toBe('press_enter');
  });

  it('suggests dismiss_modal for modal-related actions', () => {
    expect(chooseFallback('close the cookie consent modal')).toBe('dismiss_modal');
  });

  it('suggests scroll_to_element for out-of-viewport actions', () => {
    expect(chooseFallback('click button below the fold')).toBe('scroll_to_element');
  });

  it('defaults to visual_coordinate_click for unknown actions', () => {
    expect(chooseFallback('activate the purple widget')).toBe('visual_coordinate_click');
  });

  it('describeFallback returns non-empty string for all strategies', () => {
    const strategies = ['press_enter', 'scroll_to_element', 'dismiss_modal', 'visual_coordinate_click', 'retry_same'] as const;
    for (const s of strategies) {
      expect(describeFallback(s).length).toBeGreaterThan(10);
    }
  });
});

// ─── Planner LLM fallback (mock) ─────────────────────────────────────────────

describe('Planner — LLM parse fallback', () => {
  it('falls back to single milestone if JSON is malformed', async () => {
    // Mock chatCompletion to return garbage
    vi.mock('../../llm/client', () => ({
      chatCompletion: vi.fn().mockResolvedValue({ content: 'not valid json at all' }),
    }));

    const { planMilestones: plan } = await import('./planner');
    const cl = await plan(
      'Do something complex',
      { apiKey: 'test', provider: 'openai' } as never,
      { id: 'gpt-4o' } as never,
    );
    expect(cl.milestones.length).toBeGreaterThanOrEqual(1);
    expect(cl.milestones[0].status).toBe('pending');
  });
});

// ─── Security Challenge Evaluator (Anti-False-Positive Suite) ────────────────

describe('Security Challenge — False-Positive Immunity', () => {
  const baseGmailCtx: ChallengeContext = {
    url: 'https://mail.google.com/mail/u/0/#inbox',
    title: 'Inbox (141) - user@gmail.com - Gmail',
    bodyText: 'Google Play Changes to purchase verification settings on Google... Kimi K3.1 Pro Requesty',
    hasVisibleRecaptcha: false,
    hasVisibleHcaptcha: false,
    hasCfChallenge: false,
    hasActiveOtpInput: false,
    isDismissedByUser: false,
  };

  it('does NOT trigger 2FA on Gmail inbox with purchase verification emails', () => {
    const res = evaluateSecurityChallenge(baseGmailCtx);
    expect(res.detected).toBe(false);
  });

  it('does NOT trigger 2FA on Gmail inbox even when email contains "Your verification code is 123456"', () => {
    const res = evaluateSecurityChallenge({
      ...baseGmailCtx,
      bodyText: 'Your verification code is 492810. Do not share this two-factor authentication code with anyone.',
    });
    expect(res.detected).toBe(false);
  });

  it('does NOT trigger 2FA on Outlook or Yahoo webmail containing OTP / 2FA text', () => {
    const res = evaluateSecurityChallenge({
      ...baseGmailCtx,
      url: 'https://outlook.live.com/mail/0/inbox',
      title: 'Outlook - Inbox',
      bodyText: 'Security Alert: enter the code to verify your authenticator app',
    });
    expect(res.detected).toBe(false);
  });

  it('triggers 2FA when an active OTP input exists on an authentic login challenge page', () => {
    const res = evaluateSecurityChallenge({
      url: 'https://accounts.google.com/signin/v2/challenge/totp',
      title: '2-Step Verification - Google Accounts',
      bodyText: 'Enter the 6-digit code from your authenticator app',
      hasVisibleRecaptcha: false,
      hasVisibleHcaptcha: false,
      hasCfChallenge: false,
      hasActiveOtpInput: true,
      isDismissedByUser: false,
    });
    expect(res.detected).toBe(true);
    expect(res.type).toBe('2fa');
    expect(res.message).toContain('2FA / OTP verification detected');
  });

  it('triggers captcha when visible reCAPTCHA is present', () => {
    const res = evaluateSecurityChallenge({
      ...baseGmailCtx,
      url: 'https://example.com/login',
      hasVisibleRecaptcha: true,
    });
    expect(res.detected).toBe(true);
    expect(res.type).toBe('captcha');
  });

  it('triggers cloudflare challenge when Cloudflare challenge is present', () => {
    const res = evaluateSecurityChallenge({
      ...baseGmailCtx,
      url: 'https://example.com',
      title: 'Just a moment...',
      bodyText: 'Checking your browser before accessing cloudflare...',
      hasCfChallenge: true,
    });
    expect(res.detected).toBe(true);
    expect(res.type).toBe('cloudflare');
  });

  it('returns false when dismissed by user via "Continue (False Alarm)"', () => {
    const res = evaluateSecurityChallenge({
      url: 'https://accounts.google.com/signin/v2/challenge/totp',
      title: '2-Step Verification',
      bodyText: 'Enter the code',
      hasVisibleRecaptcha: false,
      hasVisibleHcaptcha: false,
      hasCfChallenge: false,
      hasActiveOtpInput: true,
      isDismissedByUser: true,
    });
    expect(res.detected).toBe(false);
  });
});
