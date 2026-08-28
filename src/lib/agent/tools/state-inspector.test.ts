import { describe, it, expect } from 'vitest';
import { formatInspectedState, type StateInspectorResult } from './state-inspector';
import { validateToolCall } from './schemas';

describe('State Inspector Tool', () => {
  it('validates eval_page_script schema with Zod', () => {
    const valid = {
      tool: 'eval_page_script',
      target: 'next_data',
    };
    const res = validateToolCall(valid);
    expect(res.success).toBe(true);

    const validCustom = {
      tool: 'eval_page_script',
      target: 'custom',
      customPath: 'window.__INITIAL_STATE__.products',
    };
    expect(validateToolCall(validCustom).success).toBe(true);
  });

  it('formats inspected state into structured JSON block', () => {
    const mockResult: StateInspectorResult = {
      success: true,
      target: 'next_data',
      source: 'window.__NEXT_DATA__',
      data: {
        pageProps: {
          product: { id: '123', title: 'NVIDIA RTX 4090', price: 1599 },
        },
      },
    };

    const output = formatInspectedState(mockResult);
    expect(output).toContain('PAGE SCRIPT INSPECTION (window.__NEXT_DATA__)');
    expect(output).toContain('NVIDIA RTX 4090');
    expect(output).toContain('1599');
  });

  it('formats missing data errors cleanly', () => {
    const mockResult: StateInspectorResult = {
      success: false,
      target: 'nuxt_state',
      source: 'nuxt_state',
      data: null,
      error: 'No Nuxt / Vue initial state found on this page.',
    };

    const output = formatInspectedState(mockResult);
    expect(output).toContain('PAGE SCRIPT INSPECTOR');
    expect(output).toContain('No Nuxt / Vue initial state found');
  });
});
