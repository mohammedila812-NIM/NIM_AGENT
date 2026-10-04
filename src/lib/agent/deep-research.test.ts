import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimedDeepResearchSession } from './deep-research';
import { vfs } from '../workspace/vfs';

// Mock LLM chat completion
vi.mock('../llm/client', () => ({
  chatCompletion: vi.fn().mockImplementation(async (_config, request) => {
    const userMsg = request.messages[request.messages.length - 1]?.content || '';
    if (userMsg.includes('Topic:')) {
      return {
        choices: [
          {
            message: {
              content: 'Quantum computing hardware qubits\nTop quantum startups 2026\nSuperconducting vs photonic quantum benchmarks',
            },
          },
        ],
      };
    }
    if (userMsg.includes('Accumulated Research Notes:')) {
      return {
        choices: [
          {
            message: {
              content: '# Executive Dossier: Quantum Computing\n## 1. Executive Summary\nQuantum computing is accelerating.\n## 2. Comparative Matrix\n| Tech | Qubits |\n| Superconducting | 1000 |',
            },
          },
        ],
      };
    }
    return {
      choices: [
        {
          message: {
            content: '- **Breakthrough**: 1,000 physical qubits demonstrated with 99.9% fidelity.\n- **Date**: Early 2026 announcement.',
          },
        },
      ],
    };
  }),
}));

// Mock web search
vi.mock('./tools/web-search', () => ({
  webSearch: vi.fn().mockResolvedValue(
    '1. IBM Quantum Roadmap - https://ibm.com/quantum - Overview of next-gen systems.\n2. Google Quantum AI - https://quantumai.google - Sycamore processor benchmarks.'
  ),
}));

describe('TimedDeepResearchSession', () => {
  beforeEach(async () => {
    await vfs.init();
  });

  it('initializes and runs a timed research cycle', async () => {
    const updates: string[] = [];

    const session = new TimedDeepResearchSession(
      {
        topic: 'Quantum Computing 2026',
        durationMinutes: 0.02, // ~1.2 seconds
        providerConfig: {
          id: 'mock',
          label: 'Mock',
          baseUrl: 'https://mock.api',
          apiKey: 'mock-key',
        },
        model: {
          id: 'mock-model',
          contextLength: 32000,
          supportsTools: true,
          supportsVision: false,
          isAgentTuned: true,
          providerLabel: 'Mock',
        },
      },
      (progress) => {
        if (progress.currentAction) updates.push(progress.currentAction);
      }
    );

    const report = await session.start();
    expect(report).toContain('Executive Dossier: Quantum Computing');

    // Verify files were created in VFS
    const files = await vfs.listFiles('/research', true);
    expect(files.some((f) => f.name === 'live_notes.md')).toBe(true);
    expect(files.some((f) => f.name === 'EXECUTIVE_REPORT.md')).toBe(true);

    const liveNotes = files.find((f) => f.name === 'live_notes.md');
    expect(liveNotes?.content).toContain('Live Field Notes');
  }, 15000);

  it('stops cleanly when user calls stop()', async () => {
    const session = new TimedDeepResearchSession({
      topic: 'Fusion Energy',
      durationMinutes: 5,
      providerConfig: {
        id: 'mock',
        label: 'Mock',
        baseUrl: 'https://mock.api',
        apiKey: 'mock-key',
      },
      model: {
        id: 'mock-model',
        contextLength: 32000,
        supportsTools: true,
        supportsVision: false,
        isAgentTuned: true,
        providerLabel: 'Mock',
      },
    });

    session.stop();
    // Should not throw
    expect(true).toBe(true);
  });
});
