import { describe, it, expect, beforeEach } from 'vitest';
import {
  publishFinding,
  getFindings,
  signalGoalSatisfied,
  isGoalSatisfied,
  clearBlackboard,
} from './blackboard';

describe('Inter-Agent Blackboard', () => {
  const groupId = 'test-group-1';

  beforeEach(() => {
    clearBlackboard(groupId);
  });

  it('publishes and retrieves findings across sub-agents', () => {
    publishFinding(groupId, {
      sourceWorker: 'Amazon Worker',
      sourceUrl: 'https://amazon.com/item/1',
      key: 'price',
      value: '$299',
    });

    publishFinding(groupId, {
      sourceWorker: 'BestBuy Worker',
      sourceUrl: 'https://bestbuy.com/item/1',
      key: 'price',
      value: '$289',
    });

    const findings = getFindings(groupId);
    expect(findings).toHaveLength(2);
    expect(findings[0].sourceWorker).toBe('Amazon Worker');
    expect(findings[1].value).toBe('$289');
  });

  it('signals goal satisfied for early sibling exit', () => {
    expect(isGoalSatisfied(groupId).satisfied).toBe(false);

    signalGoalSatisfied(groupId, 'Found RTX 4090 in stock for $1599');

    const status = isGoalSatisfied(groupId);
    expect(status.satisfied).toBe(true);
    expect(status.summary).toContain('Found RTX 4090');
  });

  it('clears blackboard on task cleanup', () => {
    publishFinding(groupId, {
      sourceWorker: 'W1',
      sourceUrl: 'https://example.com',
      key: 'k',
      value: 'v',
    });
    expect(getFindings(groupId)).toHaveLength(1);

    clearBlackboard(groupId);
    expect(getFindings(groupId)).toHaveLength(0);
  });
});
