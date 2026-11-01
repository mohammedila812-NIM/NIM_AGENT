/**
 * Specialist Delegation System — Types & Schemas
 *
 * Defines roles, job lifecycle statuses, Zod schemas for reports,
 * authority levels, and configuration structures.
 */

import { z } from 'zod';
import type { DevToolsTier } from '../devtools/policy';
import { TIER_LEVELS } from '../devtools/policy';

export type SpecialistRole = 'coder' | 'debugger' | 'analyst';

export type SpecialistJobStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'budget'
  | 'interrupted';

// ── Specialist Edit Record ───────────────────────────────────────────────────

export const SpecialistEditRecordSchema = z.object({
  undoId: z.string(),
  kind: z.enum(['html', 'style', 'script']),
  target: z.string(),
  description: z.string(),
});
export type SpecialistEditRecord = z.infer<typeof SpecialistEditRecordSchema>;

// ── Specialist Final Report Schema ───────────────────────────────────────────

export const SpecialistReportSchema = z.object({
  status: z.enum(['done', 'blocked', 'failed', 'cancelled', 'budget']),
  summary: z.string(),
  findings: z.array(z.string()),
  edits: z.array(SpecialistEditRecordSchema),
  unresolved: z.array(z.string()),
  stepsUsed: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
});
export type SpecialistReport = z.infer<typeof SpecialistReportSchema>;

/**
 * Validates, normalizes, and sanitizes a raw specialist report into a valid SpecialistReport.
 * Enforces field guarantees, caps summary to 2000 chars to avoid context blowup.
 */
export function validateSpecialistReport(raw: unknown): SpecialistReport {
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    const summary = typeof obj.summary === 'string'
      ? (obj.summary.length > 2000 ? obj.summary.slice(0, 2000) + '...' : obj.summary)
      : 'Specialist completed execution.';
    const status = ['done', 'blocked', 'failed', 'cancelled', 'budget'].includes(obj.status as string)
      ? (obj.status as SpecialistReport['status'])
      : 'done';
    const findings = Array.isArray(obj.findings)
      ? obj.findings.map(String)
      : [];
    const edits = Array.isArray(obj.edits)
      ? obj.edits.filter((e): e is SpecialistEditRecord => SpecialistEditRecordSchema.safeParse(e).success)
      : [];
    const unresolved = Array.isArray(obj.unresolved)
      ? obj.unresolved.map(String)
      : [];
    const stepsUsed = typeof obj.stepsUsed === 'number' && Number.isFinite(obj.stepsUsed) && obj.stepsUsed >= 0
      ? Math.floor(obj.stepsUsed)
      : 1;
    const tokens = typeof obj.tokens === 'number' && Number.isFinite(obj.tokens) && obj.tokens >= 0
      ? Math.floor(obj.tokens)
      : 0;

    return {
      status,
      summary,
      findings,
      edits,
      unresolved,
      stepsUsed,
      tokens,
    };
  }

  return {
    status: 'failed',
    summary: 'Specialist returned invalid or empty report.',
    findings: [],
    edits: [],
    unresolved: ['Report was not a valid object.'],
    stepsUsed: 1,
    tokens: 0,
  };
}

// ── Specialist Job State (Session-Persisted) ──────────────────────────────────

export interface SpecialistJobState {
  id: string;
  parentTaskId: string;
  role: SpecialistRole;
  goal: string;
  context?: string;
  tabId: number;
  providerId: string;
  modelId: string;
  effectiveTier: DevToolsTier;
  requestedTier: DevToolsTier;
  maxSteps: number;
  status: SpecialistJobStatus;
  stepCount: number;
  edits: SpecialistEditRecord[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  report?: SpecialistReport;
  error?: string;
}

// ── Configuration & Settings ─────────────────────────────────────────────────

export interface SpecialistRoleConfig {
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface SpecialistSettings {
  roles: Record<SpecialistRole, SpecialistRoleConfig>;
  allowCrossProvider: boolean;
  tierCeiling: DevToolsTier;
  maxSteps: number;
  maxConcurrentJobs: number;
  perTaskJobCap: number;
  allowAutonomousSpecialist: boolean;
}

export const DEFAULT_SPECIALIST_SETTINGS: SpecialistSettings = {
  roles: {
    coder: {
      providerId: 'nim-cloud',
      modelId: 'deepseek-ai/deepseek-r1',
    },
    debugger: {
      providerId: 'nim-cloud',
      modelId: 'meta/llama-3.3-70b-instruct',
    },
    analyst: {
      providerId: 'nim-cloud',
      modelId: 'meta/llama-3.2-11b-vision-instruct',
    },
  },
  allowCrossProvider: false,
  tierCeiling: 'T2',
  maxSteps: 10,
  maxConcurrentJobs: 2,
  perTaskJobCap: 5,
  allowAutonomousSpecialist: false,
};

// ── Authority & Tier Computation ─────────────────────────────────────────────

const LEVEL_TO_TIER: Record<number, DevToolsTier> = {
  0: 'T0',
  1: 'T1',
  2: 'T2',
  3: 'T3',
};

/**
 * Computes the effective capability tier for a specialist job.
 * Enforces: effectiveTier = min(userGrantedTier, requestedTier, settingCeiling)
 * The main LLM can NEVER escalate beyond what the user or settings granted.
 */
export function computeEffectiveSpecialistTier(
  userGrantedTier: DevToolsTier,
  requestedTier: DevToolsTier,
  settingCeiling: DevToolsTier,
  isAutonomous = false,
  allowAutonomous = false,
): { allowed: boolean; effectiveTier: DevToolsTier; reason?: string } {
  if (isAutonomous) {
    if (!allowAutonomous) {
      return {
        allowed: false,
        effectiveTier: 'T0',
        reason: 'AUTONOMOUS_RESTRICTION: Specialist delegation is disabled in autonomous tasks by user setting.',
      };
    }
    // Autonomous contexts can never exceed T0
    return {
      allowed: true,
      effectiveTier: 'T0',
    };
  }

  const userLevel = TIER_LEVELS[userGrantedTier] ?? 0;
  const requestedLevel = TIER_LEVELS[requestedTier] ?? 0;
  const ceilingLevel = TIER_LEVELS[settingCeiling] ?? 2;

  const effectiveLevel = Math.min(userLevel, requestedLevel, ceilingLevel);
  const effectiveTier = LEVEL_TO_TIER[effectiveLevel] ?? 'T0';

  return {
    allowed: true,
    effectiveTier,
  };
}

// ── Specialist Tool Allowlist by Tier ─────────────────────────────────────────

export const SPECIALIST_CDP_TOOLS: Record<DevToolsTier, readonly string[]> = {
  T0: [
    'inspect_element',
    'read_console',
    'read_network',
    'get_ax_tree',
    'devtools_status',
  ],
  T1: [
    'inspect_element',
    'read_console',
    'read_network',
    'read_storage',
    'get_ax_tree',
    'devtools_status',
  ],
  T2: [
    'inspect_element',
    'read_console',
    'read_network',
    'read_storage',
    'get_ax_tree',
    'edit_element',
    'edit_styles',
    'live_edit_script',
    'mock_request',
    'undo_devtools_edit',
    'devtools_status',
  ],
  T3: [
    'inspect_element',
    'read_console',
    'read_network',
    'read_storage',
    'get_ax_tree',
    'edit_element',
    'edit_styles',
    'live_edit_script',
    'mock_request',
    'run_in_page',
    'trusted_click',
    'trusted_type',
    'undo_devtools_edit',
    'devtools_status',
  ],
};
