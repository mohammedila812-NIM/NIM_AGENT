/**
 * NIM Swarm Coordinator — Phase 3
 *
 * Decomposes a research topic into 2–4 parallel sub-queries,
 * runs each in a dedicated background Chrome tab, collects results
 * from a shared Blackboard, and synthesizes a final dossier.
 *
 * Architecture:
 *   Coordinator → spawns N Worker tabs (chrome.tabs.create + scripting)
 *   Each Worker  → navigate → observe → extract → write to Blackboard
 *   Coordinator  → polls Blackboard → synthesizes report on completion
 *
 * Prompt Design:
 *   - Decomposition prompt enforces ORTHOGONAL sub-queries (no overlap)
 *   - Worker prompt is MINIMAL and tightly constrained (no recursion)
 *   - Synthesis prompt produces ranked markdown table or structured report
 */

import { chatCompletion } from '../../llm/client';
import type { ProviderConfig } from '../../llm/types';
import type { DiscoveredModel } from '../../llm/model-registry';
import { publishFinding } from '../blackboard';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SwarmSubQuery {
  name: string;        // e.g. "Amazon Prices"
  url: string;         // e.g. "https://amazon.com/s?k=sony+headphones"
  instruction: string; // e.g. "Find the top 3 Sony WH-1000XM5 prices and links"
  extractFields: string[]; // e.g. ["title", "price", "rating", "url"]
}

export interface SwarmConfig {
  topic: string;
  providerConfig: ProviderConfig;
  model: DiscoveredModel;
  workerModel?: DiscoveredModel;
  maxWorkers?: number;    // default 4
  workerTimeoutMs?: number; // default 30_000
}

export interface SwarmResult {
  topic: string;
  subResults: Array<{
    name: string;
    url: string;
    data: string;
    error?: string;
  }>;
  synthesis: string;
  durationMs: number;
}

// ─── Decomposition Prompt ─────────────────────────────────────────────────────

const DECOMPOSE_SYSTEM = `You are the Swarm Coordinator for NIM Agent, a browser automation assistant.

Your job is to decompose a research topic into 2–4 PARALLEL sub-queries that can be executed simultaneously across different websites.

RULES:
1. Each sub-query must target a DIFFERENT source (different domain/URL).
2. Sub-queries must be ORTHOGONAL — no overlap in what they collect.
3. Each sub-query needs a specific starting URL (use real well-known URLs).
4. Each sub-query needs a concrete instruction for what to extract.
5. Each sub-query needs a list of data fields to extract (3–6 fields).
6. Keep sub-queries to 2 (simple) or 4 (complex) — never exceed 4.
7. Prefer authoritative sources: official sites, major retailers, Wikipedia, news outlets.

OUTPUT — ONLY valid JSON:
{
  "subqueries": [
    {
      "name": "Amazon Search",
      "url": "https://www.amazon.com/s?k=<search+terms>",
      "instruction": "Find the top 5 <product> listings with prices, ratings, and review counts.",
      "extractFields": ["title", "price", "rating", "reviews", "url"]
    }
  ]
}`;

// ─── Synthesis Prompt ─────────────────────────────────────────────────────────

const SYNTHESIS_SYSTEM = `You are the Swarm Synthesizer for NIM Agent.

You have received parallel research results from multiple sources. Your job is to synthesize them into a clean, structured final report.

RULES:
1. Merge and deduplicate findings from all sources.
2. Present a ranked comparison table (markdown) when data is comparable (prices, specs, ratings).
3. Highlight the best/cheapest/highest-rated option clearly.
4. Note any discrepancies between sources.
5. Keep the report concise: 200–400 words + table.
6. Use the user's original topic as the heading.
7. If sources conflict, show both values and note the discrepancy.`;

// ─── Sub-Query Decomposition ──────────────────────────────────────────────────

export async function decomposeResearchTopic(
  topic: string,
  providerConfig: ProviderConfig,
  model: DiscoveredModel,
  maxWorkers = 4,
): Promise<SwarmSubQuery[]> {
  const response = await chatCompletion(
    providerConfig,
    {
      model: model.id,
      messages: [
        { role: 'system', content: DECOMPOSE_SYSTEM },
        {
          role: 'user',
          content: `Research topic: "${topic}"\nMax parallel sources: ${Math.min(maxWorkers, 4)}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 800,
    },
  );

  const raw = ((response.choices[0]?.message?.content as string) ?? '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(raw) as { subqueries: SwarmSubQuery[] };
    return (parsed.subqueries ?? []).slice(0, maxWorkers);
  } catch {
    // Fallback: single sub-query with a web search
    return [{
      name: 'Web Search',
      url: `https://www.google.com/search?q=${encodeURIComponent(topic)}`,
      instruction: `Search for information about: ${topic}. Extract the most relevant facts.`,
      extractFields: ['title', 'snippet', 'url'],
    }];
  }
}

// ─── Swarm Worker (per-tab extraction) ───────────────────────────────────────

/**
 * Runs a single worker sub-query:
 *   1. Navigate to the URL
 *   2. Wait for settle
 *   3. Extract structured data using the Primitives API
 *   4. Write result to shared Blackboard
 *
 * Workers run concurrently (Promise.allSettled) — each in a separate Chrome tab.
 */
export async function runSwarmWorker(
  subQuery: SwarmSubQuery,
  workerIndex: number,
  providerConfig: ProviderConfig,
  model: DiscoveredModel,
  timeoutMs = 30_000,
): Promise<{ name: string; url: string; data: string; error?: string }> {
  const start = Date.now();
  const blackboardKey = `swarm_worker_${workerIndex}_${subQuery.name.replace(/\s+/g, '_')}`;

  let tab: chrome.tabs.Tab | null = null;

  try {
    // 1. Open a background tab
    tab = await chrome.tabs.create({ url: subQuery.url, active: false });
    const tabId = tab.id!;

    // 2. Wait for page to load (poll readyState)
    await waitForTabLoad(tabId, Math.min(timeoutMs, 15_000));

    // 3. Extract text content from the page
    const [textResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (fields: string[]) => {
        const texts: Record<string, string[]> = {};

        // Strategy 1: Generic text extraction
        const body = document.body?.innerText ?? '';

        // Strategy 2: Try to find repeating structured elements
        const cards = document.querySelectorAll(
          '[class*="product"], [class*="item"], [class*="result"], [class*="card"], li[class], article',
        );

        if (cards.length > 2) {
          const records: Array<Record<string, string>> = [];
          Array.from(cards).slice(0, 20).forEach(card => {
            const row: Record<string, string> = {};
            for (const field of fields) {
              const lower = field.toLowerCase();
              const el = card.querySelector(
                `[class*="${lower}"], [data-${lower}], [itemprop="${lower}"]`,
              );
              if (el) row[field] = (el.textContent ?? '').trim().slice(0, 200);
              // Price heuristic
              if (lower === 'price' && !row[field]) {
                const priceMatch = (card.textContent ?? '').match(/[\$£€₹]\s?\d+(?:[.,]\d+)?/);
                if (priceMatch) row[field] = priceMatch[0];
              }
            }
            if (Object.values(row).some(v => v.length > 0)) records.push(row);
          });
          if (records.length > 0) {
            return JSON.stringify(records, null, 2);
          }
        }

        // Fallback: return first 2000 chars of body text
        return body.slice(0, 2000);
      },
      args: [subQuery.extractFields],
    });

    const rawData = (textResult?.result as string) ?? '';

    // 4. Use LLM to distill the raw extraction into a clean structured answer
    const synthesisResponse = await chatCompletion(
      providerConfig,
      {
        model: model.id,
        messages: [
          {
            role: 'system',
            content: `You are a data extraction assistant. Given raw scraped content from ${subQuery.url}, extract ONLY the requested information in a clean JSON array or markdown table. Be precise and factual. Do not hallucinate data not present in the content.`,
          },
          {
            role: 'user',
            content: `Instruction: ${subQuery.instruction}\nFields to extract: ${subQuery.extractFields.join(', ')}\n\nRaw content:\n${rawData}`,
          },
        ],
        temperature: 0,
        max_tokens: 600,
      },
    );

    const distilled = (synthesisResponse.choices[0]?.message?.content as string) ?? rawData.slice(0, 1000);

    // 5. Write to shared Blackboard
    publishFinding('swarm', {
      sourceWorker: subQuery.name,
      sourceUrl: subQuery.url,
      key: blackboardKey,
      value: distilled,
    });

    return { name: subQuery.name, url: subQuery.url, data: distilled };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { name: subQuery.name, url: subQuery.url, data: '', error: errorMsg };
  } finally {
    // Always close the background tab to clean up
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch { /* tab may already be closed */ }
    }
  }
}

// ─── Tab Load Waiter ─────────────────────────────────────────────────────────

function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    function check() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) { resolve(); return; }
        if (tab.status === 'complete') { resolve(); return; }
        if (Date.now() >= deadline) { resolve(); return; }
        setTimeout(check, 500);
      });
    }
    check();
  });
}

// ─── Main Coordinator ─────────────────────────────────────────────────────────

/**
 * Full swarm execution:
 *   1. Decompose topic into sub-queries
 *   2. Run all workers in parallel (Promise.allSettled)
 *   3. Collect results from Blackboard
 *   4. Synthesize final dossier with LLM
 */
export async function runSwarm(config: SwarmConfig): Promise<SwarmResult> {
  const start = Date.now();
  const workerModel = config.workerModel ?? config.model;

  // Step 1: Decompose
  const subQueries = await decomposeResearchTopic(
    config.topic,
    config.providerConfig,
    config.model,
    config.maxWorkers ?? 4,
  );

  // Step 2: Run workers in parallel
  const workerResults = await Promise.allSettled(
    subQueries.map((sq, idx) =>
      runSwarmWorker(sq, idx, config.providerConfig, workerModel, config.workerTimeoutMs ?? 30_000),
    ),
  );

  const subResults = workerResults.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : { name: 'Unknown', url: '', data: '', error: (r.reason as Error)?.message ?? 'Failed' },
  );

  // Step 3: Synthesize
  const successfulResults = subResults.filter(r => r.data);
  let synthesis = 'No data was collected from any source.';

  if (successfulResults.length > 0) {
    const combinedData = successfulResults
      .map(r => `### ${r.name} (${r.url})\n${r.data}`)
      .join('\n\n---\n\n');

    try {
      const synthResponse = await chatCompletion(
        config.providerConfig,
        {
          model: config.model.id,
          messages: [
            { role: 'system', content: SYNTHESIS_SYSTEM },
            {
              role: 'user',
              content: `Research topic: "${config.topic}"\n\nParallel source results:\n\n${combinedData}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 1200,
        },
      );
      synthesis = (synthResponse.choices[0]?.message?.content as string) ?? combinedData;
    } catch {
      synthesis = combinedData;
    }
  }

  return {
    topic: config.topic,
    subResults,
    synthesis,
    durationMs: Date.now() - start,
  };
}
