/**
 * Planner Agent — Phase 2 Triad
 *
 * Decomposes a user request into an explicit milestone checklist (3–5 items).
 * Inspired by Skyvern's multi-agent architecture.
 *
 * The planner runs once at the start of a task (or when replanning is needed)
 * and produces a structured MilestoneChecklist that the Actor+Validator consume.
 */

import { chatCompletion } from '../../llm/client';
import type { ProviderConfig } from '../../llm/types';
import type { DiscoveredModel } from '../../llm/model-registry';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Milestone {
  id: string;        // e.g. "m1", "m2"
  label: string;     // e.g. "Navigate to Amazon"
  status: 'pending' | 'active' | 'done' | 'failed';
  evidence?: string; // DOM/URL evidence that confirmed completion
  failReason?: string;
}

export interface MilestoneChecklist {
  taskSummary: string;
  milestones: Milestone[];
  createdAt: number;
}

// ─── System Prompt ─────────────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are the Planner component of a browser-automation agent named NIM Agent.

Your job is to decompose the user's task into a SHORT milestone checklist of 3–6 concrete, observable steps.

RULES:
1. Each milestone must have a SINGLE verifiable success condition (a URL change, a form submit, a data extraction).
2. Use active, imperative language: "Navigate to…", "Search for…", "Click the 'Add to cart' button", "Extract prices into workspace".
3. Do NOT include meta-steps like "plan the task", "decide approach", "check results".
4. Milestones must be sequential. If step N depends on step N-1, make that clear.
5. Keep the total milestone count to 6 or fewer. Merge trivially small steps.
6. Output ONLY valid JSON — no markdown, no explanation, no extra keys.

OUTPUT FORMAT (strict JSON):
{
  "taskSummary": "<one-sentence summary of the full task>",
  "milestones": [
    { "id": "m1", "label": "<step 1 description>" },
    { "id": "m2", "label": "<step 2 description>" }
  ]
}`;

// ─── Core Function ─────────────────────────────────────────────────────────

/**
 * Calls the LLM planner to decompose `instruction` into a milestone checklist.
 * Returns a fully typed MilestoneChecklist with all items set to 'pending'.
 */
export async function planMilestones(
  instruction: string,
  providerConfig: ProviderConfig,
  model: DiscoveredModel,
  existingContext?: string, // e.g. current URL or page title to ground the plan
): Promise<MilestoneChecklist> {
  const userContent = existingContext
    ? `Task: ${instruction}\n\nCurrent browser context: ${existingContext}`
    : `Task: ${instruction}`;

  const response = await chatCompletion(
    providerConfig,
    {
      model: model.id,
      messages: [
        { role: 'system', content: PLANNER_SYSTEM },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
    },
  );

  let parsed: { taskSummary: string; milestones: Array<{ id: string; label: string }> };

  try {
    // Strip possible markdown fences from model output
    const raw = ((response.choices[0]?.message?.content as string) ?? '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    parsed = JSON.parse(raw);
  } catch {
    // Fallback: treat the whole instruction as a single milestone
    parsed = {
      taskSummary: instruction,
      milestones: [{ id: 'm1', label: instruction }],
    };
  }

  const checklist: MilestoneChecklist = {
    taskSummary: parsed.taskSummary ?? instruction,
    milestones: (parsed.milestones ?? []).map(m => ({
      id: m.id,
      label: m.label,
      status: 'pending',
    })),
    createdAt: Date.now(),
  };

  return checklist;
}

// ─── Checklist Helpers ─────────────────────────────────────────────────────

/** Returns the first non-completed milestone (status === 'pending' or 'active'). */
export function getActiveMilestone(checklist: MilestoneChecklist): Milestone | null {
  return checklist.milestones.find(m => m.status === 'pending' || m.status === 'active') ?? null;
}

/** Marks a milestone done and attaches optional evidence string. */
export function completeMilestone(checklist: MilestoneChecklist, id: string, evidence?: string): void {
  const m = checklist.milestones.find(ms => ms.id === id);
  if (m) {
    m.status = 'done';
    m.evidence = evidence;
  }
}

/** Marks a milestone failed and records a reason. */
export function failMilestone(checklist: MilestoneChecklist, id: string, reason: string): void {
  const m = checklist.milestones.find(ms => ms.id === id);
  if (m) {
    m.status = 'failed';
    m.failReason = reason;
  }
}

/** Activates the next pending milestone. */
export function advanceMilestone(checklist: MilestoneChecklist): Milestone | null {
  const next = checklist.milestones.find(m => m.status === 'pending');
  if (next) {
    next.status = 'active';
  }
  return next ?? null;
}

/** Returns true when all milestones are done. */
export function isChecklistComplete(checklist: MilestoneChecklist): boolean {
  return checklist.milestones.every(m => m.status === 'done' || m.status === 'failed');
}

/** Renders the checklist as a human-readable markdown string for Side Panel display. */
export function renderChecklist(checklist: MilestoneChecklist): string {
  const lines = [`**${checklist.taskSummary}**\n`];
  for (const m of checklist.milestones) {
    const icon = m.status === 'done' ? '✅' : m.status === 'failed' ? '❌' : m.status === 'active' ? '⏳' : '⬜';
    lines.push(`${icon} **${m.id.toUpperCase()}**: ${m.label}`);
    if (m.evidence) lines.push(`   _↳ ${m.evidence}_`);
    if (m.failReason) lines.push(`   _↳ Failed: ${m.failReason}_`);
  }
  return lines.join('\n');
}
