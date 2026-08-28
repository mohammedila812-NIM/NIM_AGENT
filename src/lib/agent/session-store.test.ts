import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  writeTurn,
  recordTaskStart,
  recordTaskCompletion,
  queryTurns,
  getRecentTurns,
  getTurnCount,
  clearSession,
  clearAllSessions,
  formatTurnsAsRecall,
} from './session-store';

const TEST_TASK_A = 'task-unit-test-A';
const TEST_TASK_B = 'task-unit-test-B';

describe('Session Store', () => {
  beforeEach(async () => {
    await clearAllSessions();
  });

  it('writes a turn and retrieves it', async () => {
    await writeTurn(TEST_TASK_A, {
      step: 1,
      tool: 'read_page',
      targetUrl: 'https://example.com',
      content: 'Acer Nitro 5 — $649 — RTX 4060',
    });

    const count = await getTurnCount(TEST_TASK_A);
    expect(count).toBe(1);

    const recent = await getRecentTurns(TEST_TASK_A, 5);
    expect(recent).toHaveLength(1);
    expect(recent[0].tool).toBe('read_page');
    expect(recent[0].content).toContain('Acer Nitro');
  });

  it('records task start and completion in cross-task session memory', async () => {
    await recordTaskStart(TEST_TASK_A, 'search about john wick');
    await recordTaskCompletion(TEST_TASK_A, 'search about john wick', 'John Wick is an action thriller starring Keanu Reeves.');

    // Now when a new task (TEST_TASK_B) asks what the last task was, queryTurns finds it
    const results = await queryTurns(TEST_TASK_B, 'john wick last task', 5);
    expect(results.length).toBeGreaterThan(0);
    const content = results.map((r) => r.content).join(' ');
    expect(content).toContain('john wick');
  });

  it('queries turns by keyword and returns relevant matches', async () => {
    await writeTurn(TEST_TASK_A, {
      step: 1, tool: 'read_page',
      targetUrl: 'https://amazon.com',
      content: 'Acer Nitro 5 Gaming Laptop — $649 — RTX 4060 — 144Hz display',
    });
    await writeTurn(TEST_TASK_A, {
      step: 2, tool: 'read_page',
      targetUrl: 'https://flipkart.com',
      content: 'ASUS TUF Gaming Laptop — $799 — RTX 4070 — 165Hz display',
    });
    await writeTurn(TEST_TASK_A, {
      step: 3, tool: 'web_search',
      content: 'Search results: best deals 2024...',
    });

    const results = await queryTurns(TEST_TASK_A, 'Acer laptop', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('Acer');
  });

  it('returns last N turns across the session', async () => {
    for (let i = 1; i <= 5; i++) {
      await writeTurn(TEST_TASK_A, {
        step: i, tool: 'read_page',
        content: `Step ${i} content`,
      });
    }

    const recent = await getRecentTurns(TEST_TASK_A, 3);
    expect(recent.length).toBeGreaterThanOrEqual(3);
    expect(recent[0].step).toBe(5);
  });

  it('clears all turns for a specific task', async () => {
    await writeTurn(TEST_TASK_A, { step: 1, tool: 'read_page', content: 'some data' });
    expect(await getTurnCount(TEST_TASK_A)).toBe(1);

    await clearSession(TEST_TASK_A);
    expect(await getTurnCount(TEST_TASK_A)).toBe(0);
  });

  it('strips image data from stored content', async () => {
    await writeTurn(TEST_TASK_A, {
      step: 1, tool: 'screenshot',
      content: '[IMAGE_DATA:data:image/png;base64,aaaBBBccc...] Screenshot captured.',
    });

    const turns = await getRecentTurns(TEST_TASK_A, 1);
    expect(turns[0].content).not.toContain('data:image/png');
    expect(turns[0].content).toContain('[image captured]');
  });

  it('formats turns and past tasks as readable markdown block', async () => {
    const fakeTurns = [
      { step: 3, tool: 'read_page', targetUrl: 'https://amazon.com', content: 'RTX 4090 — $1,599', timestamp: Date.now() },
    ];
    const pastTasks = [
      { taskId: 't1', instruction: 'search about john wick', status: 'done' as const, createdAt: Date.now() - 60000, updatedAt: Date.now() - 50000, result: 'John Wick is a hitman.' },
    ];

    const output = formatTurnsAsRecall(fakeTurns, pastTasks, 'GPU price');
    expect(output).toContain('PREVIOUS TASKS IN SESSION');
    expect(output).toContain('search about john wick');
    expect(output).toContain('MATCHING STEPS');
    expect(output).toContain('RTX 4090');
    expect(output).toContain('amazon.com');
  });

  it('returns no-match message when query finds nothing', async () => {
    await writeTurn(TEST_TASK_A, { step: 1, tool: 'read_page', content: 'cat food recipes and ingredients' });

    const results = await queryTurns(TEST_TASK_A, 'RTX 4090 GPU price', 5);
    const output = formatTurnsAsRecall(results, [], 'RTX 4090 GPU price');
    expect(output).toContain('No past tasks or tool turns found matching');
  });
});
