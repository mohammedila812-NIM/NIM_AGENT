import { describe, it, expect } from 'vitest';
import { saveCheckpoint, loadCheckpoint, deleteCheckpoint, findInterruptedTasks, type AgentCheckpoint } from './checkpoint';

describe('Checkpoint Management', () => {
  const sampleCheckpoint: AgentCheckpoint = {
    version: 1,
    taskId: 'task-test-1',
    status: 'running',
    currentStepIndex: 3,
    originalIntent: 'Research quantum computing',
    taskScopeDomains: ['arxiv.org'],
    transcript: [
      { role: 'user', content: 'Research quantum computing' },
      { role: 'assistant', content: 'Let me search arxiv' },
    ],
    actionLog: [],
    timestamp: Date.now(),
  };

  it('saves and loads a checkpoint', async () => {
    await saveCheckpoint(sampleCheckpoint);
    const loaded = await loadCheckpoint('task-test-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.currentStepIndex).toBe(3);
    expect(loaded?.originalIntent).toBe('Research quantum computing');
  });

  it('identifies interrupted running tasks on restart', async () => {
    await saveCheckpoint(sampleCheckpoint);
    const running = await findInterruptedTasks();
    expect(running.some((c) => c.taskId === 'task-test-1')).toBe(true);
  });

  it('deletes completed task checkpoint', async () => {
    await saveCheckpoint(sampleCheckpoint);
    await deleteCheckpoint('task-test-1');
    const loaded = await loadCheckpoint('task-test-1');
    expect(loaded).toBeNull();
  });
});
