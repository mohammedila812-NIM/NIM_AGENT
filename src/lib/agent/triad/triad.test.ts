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
