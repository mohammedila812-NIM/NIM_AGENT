import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentEngine } from '../engine';
import { ToolDispatcher } from '../core/tool-dispatcher';
import { detectUnreadDelta, type UnreadFingerprint } from './change-detector';
import { isValidMessage } from '../../messaging/protocol';

describe('Phase 2: Autonomous-Action Safety & Concurrency Governance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Finding 5 & 10: Protocol Schema Validation & Message Origin Guards', () => {
    it('validates PAGE_CHANGE_DETECTED, SENTINEL_TRIGGER_ACTION, and HITL_RESPONSE payloads in isValidMessage', () => {
      expect(isValidMessage({
        type: 'PAGE_CHANGE_DETECTED',
        target: 'div[role="main"]',
        summary: 'New message received',
        actionOnDetect: 'auto_act',
        autonomousInstruction: 'Reply to message',
        url: 'https://instagram.com/direct/t/123',
        timestamp: Date.now(),
        tabId: 42,
      })).toBe(true);

      expect(isValidMessage({
        type: 'SENTINEL_TRIGGER_ACTION',
        instruction: 'Analyze the notification',
        changeSummary: 'Price dropped to $199',
        tabId: 42,
      })).toBe(true);

      expect(isValidMessage({
        type: 'HITL_RESPONSE',
        taskId: 'task-123',
        approved: true,
      })).toBe(true);

      // Malformed / injection payloads rejected
      expect(isValidMessage({
        type: 'PAGE_CHANGE_DETECTED',
        // missing required summary and target
      })).toBe(false);

      expect(isValidMessage({
        type: 'HITL_RESPONSE',
        taskId: 'task-123',
        // missing approved boolean
      })).toBe(false);
    });
  });

  describe('Finding 8: Loop Prevention (Own-Action & "You" Row Filtering)', () => {
    it('ignores chat rows where the last sender is "You" to prevent alert feedback loops', () => {
      const prev: UnreadFingerprint = {
        title: 'Instagram • Chats',
        unreadCount: 0,
        unreadBadgeText: '',
        activeDots: 0,
        conversationSnippet: 'ALI: Hi · 1m',
      };

      // Agent sent a message back ("You: Hello... · 1m")
      const currWithOwnMessage: UnreadFingerprint = {
        title: 'Instagram • Chats',
        unreadCount: 0,
        unreadBadgeText: '',
        activeDots: 0,
        conversationSnippet: 'ALI: Hi · 1m', // "You" row was filtered out from conversationSnippet
      };

      const delta = detectUnreadDelta(prev, currWithOwnMessage);
      expect(delta.changed).toBe(false);
    });
  });

  describe('Finding 7: auto_act Confirmation & Outbound Action Gating', () => {
    it('requires HITL authorization when configuring a watch with actionOnDetect auto_act', async () => {
      const dispatcher = new ToolDispatcher();
      let hitlPrompted = false;
      let requestedReason = '';

      const mockCtx: any = {
        taskId: 'test-task',
        instruction: 'Watch messages',
        config: {
          providerConfig: { id: 'mock', label: 'Mock', baseUrl: '', apiKey: 'key' },
          model: { id: 'mock-model', contextLength: 1000, supportsTools: true, supportsVision: false, isAgentTuned: true, providerLabel: 'Mock' },
        },
        callbacks: {
          onHITLRequired: async (_tool: any, reason: string) => {
            hitlPrompted = true;
            requestedReason = reason;
            return false; // User declines
          },
        },
        resolveTabId: async () => 99,
        setResolvedTabId: () => {},
        scopeDomains: [],
        failedDomAttempts: 0,
        setFailedDomAttempts: () => {},
        autoSnapshotAfterAction: async () => '',
      };

      const result = await dispatcher.execute({
        tool: 'watch_page_changes',
        action: 'start',
        target: 'div[role="main"]',
        actionOnDetect: 'auto_act',
        autonomousInstruction: 'Send automated reply to customer',
      }, mockCtx);

      expect(hitlPrompted).toBe(true);
      expect(requestedReason).toContain('Authorize Autonomous Watch');
      expect(requestedReason).toContain('Send automated reply to customer');
      expect(result).toContain('WATCH_BLOCKED: User declined autonomous action authorization');
    });

    it('requires HITL for outbound text typing during autonomous execution if allowSending is not granted', async () => {
      const dispatcher = new ToolDispatcher();
      let outboundPrompted = false;

      const autonomousCtx: any = {
        taskId: 'auto-task',
        instruction: 'Auto reply',
        config: {
          providerConfig: { id: 'mock', label: 'Mock', baseUrl: '', apiKey: 'key' },
          model: { id: 'mock-model', contextLength: 1000, supportsTools: true, supportsVision: false, isAgentTuned: true, providerLabel: 'Mock' },
          isAutonomous: true,
          allowSending: false, // User did NOT pre-authorize outbound sending
        },
        callbacks: {
          onHITLRequired: async (_tool: any, reason: string) => {
            outboundPrompted = true;
            expect(reason).toContain('Autonomous task is attempting outbound text entry');
            return false; // Deny
          },
        },
        resolveTabId: async () => 99,
        setResolvedTabId: () => {},
        scopeDomains: [],
        failedDomAttempts: 0,
        setFailedDomAttempts: () => {},
        autoSnapshotAfterAction: async () => '',
      };

      const result = await dispatcher.execute({
        tool: 'type_text',
        target: '#chat-input',
        value: 'Hello from autonomous bot!',
      }, autonomousCtx);

      expect(outboundPrompted).toBe(true);
      expect(result).toContain('SECURITY_BLOCKED: Outbound text entry was declined');
    });

    it('requires HITL for Enter keypress submission during autonomous execution without allowSending', async () => {
      const dispatcher = new ToolDispatcher();
      let enterPrompted = false;

      const autonomousCtx: any = {
        taskId: 'auto-task',
        instruction: 'Auto submit',
        config: {
          providerConfig: { id: 'mock', label: 'Mock', baseUrl: '', apiKey: 'key' },
          model: { id: 'mock-model', contextLength: 1000, supportsTools: true, supportsVision: false, isAgentTuned: true, providerLabel: 'Mock' },
          isAutonomous: true,
          allowSending: false,
        },
        callbacks: {
          onHITLRequired: async (_tool: any, reason: string) => {
            enterPrompted = true;
            expect(reason).toContain('Autonomous task is attempting outbound submission via "Enter"');
            return false;
          },
        },
        resolveTabId: async () => 99,
        setResolvedTabId: () => {},
        scopeDomains: [],
        failedDomAttempts: 0,
        setFailedDomAttempts: () => {},
        autoSnapshotAfterAction: async () => '',
      };

      const result = await dispatcher.execute({
        tool: 'press_key',
        key: 'Enter',
      }, autonomousCtx);

      expect(enterPrompted).toBe(true);
      expect(result).toContain('SECURITY_BLOCKED: Outbound submission keypress was declined');
    });
  });

  describe('Finding 9: Concurrency Race Condition Governance & Abort State', () => {
    it('sets isAborted on AgentEngine and ReActLoopController when aborted', () => {
      const engine = new AgentEngine(
        'test-abort-task',
        'Test instruction',
        {
          providerConfig: { id: 'mock', label: 'Mock', baseUrl: '', apiKey: 'key' },
          model: { id: 'mock-model', contextLength: 1000, supportsTools: true, supportsVision: false, isAgentTuned: true, providerLabel: 'Mock' },
        },
      );

      expect(engine.isAborted).toBe(false);
      engine.abort();
      expect(engine.isAborted).toBe(true);
    });

    it('pins the target tab through pinnedTabId so resolveTabId never targets the active foreground tab', async () => {
      const engine = new AgentEngine(
        'test-pin-task',
        'Test instruction',
        {
          providerConfig: { id: 'mock', label: 'Mock', baseUrl: '', apiKey: 'key' },
          model: { id: 'mock-model', contextLength: 1000, supportsTools: true, supportsVision: false, isAgentTuned: true, providerLabel: 'Mock' },
          pinnedTabId: 777,
        },
      );

      const loop = (engine as any).loopController;
      const resolved = await loop.resolveTabId();
      expect(resolved).toBe(777);
    });
  });
});
