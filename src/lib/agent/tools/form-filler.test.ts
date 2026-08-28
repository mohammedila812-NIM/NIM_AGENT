import { describe, it, expect } from 'vitest';
import { formatBatchFillResult, type BatchFormFillResult } from './form-filler';
import { validateToolCall } from './schemas';

describe('Batch Form Auto-Fill Tool', () => {
  it('validates valid fill_form tool call arguments with Zod', () => {
    const validCall = {
      tool: 'fill_form',
      fields: [
        { target: '1', value: 'Alice' },
        { target: '2', value: 'Smith' },
        { target: '3', value: 'alice@example.com' },
        { target: '4', value: 'CA', type: 'select' },
        { target: '5', value: 'true', type: 'checkbox' },
      ],
      submitAfter: true,
      submitTarget: '6',
    };

    const res = validateToolCall(validCall);
    expect(res.success).toBe(true);
    if (res.success && res.data.tool === 'fill_form') {
      expect(res.data.fields).toHaveLength(5);
      expect(res.data.submitAfter).toBe(true);
    }
  });

  it('rejects empty fields array in fill_form', () => {
    const invalidCall = {
      tool: 'fill_form',
      fields: [],
    };

    const res = validateToolCall(invalidCall);
    expect(res.success).toBe(false);
  });

  it('formats a successful batch fill report cleanly', () => {
    const mockResult: BatchFormFillResult = {
      success: true,
      filled: 3,
      total: 3,
      submitted: true,
      results: [
        { target: '1', status: 'filled', label: 'first_name' },
        { target: '2', status: 'filled', label: 'last_name' },
        { target: '3', status: 'filled', label: 'newsletter_optin' },
      ],
    };

    const output = formatBatchFillResult(mockResult);
    expect(output).toContain('BATCH FORM FILL REPORT: 3/3 fields successfully populated');
    expect(output).toContain('Form submission triggered');
    expect(output).toContain('first_name');
    expect(output).toContain('last_name');
  });

  it('formats partial failures and skipped sensitive fields correctly', () => {
    const mockResult: BatchFormFillResult = {
      success: true,
      filled: 1,
      total: 3,
      submitted: false,
      results: [
        { target: '1', status: 'filled', label: 'username' },
        { target: '2', status: 'skipped', label: 'password', error: 'Sensitive field (password/payment) skipped for security' },
        { target: '3', status: 'failed', error: 'Element "3" not found on page' },
      ],
    };

    const output = formatBatchFillResult(mockResult);
    expect(output).toContain('1/3 fields successfully populated');
    expect(output).toContain('⚠️ [2] (password): skipped — Sensitive field');
    expect(output).toContain('❌ [3]: failed — Element "3" not found');
  });
});
