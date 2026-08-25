import { describe, it, expect, beforeEach } from 'vitest';
import { checkBudget, recordUsage, resetTaskCounters } from './cost-guard';

describe('Cost Guard Budget Enforcement', () => {
  beforeEach(async () => {
    await resetTaskCounters();
  });

  it('allows calls within the token budget', async () => {
    const check = await checkBudget(1000, 0.5, {
      perTaskTokens: 5000,
      perDayTokens: 20000,
      perDayUsd: 2.0,
    });
    expect(check.allowed).toBe(true);
  });

  it('blocks calls that exceed the per-task token limit', async () => {
    await recordUsage(4500, 0.01);
    const check = await checkBudget(1000, 0.5, {
      perTaskTokens: 5000,
      perDayTokens: 20000,
      perDayUsd: 2.0,
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Per-task token limit');
  });

  it('blocks calls that exceed the daily USD limit', async () => {
    await recordUsage(1000, 2.5); // exceed $2.00
    const check = await checkBudget(100, 0.5, {
      perTaskTokens: 50000,
      perDayTokens: 200000,
      perDayUsd: 2.0,
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Daily cost limit');
  });
});
