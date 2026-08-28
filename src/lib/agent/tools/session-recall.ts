import { queryTurns, getRecentTurns, formatTurnsAsRecall } from '../session-store';
import { listTasks, type StoredTask } from '../../storage/tasks';

/**
 * recall_session_history tool executor.
 *
 * Provides comprehensive on-demand recall across:
 * 1. Past tasks and their final answers in this session
 * 2. Intermediate tool steps, queries, and research extracts
 *
 * @param currentTaskId - The current task ID (to exclude from past task listing)
 * @param query         - Optional free-text keyword search
 * @param lastN         - Optional number of most recent turns/tasks to retrieve
 */
export async function recallSessionHistory(
  currentTaskId: string,
  query?: string,
  lastN?: number,
): Promise<string> {
  const limit = lastN ?? 5;

  // Retrieve stored tasks from local storage (excluding current active task)
  let pastTasks: StoredTask[] = [];
  try {
    const allTasks = await listTasks();
    pastTasks = allTasks.filter((t) => t.taskId !== currentTaskId);
  } catch {
    // Ignore storage read errors
  }

  // Filter past tasks if a specific query is provided
  if (query && query.trim().length > 0) {
    const kw = query.toLowerCase();
    const filteredTasks = pastTasks.filter(
      (t) =>
        t.instruction.toLowerCase().includes(kw) ||
        (t.result && t.result.toLowerCase().includes(kw)),
    );
    // If specific matches found, use them; otherwise keep the recent tasks for context
    if (filteredTasks.length > 0) {
      pastTasks = filteredTasks;
    }

    const turns = await queryTurns(currentTaskId, query.trim(), limit);
    return formatTurnsAsRecall(turns, pastTasks, query.trim());
  }

  // Retrieve most recent turns and past tasks
  const turns = await getRecentTurns(currentTaskId, limit);
  return formatTurnsAsRecall(turns, pastTasks);
}
