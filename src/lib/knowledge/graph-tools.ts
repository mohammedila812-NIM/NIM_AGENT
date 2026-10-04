/**
 * NIM Brain — Knowledge Graph Agent Tools (Phase 3)
 *
 * Three tools exposed to the agent:
 *
 *   knowledge_graph_query  — Search the graph by keyword, get enriched context
 *   knowledge_graph_add    — Manually add a node (agent can explicitly save a fact)
 *   knowledge_graph_relate — Manually link two existing nodes with a relation
 */

import { queryGraph, upsertNode, upsertEdge, getGraphStats, type NodeType } from './graph-db';

// ─── knowledge_graph_query ────────────────────────────────────────────────────

export interface KnowledgeGraphQueryArgs {
  keyword: string;
  maxNodes?: number;
}

/**
 * Query the persistent knowledge graph by keyword.
 * Returns a formatted summary of matching nodes and their relationships.
 * The agent uses this to recall facts from previous browsing sessions.
 */
export async function executeKnowledgeGraphQuery(args: KnowledgeGraphQueryArgs): Promise<string> {
  const { keyword, maxNodes = 10 } = args;

  if (!keyword?.trim()) {
    return 'ERROR: keyword is required for knowledge_graph_query.';
  }

  try {
    const result = await queryGraph(keyword.trim(), Math.min(maxNodes, 20));
    const stats = await getGraphStats();

    const header = `[Knowledge Graph — ${stats.nodeCount} nodes, ${stats.edgeCount} edges total]\n\n`;
    return header + result.summary;
  } catch (err) {
    return `[Knowledge Graph Error]: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── knowledge_graph_add ──────────────────────────────────────────────────────

export interface KnowledgeGraphAddArgs {
  label: string;
  type?: NodeType;
  attributes?: Record<string, string>;
  sourceUrl?: string;
}

/**
 * Manually add (or update) a node in the knowledge graph.
 * The agent calls this to explicitly save a fact it wants to remember
 * across future sessions.
 */
export async function executeKnowledgeGraphAdd(args: KnowledgeGraphAddArgs): Promise<string> {
  const { label, type, attributes, sourceUrl } = args;

  if (!label?.trim()) {
    return 'ERROR: label is required for knowledge_graph_add.';
  }

  try {
    const node = await upsertNode(
      label.trim(),
      (type as NodeType) ?? 'unknown',
      attributes ?? {},
      sourceUrl,
    );
    return `✅ Saved to Knowledge Graph: "${node.label}" [${node.type}] (seen ${node.seenCount}x). ID: ${node.id}`;
  } catch (err) {
    return `[Knowledge Graph Error]: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ─── knowledge_graph_relate ───────────────────────────────────────────────────

export interface KnowledgeGraphRelateArgs {
  fromLabel: string;
  fromType?: NodeType;
  relation: string;
  toLabel: string;
  toType?: NodeType;
}

/**
 * Create a relationship between two entities in the knowledge graph.
 * Automatically upserts the nodes if they don't yet exist.
 */
export async function executeKnowledgeGraphRelate(args: KnowledgeGraphRelateArgs): Promise<string> {
  const { fromLabel, fromType = 'unknown', relation, toLabel, toType = 'unknown' } = args;

  if (!fromLabel?.trim() || !toLabel?.trim() || !relation?.trim()) {
    return 'ERROR: fromLabel, relation, and toLabel are all required for knowledge_graph_relate.';
  }

  try {
    const [fromNode, toNode] = await Promise.all([
      upsertNode(fromLabel.trim(), fromType),
      upsertNode(toLabel.trim(), toType),
    ]);
    const edge = await upsertEdge(fromNode.id, relation.trim(), toNode.id);
    return `✅ Graph relation saved: "${fromNode.label}" →[${edge.relation}]→ "${toNode.label}" (weight: ${edge.weight})`;
  } catch (err) {
    return `[Knowledge Graph Error]: ${err instanceof Error ? err.message : String(err)}`;
  }
}
