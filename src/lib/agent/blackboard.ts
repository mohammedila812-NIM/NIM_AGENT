/**
 * Shared Inter-Agent Blackboard
 * Provides an in-memory/session pub-sub store and goal signaling bus for concurrent sub-agents.
 */

export interface Finding {
  sourceWorker: string;
  sourceUrl: string;
  key: string;
  value: string;
  timestamp: number;
}

export interface BlackboardState {
  findings: Finding[];
  goalSatisfied: boolean;
  goalSummary?: string;
}

const blackboards = new Map<string, BlackboardState>();

function getOrCreateBoard(groupId: string): BlackboardState {
  let board = blackboards.get(groupId);
  if (!board) {
    board = { findings: [], goalSatisfied: false };
    blackboards.set(groupId, board);
  }
  return board;
}

/** Publish a key research finding from a worker sub-agent. */
export function publishFinding(
  groupId: string,
  finding: Omit<Finding, 'timestamp'>,
): void {
  const board = getOrCreateBoard(groupId);
  board.findings.push({
    ...finding,
    timestamp: Date.now(),
  });
}

/** Get all findings published for a specific task group. */
export function getFindings(groupId: string): Finding[] {
  const board = blackboards.get(groupId);
  return board ? [...board.findings] : [];
}

/** Signal that a sub-agent has completely satisfied the research goal (enables early exit for siblings). */
export function signalGoalSatisfied(groupId: string, summary: string): void {
  const board = getOrCreateBoard(groupId);
  board.goalSatisfied = true;
  board.goalSummary = summary;
}

/** Check if the task goal has already been satisfied by any sibling sub-agent. */
export function isGoalSatisfied(groupId: string): { satisfied: boolean; summary?: string } {
  const board = blackboards.get(groupId);
  if (board && board.goalSatisfied) {
    return { satisfied: true, summary: board.goalSummary };
  }
  return { satisfied: false };
}

/** Clean up blackboard state when parent task completes. */
export function clearBlackboard(groupId: string): void {
  blackboards.delete(groupId);
}
