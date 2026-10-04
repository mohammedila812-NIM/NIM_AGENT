/**
 * Phase 3 Tests — Knowledge Graph & Swarm Coordinator
 * All pure-function tests (no real IndexedDB or Chrome APIs)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decomposeResearchTopic } from '../agent/swarm/coordinator';
import {
  executeKnowledgeGraphQuery,
  executeKnowledgeGraphAdd,
  executeKnowledgeGraphRelate,
} from './graph-tools';

// ─── Mock graph-db ────────────────────────────────────────────────────────────

vi.mock('./graph-db', () => ({
  upsertNode: vi.fn().mockResolvedValue({
    id: 'product:sony_wh-1000xm5',
    label: 'Sony WH-1000XM5',
    type: 'product',
    attributes: { price: '$279' },
    seenCount: 1,
    firstSeen: 1000,
    lastSeen: 1000,
  }),
  upsertEdge: vi.fn().mockResolvedValue({
    id: 'product:sony_wh-1000xm5--made_by--organization:sony',
    fromId: 'product:sony_wh-1000xm5',
    toId: 'organization:sony',
    relation: 'made_by',
    weight: 1,
    updatedAt: 1000,
  }),
  queryGraph: vi.fn().mockResolvedValue({
    nodes: [
      {
        id: 'product:sony_wh-1000xm5',
        label: 'Sony WH-1000XM5',
        type: 'product',
        attributes: { price: '$279', rating: '4.8' },
        seenCount: 3,
        firstSeen: 1000,
        lastSeen: 2000,
      },
    ],
    edges: [],
    summary: '**Knowledge Graph — "sony" (1 nodes found):**\n\n• **Sony WH-1000XM5** [product] — price: $279, rating: 4.8',
  }),
  getGraphStats: vi.fn().mockResolvedValue({ nodeCount: 42, edgeCount: 18 }),
  clearGraph: vi.fn().mockResolvedValue(undefined),
  searchNodes: vi.fn().mockResolvedValue([]),
  getEdgesForNode: vi.fn().mockResolvedValue([]),
  getNode: vi.fn().mockResolvedValue(null),
}));

// ─── Knowledge Graph Tools Tests ──────────────────────────────────────────────

describe('Knowledge Graph Tools', () => {
  it('executeKnowledgeGraphQuery returns formatted summary', async () => {
    const result = await executeKnowledgeGraphQuery({ keyword: 'sony' });
    expect(result).toContain('Knowledge Graph');
    expect(result).toContain('nodes');
    expect(result).toContain('Sony WH-1000XM5');
  });

  it('executeKnowledgeGraphQuery validates empty keyword', async () => {
    const result = await executeKnowledgeGraphQuery({ keyword: '' });
    expect(result).toContain('ERROR');
    expect(result).toContain('keyword');
  });

  it('executeKnowledgeGraphAdd saves a node and returns confirmation', async () => {
    const result = await executeKnowledgeGraphAdd({
      label: 'Sony WH-1000XM5',
      type: 'product',
      attributes: { price: '$279' },
    });
    expect(result).toContain('✅');
    expect(result).toContain('Sony WH-1000XM5');
  });

  it('executeKnowledgeGraphAdd validates empty label', async () => {
    const result = await executeKnowledgeGraphAdd({ label: '', type: 'product' });
    expect(result).toContain('ERROR');
  });

  it('executeKnowledgeGraphRelate saves a relation', async () => {
    const result = await executeKnowledgeGraphRelate({
      fromLabel: 'Sony WH-1000XM5',
      fromType: 'product',
      relation: 'made_by',
      toLabel: 'Sony',
      toType: 'organization',
    });
    expect(result).toContain('✅');
    expect(result).toContain('made_by');
  });

  it('executeKnowledgeGraphRelate validates missing relation', async () => {
    const result = await executeKnowledgeGraphRelate({
      fromLabel: 'A',
      relation: '',
      toLabel: 'B',
    });
    expect(result).toContain('ERROR');
  });
});

// ─── Swarm Decomposition Tests ────────────────────────────────────────────────

describe('Swarm Coordinator — decomposeResearchTopic', () => {
  it('falls back to single web-search sub-query on JSON parse error', async () => {
    vi.mock('../llm/client', () => ({
      chatCompletion: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'not valid json' } }],
      }),
    }));

    const { decomposeResearchTopic: decompose } = await import('../agent/swarm/coordinator');
    const result = await decompose(
      'best wireless headphones',
      { apiKey: 'test', id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
      { id: 'gpt-4o', name: 'GPT-4o', supportsTools: true, contextWindow: 128000, supportsVision: true } as never,
      3,
    );

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].url).toContain('http');
    expect(result[0].instruction).toBeTruthy();
  });

  it('parses valid JSON decomposition correctly', async () => {
    const { chatCompletion } = await import('../llm/client');
    vi.mocked(chatCompletion).mockResolvedValueOnce({
      id: 'test',
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({
            subqueries: [
              {
                name: 'Amazon',
                url: 'https://amazon.com/s?k=headphones',
                instruction: 'Find top 5 headphone prices',
                extractFields: ['title', 'price', 'rating'],
              },
              {
                name: 'BestBuy',
                url: 'https://bestbuy.com/site/searchpage.jsp?st=headphones',
                instruction: 'Find top 5 headphone listings with prices',
                extractFields: ['title', 'price', 'url'],
              },
            ],
          }),
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    });

    const result = await decomposeResearchTopic(
      'best headphones',
      { apiKey: 'test', id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
      { id: 'gpt-4o', name: 'GPT-4o' } as never,
    );

    expect(result.length).toBe(2);
    expect(result[0].name).toBe('Amazon');
    expect(result[1].name).toBe('BestBuy');
    expect(result[0].extractFields).toContain('price');
  });
});
