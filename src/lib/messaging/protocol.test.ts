import { describe, it, expect } from 'vitest';
import { isValidMessage, MessageSchema } from './protocol';

describe('Message Protocol Validation', () => {
  it('validates a correct AGENT_START message', () => {
    const valid = {
      type: 'AGENT_START',
      taskId: 'task-123',
      instruction: 'Find NVIDIA NIM pricing',
    };
    expect(isValidMessage(valid)).toBe(true);
  });

  it('rejects an invalid or foreign message schema', () => {
    const invalid = {
      type: 'UNKNOWN_ATTACK_VECTOR',
      payload: 'exploit',
    };
    expect(isValidMessage(invalid)).toBe(false);
  });

  it('validates HITL_RESPONSE message strictly', () => {
    expect(isValidMessage({ type: 'HITL_RESPONSE', taskId: 't1', approved: true })).toBe(true);
    expect(isValidMessage({ type: 'HITL_RESPONSE', taskId: 't1', approved: 'yes' })).toBe(false);
  });
});
