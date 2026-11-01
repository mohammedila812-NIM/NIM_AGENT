import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimedDeepResearchSession, cleanHtmlToText } from './deep-research';
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

  describe('HTML Processing & SPA Fallback (FINDING-P2-06)', () => {
    it('decodes HTML entities and strips unwanted tags', () => {
      const rawHtml = `
        <html>
          <head><style>body { color: red; }</style></head>
          <body>
            <script>console.log("secret");</script>
            <noscript>Turn on JS</noscript>
            <svg><path d="M0 0"/></svg>
            <h1>NVIDIA &amp; AI &quot;Breakthroughs&quot;</h1>
            <p>Prices &lt; $500 &amp;&amp; rating &gt; 4.5. It&#39;s fast &nbsp; indeed.</p>
          </body>
        </html>
      `;
      const cleaned = cleanHtmlToText(rawHtml);
      expect(cleaned).not.toContain('<style>');
      expect(cleaned).not.toContain('<script>');
      expect(cleaned).not.toContain('console.log');
      expect(cleaned).toContain('NVIDIA & AI "Breakthroughs"');
      expect(cleaned).toContain("Prices < $500 && rating > 4.5. It's fast indeed.");
    });

    it('falls back to search snippet when response is a client-rendered SPA container', async () => {
      const session = new TimedDeepResearchSession({
        topic: 'AI Benchmark',
        durationMinutes: 1,
        providerConfig: { id: 'mock', label: 'Mock', baseUrl: 'https://mock.api', apiKey: 'mock' },
        model: { id: 'mock', contextLength: 32000, supportsTools: true, supportsVision: false, isAgentTuned: true, providerLabel: 'Mock' },
      });

      // Mock global fetch returning SPA empty container
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        text: async () => '<html><body><div id="root"></div><script src="app.js"></script><noscript>You need to enable JavaScript to run this app.</noscript></body></html>',
      } as unknown as Response);

      try {
        const text = await session.fetchPageText('https://spa-example.com', 'Detailed snippet about AI Benchmark results from search engine');
        expect(text).toContain('Detailed snippet about AI Benchmark results');
        expect(text).toContain('client-side SPA');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('falls back to search snippet when response is a binary resource', async () => {
      const session = new TimedDeepResearchSession({
        topic: 'AI Benchmark',
        durationMinutes: 1,
        providerConfig: { id: 'mock', label: 'Mock', baseUrl: 'https://mock.api', apiKey: 'mock' },
        model: { id: 'mock', contextLength: 32000, supportsTools: true, supportsVision: false, isAgentTuned: true, providerLabel: 'Mock' },
      });

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        headers: new Headers({ 'content-type': 'application/pdf' }),
        text: async () => '%PDF-1.4 binary content',
      } as unknown as Response);

      try {
        const text = await session.fetchPageText('https://example.com/paper.pdf', 'Search snippet for whitepaper');
        expect(text).toBe('Search snippet for whitepaper');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
