import { describe, it, expect, beforeEach } from 'vitest';
import { executeMacro } from './macro-executor';
import { saveMacro, loadMacro, deleteMacro, listMacros, type Macro } from '../storage/tasks';

describe('Deterministic Macro Executor', () => {
  const testMacro: Macro = {
    macroId: 'test-macro-checkout',
    name: 'Quick Search & Click',
    instruction: 'Search for laptops and click the first result',
    actionSequence: [
      {
        tool: 'navigate_to',
        args: { url: 'https://example.com/search?q=laptop' },
        reasoning: 'Navigate to search page',
      },
      {
        tool: 'wait_for',
        args: { ms: 50 },
        reasoning: 'Wait for results to render',
      },
      {
        tool: 'scroll_page',
        args: { direction: 'down', pixels: 300 },
        reasoning: 'Scroll down to view items',
      },
    ],
    createdAt: Date.now(),
    runCount: 0,
  };

  beforeEach(async () => {
    const all = await listMacros();
    for (const m of all) {
      await deleteMacro(m.macroId);
    }
  });

  it('saves and loads enriched MacroAction sequences with targetLabel', async () => {
    await saveMacro(testMacro);
    const loaded = await loadMacro('test-macro-checkout');
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Quick Search & Click');
    expect(loaded?.actionSequence).toHaveLength(3);
    expect(loaded?.actionSequence[0].tool).toBe('navigate_to');
  });

  it('executes a clean deterministic macro and tracks completed steps', async () => {
    await saveMacro(testMacro);

    const stepStarts: number[] = [];
    const stepCompletes: number[] = [];

    const result = await executeMacro(testMacro, 1, {
      onStepStart: (step) => stepStarts.push(step),
      onStepComplete: (step) => stepCompletes.push(step),
    });

    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(3);
    expect(result.totalSteps).toBe(3);
    expect(result.tokensUsed).toBe(0); // 0 tokens for clean deterministic run!
    expect(stepStarts).toEqual([1, 2, 3]);
    expect(stepCompletes).toEqual([1, 2, 3]);

    // Check that runCount was incremented
    const updated = await loadMacro('test-macro-checkout');
    expect(updated?.runCount).toBe(1);
  });

  it('blocks destructive actions during macro replay via action-validator', async () => {
    const dangerousMacro: Macro = {
      macroId: 'danger-macro',
      name: 'Dangerous Action Macro',
      instruction: 'Delete all user accounts',
      actionSequence: [
        {
          tool: 'click_element',
          args: { target: '1' },
          targetLabel: 'Delete All Account Data Permanently',
          reasoning: 'Purge all data',
        },
      ],
      createdAt: Date.now(),
      runCount: 0,
    };

    const result = await executeMacro(dangerousMacro, 1);
    expect(result.success).toBe(false);
    expect(result.stepsCompleted).toBe(0);
    expect(result.error).toContain('Action blocked by safety policy');
  });
});
