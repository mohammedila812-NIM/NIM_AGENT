/**
 * NIM Brain — Knowledge Graph DB (Phase 3)
 *
 * Persistent entity-relationship graph stored in IndexedDB.
 * Survives across browser sessions. Passively fills as the agent browses.
 *
 * Schema:
 *   nodes:  { id, label, type, attributes, seenCount, firstSeen, lastSeen }
 *   edges:  { id, fromId, toId, relation, weight, updatedAt }
 *
 * Design principles:
 *   - Pure IndexedDB wrapper (no chrome.* APIs) — works in any context
 *   - Idempotent upserts: re-inserting the same entity merges attributes
 *   - Full-text search via cursor scan (no external index needed)
 *   - Capped at 10,000 nodes to avoid unbounded storage growth
 */

const DB_NAME = 'nim-knowledge-graph';
const DB_VERSION = 1;
const MAX_NODES = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type NodeType =
  | 'product'
  | 'person'
  | 'organization'
  | 'location'
  | 'concept'
  | 'price'
  | 'date'
  | 'stat'
  | 'source'
  | 'file'
  | 'unknown';

export interface GraphNode {
  id: string;                          // sha1-like: label + type slug
  label: string;                       // e.g. "Sony WH-1000XM5"
  type: NodeType;
  attributes: Record<string, string>;  // e.g. { price: "$349", rating: "4.8" }
  sourceUrl?: string;
  seenCount: number;
  firstSeen: number;                   // Unix ms
  lastSeen: number;
}

export interface GraphEdge {
  id: string;                          // fromId + relation + toId
  fromId: string;
  toId: string;
  relation: string;                    // e.g. "made_by", "priced_at", "found_on"
  weight: number;                      // 1 = single observation; increments on repeat
  updatedAt: number;
}

export interface GraphQueryResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: string;                     // Human-readable summary for agent context
}

// ─── DB Initialization ────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Nodes store
      if (!db.objectStoreNames.contains('nodes')) {
        const nodeStore = db.createObjectStore('nodes', { keyPath: 'id' });
        nodeStore.createIndex('label', 'label', { unique: false });
        nodeStore.createIndex('type', 'type', { unique: false });
        nodeStore.createIndex('lastSeen', 'lastSeen', { unique: false });
      }

      // Edges store
      if (!db.objectStoreNames.contains('edges')) {
        const edgeStore = db.createObjectStore('edges', { keyPath: 'id' });
        edgeStore.createIndex('fromId', 'fromId', { unique: false });
        edgeStore.createIndex('toId', 'toId', { unique: false });
        edgeStore.createIndex('relation', 'relation', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── ID Generation ────────────────────────────────────────────────────────────

/** Simple deterministic ID from label + type (no crypto API needed). */
function makeNodeId(label: string, type: NodeType): string {
  const slug = `${type}:${label.toLowerCase().trim().replace(/\s+/g, '_').slice(0, 64)}`;
  return slug;
}

function makeEdgeId(fromId: string, relation: string, toId: string): string {
  return `${fromId}--${relation}--${toId}`;
}

// ─── Node CRUD ────────────────────────────────────────────────────────────────

/**
 * Upsert a node into the graph.
 * If the node already exists: merges attributes, increments seenCount, updates lastSeen.
 * If new: inserts with seenCount=1.
 */
export async function upsertNode(
  label: string,
  type: NodeType,
  attributes: Record<string, string> = {},
  sourceUrl?: string,
): Promise<GraphNode> {
  const db = await openDB();
  const id = makeNodeId(label, type);
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('nodes', 'readwrite');
    const store = tx.objectStore('nodes');

    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as GraphNode | undefined;
      const node: GraphNode = existing
        ? {
            ...existing,
            attributes: { ...existing.attributes, ...attributes },
            sourceUrl: sourceUrl ?? existing.sourceUrl,
            seenCount: existing.seenCount + 1,
            lastSeen: now,
          }
        : {
            id,
            label,
            type,
            attributes,
            sourceUrl,
            seenCount: 1,
            firstSeen: now,
            lastSeen: now,
          };

      const putReq = store.put(node);
      putReq.onsuccess = () => resolve(node);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Upsert an edge between two nodes.
 * If edge already exists, increments weight.
 */
export async function upsertEdge(
  fromId: string,
  relation: string,
  toId: string,
): Promise<GraphEdge> {
  const db = await openDB();
  const id = makeEdgeId(fromId, relation, toId);
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('edges', 'readwrite');
    const store = tx.objectStore('edges');

    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as GraphEdge | undefined;
      const edge: GraphEdge = existing
        ? { ...existing, weight: existing.weight + 1, updatedAt: now }
        : { id, fromId, toId, relation, weight: 1, updatedAt: now };

      const putReq = store.put(edge);
      putReq.onsuccess = () => resolve(edge);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Retrieve a single node by id. */
export async function getNode(id: string): Promise<GraphNode | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('nodes', 'readonly');
    const req = tx.objectStore('nodes').get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

/** Get all edges where fromId or toId matches the given node id. */
export async function getEdgesForNode(nodeId: string): Promise<GraphEdge[]> {
  const db = await openDB();

  const [fromEdges, toEdges] = await Promise.all([
    new Promise<GraphEdge[]>((resolve, reject) => {
      const tx = db.transaction('edges', 'readonly');
      const idx = tx.objectStore('edges').index('fromId');
      const req = idx.getAll(nodeId);
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    }),
    new Promise<GraphEdge[]>((resolve, reject) => {
      const tx = db.transaction('edges', 'readonly');
      const idx = tx.objectStore('edges').index('toId');
      const req = idx.getAll(nodeId);
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    }),
  ]);

  return [...fromEdges, ...toEdges];
}

// ─── Full-Text Search ─────────────────────────────────────────────────────────

/**
 * Full-text search across all nodes.
 * Scans label + type + attribute values for the keyword (case-insensitive).
 * Returns up to `limit` most-recently-seen matching nodes.
 */
export async function searchNodes(keyword: string, limit = 20): Promise<GraphNode[]> {
  const db = await openDB();
  const lower = keyword.toLowerCase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('nodes', 'readonly');
    const store = tx.objectStore('nodes');
    const results: GraphNode[] = [];

    const req = store.openCursor(null, 'prev'); // newest first
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || results.length >= limit) {
        resolve(results.sort((a, b) => b.seenCount - a.seenCount));
        return;
      }
      const node = cursor.value as GraphNode;
      const searchable = [
        node.label,
        node.type,
        ...Object.values(node.attributes),
        node.sourceUrl ?? '',
      ].join(' ').toLowerCase();

      if (searchable.includes(lower)) {
        results.push(node);
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// ─── Graph Query (Agent Tool) ─────────────────────────────────────────────────

/**
 * High-level query: find nodes matching keyword + their immediate neighbors.
 * Returns a `GraphQueryResult` with both data and a human-readable summary.
 */
export async function queryGraph(keyword: string, maxNodes = 10): Promise<GraphQueryResult> {
  const nodes = await searchNodes(keyword, maxNodes);

  if (nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      summary: `No knowledge found for "${keyword}". The graph has not yet observed this topic.`,
    };
  }

  // Gather edges for all matched nodes
  const allEdgeArrays = await Promise.all(nodes.map(n => getEdgesForNode(n.id)));
  const edgeMap = new Map<string, GraphEdge>();
  for (const arr of allEdgeArrays) {
    for (const e of arr) edgeMap.set(e.id, e);
  }
  const edges = [...edgeMap.values()];

  // Build node lookup
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Generate human-readable summary (compact, token-efficient)
  const lines: string[] = [`**Knowledge Graph — "${keyword}" (${nodes.length} nodes found):**\n`];
  for (const node of nodes) {
    const attrs = Object.entries(node.attributes)
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    lines.push(`• **${node.label}** [${node.type}]${attrs ? ` — ${attrs}` : ''}`);

    // Add outgoing relationships
    const nodeEdges = edges.filter(e => e.fromId === node.id);
    for (const edge of nodeEdges.slice(0, 3)) {
      const target = nodeMap.get(edge.toId);
      if (target) {
        lines.push(`  → ${edge.relation}: **${target.label}**`);
      }
    }
  }

  return { nodes, edges, summary: lines.join('\n') };
}

// ─── Storage Stats ────────────────────────────────────────────────────────────

export async function getGraphStats(): Promise<{ nodeCount: number; edgeCount: number }> {
  const db = await openDB();
  const [nodeCount, edgeCount] = await Promise.all([
    new Promise<number>((resolve, reject) => {
      const req = db.transaction('nodes', 'readonly').objectStore('nodes').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
    new Promise<number>((resolve, reject) => {
      const req = db.transaction('edges', 'readonly').objectStore('edges').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }),
  ]);
  return { nodeCount, edgeCount };
}

/** Wipe the entire graph (used in tests or user-initiated reset). */
export async function clearGraph(): Promise<void> {
  const db = await openDB();
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      const req = db.transaction('nodes', 'readwrite').objectStore('nodes').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }),
    new Promise<void>((resolve, reject) => {
      const req = db.transaction('edges', 'readwrite').objectStore('edges').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }),
  ]);
}
