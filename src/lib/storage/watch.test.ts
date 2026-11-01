import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveWatch,
  loadWatch,
  listWatches,
  deleteWatch,
  toggleWatchStatus,
  alarmName,
  parseDuration,
  formatInterval,
  MIN_MV3_ALARM_PERIOD_MINUTES,
  type WatchTarget,
} from './watch';
import { validateToolCall } from '../agent/tools/schemas';

describe('Watch Storage Module', () => {
  beforeEach(async () => {
    const all = await listWatches();
    for (const w of all) {
      await deleteWatch(w.watchId);
    }
  });

  it('validates create_watch, list_watches, and delete_watch tool schemas with Zod', () => {
    const createCall = {
      tool: 'create_watch',
      name: 'GPU Deal Watch',
      url: 'https://amazon.com/rtx4090',
      type: 'price',
      intervalMinutes: 15,
      conditionPrompt: 'Price < 1500',
    };
    expect(validateToolCall(createCall).success).toBe(true);

    const listCall = { tool: 'list_watches' };
    expect(validateToolCall(listCall).success).toBe(true);

    const deleteCall = { tool: 'delete_watch', watchId: 'watch-123' };
    expect(validateToolCall(deleteCall).success).toBe(true);
  });

  it('saves and loads a watch target', async () => {
    const watch: WatchTarget = {
      watchId: 'watch-test-1',
      name: 'Test Monitor',
      url: 'https://example.com/product',
      type: 'price',
      intervalMinutes: 30,
      status: 'active',
      alertCount: 0,
      notificationOnMatch: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveWatch(watch);
    const loaded = await loadWatch('watch-test-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Test Monitor');
    expect(loaded?.intervalMinutes).toBe(30);
    expect(loaded?.status).toBe('active');
  });

  it('toggles watch status between active and paused', async () => {
    const watch: WatchTarget = {
      watchId: 'watch-test-toggle',
      name: 'Toggle Test',
      url: 'https://example.com',
      type: 'element_text',
      intervalMinutes: 60,
      status: 'active',
      alertCount: 0,
      notificationOnMatch: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveWatch(watch);
    const paused = await toggleWatchStatus('watch-test-toggle');
    expect(paused?.status).toBe('paused');

    const resumed = await toggleWatchStatus('watch-test-toggle');
    expect(resumed?.status).toBe('active');
  });

  it('generates consistent alarm names', () => {
    expect(alarmName('abc-123')).toBe('watch:abc-123');
  });

  it('deletes watch target cleanly', async () => {
    const watch: WatchTarget = {
      watchId: 'watch-to-delete',
      name: 'Delete Me',
      url: 'https://example.com',
      type: 'dom_selector',
      intervalMinutes: 10,
      status: 'active',
      alertCount: 0,
      notificationOnMatch: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveWatch(watch);
    expect(await loadWatch('watch-to-delete')).not.toBeNull();

    await deleteWatch('watch-to-delete');
    expect(await loadWatch('watch-to-delete')).toBeNull();
  });

  describe('Duration Parsing & Formatting Utilities', () => {
    it('parses bare numbers and numeric strings as minutes by default', () => {
      expect(parseDuration(15)).toBe(900);
      expect(parseDuration('15')).toBe(900);
      expect(parseDuration(30)).toBe(1800);
      expect(parseDuration('5')).toBe(300);
    });

    it('parses explicit second strings accurately', () => {
      expect(parseDuration('20s')).toBe(20);
      expect(parseDuration('20sec')).toBe(20);
      expect(parseDuration('20 seconds')).toBe(20);
      expect(parseDuration('45s')).toBe(45);
    });

    it('parses explicit minute and hour strings accurately', () => {
      expect(parseDuration('2min')).toBe(120);
      expect(parseDuration('5 minutes')).toBe(300);
      expect(parseDuration('1h')).toBe(3600);
      expect(parseDuration('2 hours')).toBe(7200);
    });

    it('supports custom default unit for bare numbers', () => {
      expect(parseDuration(20, 1800, 'seconds')).toBe(20);
      expect(parseDuration('20', 1800, 'seconds')).toBe(20);
    });

    it('falls back to defaultSeconds on invalid or missing input', () => {
      expect(parseDuration(undefined, 1800)).toBe(1800);
      expect(parseDuration('', 1800)).toBe(1800);
      expect(parseDuration(-5, 1800)).toBe(1800);
    });

    it('formats intervals into human-readable strings', () => {
      expect(formatInterval(20)).toBe('20 seconds');
      expect(formatInterval(60)).toBe('1 minute');
      expect(formatInterval(900)).toBe('15 minutes');
      expect(formatInterval(3600)).toBe('1 hour');
      expect(formatInterval(7200)).toBe('2 hours');
    });

    it('enforces Chrome Manifest V3 minimum alarm interval of at least 30 seconds', () => {
      expect(MIN_MV3_ALARM_PERIOD_MINUTES).toBeGreaterThanOrEqual(0.5);
    });
  });
});
