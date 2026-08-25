import { describe, it, expect } from 'vitest';
import { validateAction } from './action-validator';

describe('Action Validator', () => {
  it('blocks attempts to type into password, credit card, bank account, or OTP fields', async () => {
    const resPass = await validateAction('type_text', 'user_password_input', ['example.com'], 't1');
    expect(resPass.riskLevel).toBe('block');
    expect(resPass.isConsistent).toBe(false);

    const resIban = await validateAction('type_text', 'iban_account_number', ['example.com'], 't1');
    expect(resIban.riskLevel).toBe('block');

    const resOtp = await validateAction('type_text', '2fa_auth_code', ['example.com'], 't1');
    expect(resOtp.riskLevel).toBe('block');
  });

  it('triggers HITL warning on destructive actions like submit / pay / delete', async () => {
    const res = await validateAction('click_element', '#confirm-purchase-btn', ['shop.com'], 't2');
    expect(res.riskLevel).toBe('warn');
    expect(res.isConsistent).toBe(true);
  });

  it('warns on out-of-scope domain navigation', async () => {
    const res = await validateAction('navigate_to', 'https://malicious-external.com', ['trusted.com'], 't3');
    expect(res.riskLevel).toBe('warn');
    expect(res.isConsistent).toBe(false);
  });

  it('allows safe in-scope actions', async () => {
    const res = await validateAction('click_element', '#next-page', ['trusted.com'], 't4');
    expect(res.riskLevel).toBe('safe');
    expect(res.isConsistent).toBe(true);
  });
});
