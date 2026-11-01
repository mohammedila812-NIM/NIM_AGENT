/**
 * NIM Brain — Entity Extractor (Phase 3)
 *
 * LLM-powered passive entity and relationship extractor.
 * Called automatically (fire-and-forget) after web_search, read_page, extract_data.
 *
 * Design Principles:
 *   1. EXTRACT ONLY what is EXPLICITLY stated — no inferences, no invented prices.
 *   2. Minimal, token-efficient output: strict JSON only.
 *   3. Runs async in background — never blocks the agent ReAct loop.
 *   4. Falls back gracefully on any LLM failure (graph just doesn't update).
 *   5. Deduplicates aggressively — graph stays clean and compact.
 */

import { chatCompletion } from '../llm/client';
import { isChromeAIAvailable, promptChromeAI } from '../llm/chrome-ai';
import type { ProviderConfig } from '../llm/types';
import { upsertNode, upsertEdge, type NodeType } from './graph-db';
import { checkBudget, recordUsage, type CostLimits } from '../agent/cost-guard';
import { hostMatchesAny } from '../agent/sentinel/host-matcher';

export const SENSITIVE_EXTRACTION_DOMAINS = [
  // Webmail
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'mail.yahoo.com',
  'mail.proton.me',
  // Financial & Banking
  'paypal.com',
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'capitalone.com',
  'citi.com',
  'stripe.com',
  // Messaging & Private Chats
  'web.whatsapp.com',
  'instagram.com',
  'discord.com',
  'slack.com',
  'messenger.com',
  'telegram.org',
] as const;

export interface EntityExtractionOptions {
  enabled?: boolean;
  costLimits?: CostLimits;
  costPerMillion?: number;
}

// ─── Extraction Schema ────────────────────────────────────────────────────────

interface ExtractedEntity {
  label: string;
  type: NodeType;
  attributes?: Record<string, string>;
}

interface ExtractedRelation {
  from: string;  // entity label
  relation: string;
  to: string;    // entity label
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const EXTRACTOR_SYSTEM = `You are a precise knowledge graph entity extractor for NIM Agent.

Given a piece of web content or search results, extract:
1. ENTITIES — named things explicitly mentioned (products, companies, people, specs, prices)
2. RELATIONS — explicit links between entities ("Sony WH-1000XM5" → "made_by" → "Sony")

STRICT RULES:
- ONLY extract facts EXPLICITLY stated in the text. Never infer or hallucinate.
- Keep labels SHORT (1–5 words). Use canonical form ("Sony WH-1000XM5" not "the headphones").
- Entity types: product | person | organization | location | concept | price | date | stat | source | unknown
- Relation strings: use snake_case verbs (made_by, priced_at, released_in, found_on, competes_with, rated_at, has_spec, part_of)
- Attributes: include only concrete measurable properties (price, rating, year, count, size)
- Maximum 15 entities and 20 relations per call — prioritize the most important facts.
- Omit generic/trivial entities (e.g. "the product", "a website", "users").
- OUTPUT: ONLY valid JSON. No markdown, no explanation, no extra keys.

OUTPUT FORMAT:
{
  "entities": [
    { "label": "Sony WH-1000XM5", "type": "product", "attributes": { "price": "$279", "rating": "4.8" } },
    { "label": "Sony", "type": "organization" }
  ],
  "relations": [
    { "from": "Sony WH-1000XM5", "relation": "made_by", "to": "Sony" },
    { "from": "Sony WH-1000XM5", "relation": "priced_at", "to": "$279" }
  ]
}

If no meaningful entities are found, return: { "entities": [], "relations": [] }`;

// ─── Core Extractor ───────────────────────────────────────────────────────────

/**
 * Extract entities and relations from `text` and save them to the knowledge graph.
 * This is ALWAYS called fire-and-forget — never awaited from the main agent loop.
 *
 * @param text   - Page content, search snippet, or extracted data string
 * @param sourceUrl - URL where content was found (for provenance)
 * @param providerConfig - LLM config (uses a small/fast model)
 * @param modelId - Model to use (prefer fast model like gpt-4o-mini or gemini-flash)
 */
export async function extractAndStoreEntities(
  text: string,
  sourceUrl: string,
  providerConfig: ProviderConfig,
  modelId: string,
  options?: EntityExtractionOptions,
): Promise<void> {
  // Finding 25: Skip extraction if explicitly disabled or on sensitive domains
  if (options?.enabled === false) return;

  // Sensitive domain protection (webmail, banking, private messaging)
  try {
    if (sourceUrl.startsWith('http')) {
      const host = new URL(sourceUrl).hostname.toLowerCase();
      if (hostMatchesAny(host, SENSITIVE_EXTRACTION_DOMAINS)) {
        return; // Silently skip extraction on private webmail, banking, and chat sites
      }
    }
  } catch { /* ignore */ }

  // Skip if content is too short to have meaningful entities
  if (!text || text.trim().length < 80) return;

  // Truncate to ~3000 chars to keep extraction cheap
  const truncated = text.slice(0, 3000);

  // Cost guard: ensure background extraction respects user's configured limits
  const estimatedTokens = Math.ceil(truncated.length / 4) + 800;
  const costPerMillion = options?.costPerMillion ?? 0.5;
  try {
    const budget = await checkBudget(estimatedTokens, costPerMillion, options?.costLimits);
    if (!budget.allowed) {
      return; // Silently skip background extraction when budget limit reached
    }
  } catch {
    // Non-fatal budget check failure
  }

  let result: ExtractionResult | null = null;

  // 1. Try On-Device Chrome Built-in AI (Gemini Nano) first — zero tokens, 100% private & offline
  try {
    if (await isChromeAIAvailable()) {
      const nanoText = await promptChromeAI(
        EXTRACTOR_SYSTEM,
        `Source URL: ${sourceUrl}\n\nContent:\n${truncated}`,
      );
      if (nanoText) {
        const raw = nanoText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        result = JSON.parse(raw) as ExtractionResult;
      }
    }
  } catch {
    // Non-fatal — proceed to cloud completion
  }

  // 2. Cloud LLM Fallback (if on-device AI is unavailable or gave empty result)
  if (!result) {
    try {
      const response = await chatCompletion(
        providerConfig,
        {
          model: modelId,
          messages: [
            { role: 'system', content: EXTRACTOR_SYSTEM },
            {
              role: 'user',
              content: `Source URL: ${sourceUrl}\n\nContent:\n${truncated}`,
            },
          ],
          temperature: 0,
          max_tokens: 800,
        },
      );

      // Record usage so passive memory is metered under user's budget
      if (response.usage) {
        const totalTokens = response.usage.total_tokens || estimatedTokens;
        const costUsd = (totalTokens / 1_000_000) * costPerMillion;
        await recordUsage(totalTokens, costUsd).catch(() => {});
      }

      const raw = ((response.choices[0]?.message?.content as string) ?? '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      result = JSON.parse(raw) as ExtractionResult;
    } catch {
      // Extractor is non-critical — silently skip on any error
      return;
    }
  }

  if (!result?.entities?.length) return;

  // Upsert all entities into the graph
  const nodeIds = new Map<string, string>(); // label → nodeId
  for (const entity of result.entities) {
    if (!entity.label || entity.label.length < 2) continue;
    try {
      const node = await upsertNode(
        entity.label,
        entity.type ?? 'unknown',
        {
          ...entity.attributes,
          provenance: sourceUrl,
          untrusted: 'true',
          extractedAt: String(Date.now()),
        },
        sourceUrl,
      );
      nodeIds.set(entity.label, node.id);
    } catch {
      // Non-fatal — continue with remaining entities
    }
  }

  // Upsert all relations
  for (const rel of result.relations ?? []) {
    const fromId = nodeIds.get(rel.from);
    const toId = nodeIds.get(rel.to);
    if (!fromId || !toId || !rel.relation) continue;
    try {
      await upsertEdge(fromId, rel.relation, toId);
    } catch {
      // Non-fatal
    }
  }
}
