import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  detectElementDelta,
  detectUnreadDelta,
  sentinelInjectedWatcher,
  sentinelInjectedStopper,
  sentinelInjectedStatusGetter,
  type ElementSnapshot,
  type UnreadFingerprint,
} from './change-detector';

describe('Sentinel Change Detector Engine', () => {
  const baseSnapshot: ElementSnapshot = {
    text: 'Hello, welcome to the chat.',
    childCount: 4,
    attributes: { class: 'chat-container', 'data-status': 'idle' },
    value: undefined,
    timestamp: 1000,
  };

  it('detects child count additions (e.g. new incoming chat messages)', () => {
    const updated: ElementSnapshot = {
      ...baseSnapshot,
      childCount: 5,
      text: 'Hello, welcome to the chat. Alice: Hey there!',
      timestamp: 2000,
    };

    const delta = detectElementDelta(baseSnapshot, updated, 'any');
    expect(delta.changed).toBe(true);
    expect(delta.type).toBe('count');
    expect(delta.summary).toContain('added 1 new item(s)');
  });

  it('detects multiple items removed from a list or container', () => {
    const updated: ElementSnapshot = {
      ...baseSnapshot,
      childCount: 2,
      text: 'Hello',
      timestamp: 2000,
    };

    const delta = detectElementDelta(baseSnapshot, updated, 'count');
    expect(delta.changed).toBe(true);
    expect(delta.type).toBe('count');
    expect(delta.summary).toContain('removed 2 item(s)');
  });

  it('detects text content updates (e.g. price drops or status changes)', () => {
    const prev: ElementSnapshot = {
      text: '$299.99',
      childCount: 1,
      attributes: { class: 'price-tag' },
      timestamp: 1000,
    };

    const curr: ElementSnapshot = {
      text: '$249.99',
      childCount: 1,
      attributes: { class: 'price-tag' },
      timestamp: 2000,
    };

    const delta = detectElementDelta(prev, curr, 'text');
    expect(delta.changed).toBe(true);
    expect(delta.type).toBe('text');
    expect(delta.summary).toContain('Text updated from "$299.99" to "$249.99"');
    expect(delta.previousSnippet).toBe('$299.99');
    expect(delta.currentSnippet).toBe('$249.99');
  });

  it('detects input value modifications in form elements', () => {
    const prev: ElementSnapshot = {
      text: '',
      childCount: 0,
      attributes: { id: 'status-input' },
      value: 'Processing...',
      timestamp: 1000,
    };

    const curr: ElementSnapshot = {
      text: '',
      childCount: 0,
      attributes: { id: 'status-input' },
      value: 'Completed successfully!',
      timestamp: 2000,
    };

    const delta = detectElementDelta(prev, curr, 'any');
    expect(delta.changed).toBe(true);
    expect(delta.type).toBe('value');
    expect(delta.summary).toContain('Input value changed');
    expect(delta.currentSnippet).toBe('Completed successfully!');
  });

  it('detects attribute alterations (e.g. disabled flag, class shifts)', () => {
    const prev: ElementSnapshot = {
      text: 'Submit Order',
      childCount: 0,
      attributes: { disabled: 'true', class: 'btn btn-disabled' },
      timestamp: 1000,
    };

    const curr: ElementSnapshot = {
      text: 'Submit Order',
      childCount: 0,
      attributes: { class: 'btn btn-active' },
      timestamp: 2000,
    };

    const delta = detectElementDelta(prev, curr, 'attribute');
    expect(delta.changed).toBe(true);
    expect(delta.type).toBe('attribute');
    expect(delta.summary).toContain('Attribute');
  });

  it('returns changed: false when snapshots are identical', () => {
    const delta = detectElementDelta(baseSnapshot, { ...baseSnapshot, timestamp: 3000 }, 'any');
    expect(delta.changed).toBe(false);
    expect(delta.type).toBe('none');
    expect(delta.summary).toBe('No detectable changes');
  });

  it('filters by changeType properly', () => {
    // If text changed but preferredType is attribute, delta should be false
    const prev: ElementSnapshot = {
      text: 'Old Text',
      childCount: 2,
      attributes: { class: 'card' },
      timestamp: 1000,
    };

    const curr: ElementSnapshot = {
      text: 'New Text',
      childCount: 2,
      attributes: { class: 'card' },
      timestamp: 2000,
    };

    const deltaAttr = detectElementDelta(prev, curr, 'attribute');
    expect(deltaAttr.changed).toBe(false);

    const deltaText = detectElementDelta(prev, curr, 'text');
    expect(deltaText.changed).toBe(true);
  });

  describe('Unread & Messaging Fingerprint Sentinel', () => {
    const baseFingerprint: UnreadFingerprint = {
      title: 'Instagram • Chats',
      unreadCount: 0,
      unreadBadgeText: '',
      activeDots: 0,
      conversationSnippet: 'Kulot: Hello... · 1m || Sayan Sarkar: attachment · 11h',
    };

    it('detects unread dots appearing (e.g. Instagram blue dot next to Ali)', () => {
      const updated: UnreadFingerprint = {
        ...baseFingerprint,
        activeDots: 1, // Blue dot appeared!
        conversationSnippet: 'ALI: Hi · 1m || Kulot: Hello... · 1m',
      };

      const delta = detectUnreadDelta(baseFingerprint, updated);
      expect(delta.changed).toBe(true);
      expect(delta.type).toBe('mutation');
      expect(delta.summary).toContain('New unread message dot indicator detected (+1 new chat alert)');
    });

    it('detects document title updates with unread counter (e.g. "(1) Instagram • Chats")', () => {
      const updated: UnreadFingerprint = {
        ...baseFingerprint,
        title: '(1) Instagram • Chats',
      };

      const delta = detectUnreadDelta(baseFingerprint, updated);
      expect(delta.changed).toBe(true);
      expect(delta.type).toBe('text');
      expect(delta.summary).toContain('Tab title updated: "(1) Instagram • Chats" (1 unread notification(s))');
    });

    it('detects unread aria badge increases (e.g. aria-label="1 unread message")', () => {
      const updated: UnreadFingerprint = {
        ...baseFingerprint,
        unreadCount: 1,
        unreadBadgeText: 'Unread message from ALI',
      };

      const delta = detectUnreadDelta(baseFingerprint, updated);
      expect(delta.changed).toBe(true);
      expect(delta.type).toBe('attribute');
      expect(delta.summary).toContain('New unread badge / message alert (+1)');
      expect(delta.summary).toContain('Unread message from ALI');
    });

    it('detects incoming messages in conversation list rows', () => {
      const updated: UnreadFingerprint = {
        ...baseFingerprint,
        conversationSnippet: 'ALI: Hi · just now || Kulot: Hello... · 1m',
      };

      const delta = detectUnreadDelta(baseFingerprint, updated);
      expect(delta.changed).toBe(true);
      expect(delta.type).toBe('text');
      expect(delta.summary).toContain('New message arrived in chat list');
      expect(delta.summary).toContain('ALI: Hi');
    });

    it('returns changed: false when no unread activity has occurred', () => {
      const delta = detectUnreadDelta(baseFingerprint, { ...baseFingerprint });
      expect(delta.changed).toBe(false);
      expect(delta.type).toBe('none');
    });
  });

  describe('Injected Sentinel Worker Self-Containment & Security (Phase 1 Audit)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function runInIsolatedContext(
      fn: Function,
      args: any[],
      options: {
        url?: string;
        html?: string;
        chromeMock?: any;
      } = {},
    ) {
      const url = options.url || 'https://www.instagram.com/direct/inbox/';
      const html = options.html || '<!DOCTYPE html><html><head><title>Instagram • Chats</title></head><body><div id="root">Inbox</div></body></html>';
      const dom = new JSDOM(html, {
        url,
        runScripts: 'dangerously',
        pretendToBeVisual: true,
      });
      const win = dom.window as any;

      const sentMessages: any[] = [];
      const mockChrome = options.chromeMock || {
        runtime: {
          id: 'test-extension-id',
          sendMessage: (msg: any) => {
            sentMessages.push(msg);
          },
        },
      };
      win.chrome = mockChrome;

      // Mock AudioContext for jsdom
      win.AudioContext = class {
        state = 'running';
        currentTime = 0;
        destination = {};
        resume = vi.fn().mockResolvedValue(undefined);
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

      // Serialize function to string and evaluate inside new win.Function to isolate from outer TypeScript closures
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

    it('executes in isolated context with fn.toString() and does not throw ReferenceError for actionOnDetect', () => {
      const { win, sentMessages } = runInIsolatedContext(
        sentinelInjectedWatcher,
        ['page', 'any', 'any change', 'auto_act', 'Respond to greeting', true, 60],
      );

      expect(win.__nimSentinelWatcher).toBeDefined();
      expect(win.__nimSentinelWatcher.getStatus().active).toBe(true);

      // Advance past the 1000ms settle gate to establish post-hydration baseline
      vi.advanceTimersByTime(1100);

      // Trigger a change by updating title
      win.document.title = '(1) Instagram • Chats';

      // Advance timers by 1500ms to trigger the heartbeat polling interval and cooldown check
      vi.advanceTimersByTime(1500);

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toEqual({
        type: 'PAGE_CHANGE_DETECTED',
        target: 'Instagram Direct Messages',
        summary: expect.stringContaining('(1 unread item(s))'),
        actionOnDetect: 'auto_act',
        autonomousInstruction: 'Respond to greeting',
        url: 'https://www.instagram.com/direct/inbox/',
        timestamp: expect.any(Number),
      });

      // shouldStopAfterChange is true, so watcher stopped and removed itself
      expect(win.__nimSentinelWatcher).toBeUndefined();
    });

    it('wraps messaging in try/catch and re-baselines or stops in finally even when sendMessage throws or context invalidates', () => {
      let threw = false;
      const throwingChrome = {
        runtime: {
          id: 'test-id',
          sendMessage: () => {
            threw = true;
            throw new Error('Extension context invalidated.');
          },
        },
      };

      const { win } = runInIsolatedContext(
        sentinelInjectedWatcher,
        ['page', 'any', 'any change', 'ask', '', true, 60],
        { chromeMock: throwingChrome },
      );

      // Advance past settle gate
      vi.advanceTimersByTime(1100);

      // Trigger change
      win.document.title = '(1) New Notification';
      vi.advanceTimersByTime(1500);

      expect(threw).toBe(true);
      // Because shouldStopAfterChange is true, finally block stopped the watcher safely
      expect(win.__nimSentinelWatcher).toBeUndefined();
    });

    it('renders in-page HUD and cards inside a closed Shadow DOM host and enforces event.isTrusted on buttons', () => {
      const { win } = runInIsolatedContext(
        sentinelInjectedWatcher,
        ['page', 'any', 'any change', 'ask', '', false, 60],
      );

      const host = win.document.getElementById('nim-sentinel-host');
      expect(host).not.toBeNull();
      // Host shadowRoot is closed, so host.shadowRoot is null from outside inspection
      expect(host.shadowRoot).toBeNull();

      // Advance past settle gate
      vi.advanceTimersByTime(1100);

      // Trigger a change to display the notification card
      win.document.title = '(1) New DM';
      vi.advanceTimersByTime(1500);

      // Watcher is still active since shouldStopAfterChange is false
      expect(win.__nimSentinelWatcher.getStatus().active).toBe(true);

      // Verify synthetic untrusted click on host does NOT stop watcher
      // Synthetic events created via new MouseEvent natively have isTrusted === false
      const syntheticEvent = new win.MouseEvent('click', { bubbles: true });
      expect(syntheticEvent.isTrusted).toBe(false);
      host.dispatchEvent(syntheticEvent);

      expect(win.__nimSentinelWatcher.getStatus().active).toBe(true);
    });

    it('verifies all executeScript functions in change-detector are 100% self-contained', () => {
      // Test stopper
      const { result: stopResult } = runInIsolatedContext(sentinelInjectedStopper, []);
      expect(stopResult).toEqual({ success: false, reason: 'No active Sentinel watcher was running on this tab.' });

      // Test status getter
      const { result: statusResult } = runInIsolatedContext(sentinelInjectedStatusGetter, []);
      expect(statusResult).toEqual({ active: false, count: 0, target: 'none' });
    });
  });
});
