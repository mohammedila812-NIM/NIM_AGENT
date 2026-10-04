import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildMemoryEnrichedTranscript, type HistoryTurn } from './session-memory';
import { vfs } from '../workspace/vfs';

// Mock LLM chat completion
vi.mock('../llm/client', () => ({
  chatCompletion: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: '- User researched RTX 4090 vs 4080.\n- Preferred 4090 for AI training.',
        },
      },
    ],
  }),
}));

describe('Lifelong Session Memory', () => {
  beforeEach(async () => {
    await vfs.init();
  });

  it('builds standard transcript when history is empty', async () => {
    const transcript = await buildMemoryEnrichedTranscript(
      'What is today weather?',
      'You are NIM Agent.',
      []
    );

    expect(transcript).toHaveLength(2);
    expect(transcript[0].role).toBe('system');
    expect(transcript[1].role).toBe('user');
    expect(transcript[1].content).toBe('What is today weather?');
  });

  it('preserves short conversation history verbatim', async () => {
    const history: HistoryTurn[] = [
      { role: 'user', content: 'Tell me about quantum computers' },
      { role: 'assistant', content: 'Quantum computers use qubits.' },
      { role: 'user', content: 'What is superposition?' },
      { role: 'assistant', content: 'Superposition allows states to overlap.' },
    ];

    const transcript = await buildMemoryEnrichedTranscript(
      'Can qubits be entangled?',
      'You are NIM Agent.',
      history
    );

    // 1 system + 4 history + 1 current instruction = 6 messages
    expect(transcript).toHaveLength(6);
    expect(transcript[1].content).toBe('Tell me about quantum computers');
    expect(transcript[2].content).toBe('Quantum computers use qubits.');
    expect(transcript[5].content).toBe('Can qubits be entangled?');
  });

  it('compresses older turns into rolling memory when history is long', async () => {
    const history: HistoryTurn[] = [
      { role: 'user', content: 'Query 1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Query 2' },
      { role: 'assistant', content: 'Answer 2' },
      { role: 'user', content: 'Query 3' },
      { role: 'assistant', content: 'Answer 3' },
      { role: 'user', content: 'Query 4' },
      { role: 'assistant', content: 'Answer 4' },
    ];

    const transcript = await buildMemoryEnrichedTranscript(
      'Query 5',
      'You are NIM Agent.',
      history,
      { id: 'mock', label: 'Mock', baseUrl: 'https://mock.api', apiKey: 'mock' },
      'mock-model'
    );

    // System prompt should contain the rolling memory header
    const sysPrompt = transcript[0].content as string;
    expect(sysPrompt).toContain('CONTINUOUS SESSION MEMORY & ROLLING CONTEXT');

    // Recent 4 turns should be preserved verbatim
    expect(transcript.some((m) => m.content === 'Query 3')).toBe(true);
    expect(transcript.some((m) => m.content === 'Answer 3')).toBe(true);
    expect(transcript.some((m) => m.content === 'Query 4')).toBe(true);
    expect(transcript.some((m) => m.content === 'Answer 4')).toBe(true);

    // Current instruction is at the end
    expect(transcript[transcript.length - 1].content).toBe('Query 5');
  });
});
