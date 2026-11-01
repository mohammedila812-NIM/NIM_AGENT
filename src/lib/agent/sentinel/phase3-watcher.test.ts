import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  sentinelInjectedWatcher,
  detectUnreadDelta,
  type UnreadFingerprint,
} from './change-detector';
import {
  evaluateConditionPredicate,
  cleanMessagingSnippet,
} from './predicates';

describe('Phase 3 Sentinel Watcher Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function runInIsolatedContext(
    fn: Function,
    args: any[],
    options: { url?: string; html?: string; chromeMock?: any } = {}
  ) {
    const url = options.url || 'https://example.com/app';
    const html = options.html || '<!DOCTYPE html><html><head><title>Test App</title></head><body><main id="content">$100</main></body></html>';
    const dom = new JSDOM(html, {
      url,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
    });
    const win = dom.window as any;
    const sentMessages: any[] = [];
    const mockChrome = options.chromeMock || {
      runtime: {
        id: 'test-ext-id',
        sendMessage: (msg: any) => sentMessages.push(msg),
      },
    };
    win.chrome = mockChrome;

    win.AudioContext = class {
      state = 'running';
      currentTime = 0;
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      createOscillator = () => ({
        type: 'sine',
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      });
      createGain = () => ({
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      });
    };

    const fnStr = fn.toString();
    const isolatedFn = new win.Function(
      'chrome',
      'args',
      `
        const targetFn = (${fnStr});
        return targetFn.apply(window, args);
      `,
    );

    const result = isolatedFn(mockChrome, args);
    return { dom, win, sentMessages, result };
  }

  it('evaluates price drop with numeric condition predicate (< 50)', () => {
    // 1. Drop from $75 to $60 does NOT satisfy < 50
    const eval1 = evaluateConditionPredicate('< 50', '$60.00', '$75.00');
    expect(eval1.matched).toBe(false);

    // 2. Drop from $75 to $42.50 satisfies < 50
    const eval2 = evaluateConditionPredicate('< 50', '$42.50', '$75.00');
    expect(eval2.matched).toBe(true);
    expect(eval2.reason).toContain('Condition satisfied');

    // 3. Currency symbols and thousand commas are cleanly handled
    const eval3 = evaluateConditionPredicate('<= 1,000', '€950.00');
    expect(eval3.matched).toBe(true);
  });

  it('timestamp-only changes in messaging snippets do NOT trigger alerts', () => {
    const snippet1 = 'Ali: Hi · 1m';
    const snippet2 = 'Ali: Hi · 2m';
    const snippet3 = 'Ali: Hi · 10 mins ago';

    expect(cleanMessagingSnippet(snippet1)).toBe('Ali: Hi');
    expect(cleanMessagingSnippet(snippet2)).toBe('Ali: Hi');
    expect(cleanMessagingSnippet(snippet3)).toBe('Ali: Hi');

    // detectUnreadDelta with timestamp tick returns changed: false
    const prev: UnreadFingerprint = {
      title: 'Instagram',
      unreadCount: 0,
      unreadBadgeText: '',
      activeDots: 0,
      conversationSnippet: snippet1,
    };
    const curr: UnreadFingerprint = {
      ...prev,
      conversationSnippet: snippet2,
    };

    const delta = detectUnreadDelta(prev, curr);
    expect(delta.changed).toBe(false);
  });

  it('unread count decreases (reading an email/message) do NOT trigger alerts', () => {
    const prev: UnreadFingerprint = {
      title: 'Inbox',
      unreadCount: 5,
      unreadBadgeText: '5 unread messages',
      activeDots: 1,
      conversationSnippet: 'Alice: Hello',
    };
    const curr: UnreadFingerprint = {
      title: 'Inbox',
      unreadCount: 4,
      unreadBadgeText: '4 unread messages',
      activeDots: 1,
      conversationSnippet: 'Alice: Hello',
    };

    const delta = detectUnreadDelta(prev, curr);
    expect(delta.changed).toBe(false);
  });

  it('unread count increases trigger alerts', () => {
    const prev: UnreadFingerprint = {
      title: 'Inbox',
      unreadCount: 1,
      unreadBadgeText: '1 unread',
      activeDots: 0,
      conversationSnippet: '',
    };
    const curr: UnreadFingerprint = {
      title: 'Inbox',
      unreadCount: 2,
      unreadBadgeText: '2 unread',
      activeDots: 0,
      conversationSnippet: 'Bob: New file attached',
    };

    const delta = detectUnreadDelta(prev, curr);
    expect(delta.changed).toBe(true);
    expect(delta.type).toBe('attribute');
    expect(delta.summary).toContain('+1');
  });

  it('ignores changes during the first-load 1000ms settle gate', () => {
    const { win, sentMessages } = runInIsolatedContext(
      sentinelInjectedWatcher,
      ['page', 'any', 'any change', 'ask', '', false, 60],
    );

    expect(win.__nimSentinelWatcher).toBeDefined();

    // Mutation occurs at t=300ms (during settle gate)
    const mainEl = win.document.querySelector('main');
    if (mainEl) mainEl.textContent = '$90 (hydrating)';
    vi.advanceTimersByTime(500);

    // Settle gate is not over, so no alert should have been sent yet
    expect(sentMessages.length).toBe(0);

    // Complete settle gate (t=1100ms)
    vi.advanceTimersByTime(600);
    expect(sentMessages.length).toBe(0);

    // Now post-settle mutation at t=1200ms
    if (mainEl) mainEl.textContent = '$50 (actual price drop)';
    vi.advanceTimersByTime(1500);

    // Alert should now be sent
    expect(sentMessages.length).toBe(1);
    const alertMsg = sentMessages[0] as { type: string; summary: string };
    expect(alertMsg.type).toBe('PAGE_CHANGE_DETECTED');
    expect(alertMsg.summary).toContain('$50 (actual price drop)');

    win.__nimSentinelWatcher?.stop();
  });

  it('ignores own-messages sent by the user (You: / You sent)', () => {
    const prev: UnreadFingerprint = {
      title: 'Chat',
      unreadCount: 0,
      unreadBadgeText: '',
      activeDots: 0,
      conversationSnippet: 'Alice: Hi',
    };
    const curr: UnreadFingerprint = {
      ...prev,
      conversationSnippet: 'You: Thanks Alice!',
    };

    const delta = detectUnreadDelta(prev, curr);
    expect(delta.changed).toBe(false);
  });

  it('fails fast when explicit target selector is not found on page', () => {
    const { result } = runInIsolatedContext(
      sentinelInjectedWatcher,
      ['#non-existent-button-xyz', 'any', 'any change', 'ask', '', true, 60],
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Target element "#non-existent-button-xyz" was not found on the page.');
  });
});
