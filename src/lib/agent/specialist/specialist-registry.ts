/**
 * Specialist Sub-Agent Registry & Lifecycle Coordinator
 *
 * Manages async job queues, persists state to chrome.storage.session,
 * tracks active runners, handles tab locking, drains reports for the main engine,
 * and recovers jobs after service worker restarts.
 */

import {
  type SpecialistRole,
  type SpecialistJobState,
  type SpecialistReport,
  type SpecialistSettings,
  computeEffectiveSpecialistTier,
} from './types';
import { tabLockManager } from './tab-lock';
import { SpecialistRunner, type SpecialistRunnerCallbacks } from './specialist-runner';
import { cdpSession } from '../devtools/cdp-session';
import { type DevToolsTier, TIER_LEVELS, getDevToolsSessionTier, setDevToolsSessionTier } from '../devtools/policy';
import { loadSpecialistSettings, loadWorkerConfig, loadProviderKeys } from '../../storage/secure';
import { getPreset } from '../../llm/providers';
import type { ProviderConfig } from '../../llm/types';
import type { DiscoveredModel } from '../../llm/model-registry';

const JOB_SESSION_KEY_PREFIX = 'specialist_job_';

class SpecialistRegistry {
  private activeRunners = new Map<string, SpecialistRunner>();
  private completedReportsToDrain = new Map<string, SpecialistJobState[]>(); // parentTaskId -> jobs

  /**
   * Spawns a new specialist job.
   */
  async startJob(
    parentTaskId: string,
    params: {
      role: SpecialistRole;
      goal: string;
      context?: string;
      maxTier: 'T0' | 'T1' | 'T2' | 'T3';
      maxSteps?: number;
      tabId: number;
      isAutonomous?: boolean;
    },
    callbacks: SpecialistRunnerCallbacks = {},
  ): Promise<{ success: boolean; job?: SpecialistJobState; error?: string }> {
    const settings = await loadSpecialistSettings();

    // 1. Enforce per-task job cap & concurrency limits
    const existingJobs = await this.listJobsForTask(parentTaskId);
    if (existingJobs.length >= settings.perTaskJobCap) {
      return {
        success: false,
        error: `JOB_CAP_REACHED: Task has already spawned max ${settings.perTaskJobCap} specialist jobs.`,
      };
    }

    const runningJobs = existingJobs.filter((j) => j.status === 'running' || j.status === 'pending');
    if (runningJobs.length >= settings.maxConcurrentJobs) {
      return {
        success: false,
        error: `CONCURRENCY_LIMIT: Maximum concurrent specialist jobs (${settings.maxConcurrentJobs}) already active.`,
      };
    }

    // 2. Compute effective tier
    const localSettings = await chrome.storage.local.get(['activeProviderId', 'customBaseUrl', 'devtoolsMaxTier']);
    const sessionTier = await getDevToolsSessionTier(params.tabId);
    const configuredDevtoolsMax = (localSettings.devtoolsMaxTier as DevToolsTier) || settings.tierCeiling || 'T2';
    const userGrantedTier = sessionTier && TIER_LEVELS[sessionTier] > TIER_LEVELS[configuredDevtoolsMax]
      ? sessionTier
      : configuredDevtoolsMax;

    const tierCheck = computeEffectiveSpecialistTier(
      userGrantedTier,
      params.maxTier,
      settings.tierCeiling,
      params.isAutonomous,
      settings.allowAutonomousSpecialist,
    );

    if (!tierCheck.allowed) {
      return { success: false, error: tierCheck.reason };
    }

    const effectiveTier = tierCheck.effectiveTier;
    await setDevToolsSessionTier(params.tabId, effectiveTier);
    const jobId = `spec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 3. Tab Mutating Lock (if T2 or T3)
    const lockRes = tabLockManager.acquireLock(params.tabId, jobId, params.role, effectiveTier);
    if (!lockRes.success && lockRes.existingLock) {
      return {
        success: false,
        error: `TAB_LOCKED: Tab #${params.tabId} is currently locked by active specialist job "${lockRes.existingLock.jobId}" (${lockRes.existingLock.role}).`,
      };
    }

    // 4. Resolve Model & Provider
    const roleConfig = settings.roles?.[params.role];
    const activeProviderId = (localSettings.activeProviderId as string) || 'nim-cloud';

    let providerId = roleConfig?.providerId?.trim() || activeProviderId;
    let modelId = roleConfig?.modelId?.trim() || 'meta/llama-3.3-70b-instruct';
    let apiKey = roleConfig?.apiKey?.trim() || '';

    // Enforce cross-provider setting
    if (providerId !== activeProviderId && !settings.allowCrossProvider) {
      return {
        success: false,
        error: `CROSS_PROVIDER_BLOCKED: Specialist role "${params.role}" is configured with provider "${providerId}", but the main agent is on "${activeProviderId}". To allow data to be sent to a secondary provider, please enable "Allow Cross-Provider Specialist" in Settings.`,
      };
    }

    // Resolve API key if not explicitly set on the role
    if (!apiKey) {
      const providerKeys = await loadProviderKeys(providerId);
      if (providerKeys?.llmApiKey) {
        apiKey = providerKeys.llmApiKey.trim();
      }

      if (!apiKey && providerId === activeProviderId) {
        const activeKeys = await loadProviderKeys(activeProviderId);
        if (activeKeys?.llmApiKey) {
          apiKey = activeKeys.llmApiKey.trim();
        }
      }

      if (!apiKey) {
        const worker = await loadWorkerConfig();
        if (worker?.apiKey && (worker.providerId === providerId || worker.providerId === activeProviderId)) {
          apiKey = worker.apiKey.trim();
        }
      }
    }

    const preset = getPreset(providerId);
    let baseUrl = roleConfig?.baseUrl?.trim() || '';
    if (!baseUrl) {
      if (providerId === 'custom') {
        baseUrl = (localSettings.customBaseUrl as string)?.trim() || 'http://localhost:8000/v1';
      } else {
        baseUrl = preset?.baseUrl || 'https://integrate.api.nvidia.com/v1';
      }
    }

    const providerConfig: ProviderConfig = {
      id: providerId,
      label: preset?.label || providerId,
      baseUrl,
      apiKey,
    };

    const model: DiscoveredModel = {
      id: modelId,
      contextLength: 128_000,
      supportsTools: true,
      supportsVision: false,
      isAgentTuned: true,
      providerLabel: providerId,
    };

    // 5. Initialize Job State
    const job: SpecialistJobState = {
      id: jobId,
      parentTaskId,
      role: params.role,
      goal: params.goal,
      context: params.context,
      tabId: params.tabId,
      providerId,
      modelId,
      effectiveTier,
      requestedTier: params.maxTier,
      maxSteps: Math.min(Math.max(params.maxSteps ?? settings.maxSteps, 1), 20),
      status: 'pending',
      stepCount: 0,
      edits: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.saveJobState(job);

    // 6. Launch Runner in background
    const runner = new SpecialistRunner(job, providerConfig, model, {
      onProgress: (j, step, status, detail) => {
        void this.saveJobState(j);
        callbacks.onProgress?.(j, step, status, detail);
      },
      onHITLRequired: callbacks.onHITLRequired,
    });

    this.activeRunners.set(jobId, runner);

    // Run execution asynchronously
    void (async () => {
      try {
        const report = await runner.run();
        job.report = report;
        job.status = report.status;
        job.completedAt = Date.now();
        await this.saveJobState(job);

        // Queue report to be drained by parent task
        const queue = this.completedReportsToDrain.get(parentTaskId) || [];
        queue.push(job);
        this.completedReportsToDrain.set(parentTaskId, queue);
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        await this.saveJobState(job);
      } finally {
        this.activeRunners.delete(jobId);
        tabLockManager.releaseLock(params.tabId, jobId);
      }
    })();

    return { success: true, job };
  }

  /**
   * Retrieves a job by ID from session storage.
   */
  async getJob(jobId: string): Promise<SpecialistJobState | null> {
    const key = `${JOB_SESSION_KEY_PREFIX}${jobId}`;
    const r = await chrome.storage.session.get(key);
    return (r[key] as SpecialistJobState | undefined) ?? null;
  }

  /**
   * Saves updated job state to session storage.
   */
  async saveJobState(job: SpecialistJobState): Promise<void> {
    job.updatedAt = Date.now();
    const key = `${JOB_SESSION_KEY_PREFIX}${job.id}`;
    await chrome.storage.session.set({ [key]: job });
  }

  /**
   * Lists all specialist jobs associated with a parent task.
   */
  async listJobsForTask(parentTaskId: string): Promise<SpecialistJobState[]> {
    const all = await chrome.storage.session.get(null);
    const jobs: SpecialistJobState[] = [];
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(JOB_SESSION_KEY_PREFIX)) {
        const j = v as SpecialistJobState;
        if (j.parentTaskId === parentTaskId) {
          jobs.push(j);
        }
      }
    }
    return jobs.sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Cancels a running specialist job.
   */
  async cancelJob(jobId: string): Promise<{ success: boolean; message: string }> {
    const runner = this.activeRunners.get(jobId);
    if (runner) {
      runner.abort();
      this.activeRunners.delete(jobId);
    }

    const job = await this.getJob(jobId);
    if (job) {
      job.status = 'cancelled';
      tabLockManager.releaseLock(job.tabId, jobId);
      await this.saveJobState(job);
      return { success: true, message: `Job ${jobId} cancelled successfully.` };
    }
    return { success: false, message: `Job ${jobId} not found.` };
  }

  /**
   * Cancels all specialist jobs for a given parent task (on stop/abort).
   */
  async cancelAllForTask(parentTaskId: string): Promise<void> {
    const jobs = await this.listJobsForTask(parentTaskId);
    for (const j of jobs) {
      if (j.status === 'running' || j.status === 'pending') {
        await this.cancelJob(j.id);
      }
    }
  }

  /**
   * Awaits completion of a specialist job up to timeoutMs (clamped).
   */
  async awaitJob(
    jobId: string,
    timeoutMs = 30_000,
  ): Promise<{ status: SpecialistJobState['status']; report?: SpecialistReport; error?: string }> {
    const clampedTimeout = Math.min(Math.max(timeoutMs, 1000), 120_000);
    const start = Date.now();

    while (Date.now() - start < clampedTimeout) {
      const job = await this.getJob(jobId);
      if (!job) return { status: 'failed', error: 'Job not found' };
      if (job.status !== 'running' && job.status !== 'pending') {
        return { status: job.status, report: job.report, error: job.error };
      }
      await new Promise((r) => setTimeout(r, 600));
    }

    return { status: 'running', error: 'Awaiting timed out' };
  }

  /**
   * Drains all completed reports queued for the parent task.
   */
  drainCompletedReports(parentTaskId: string): SpecialistJobState[] {
    const queued = this.completedReportsToDrain.get(parentTaskId) || [];
    this.completedReportsToDrain.delete(parentTaskId);
    return queued;
  }

  /**
   * Reverts all edits made by a specialist job in reverse order.
   */
  async rollbackJobEdits(jobId: string): Promise<{
    success: boolean;
    revertedCount: number;
    failedCount: number;
    details: string[];
  }> {
    const job = await this.getJob(jobId);
    if (!job) {
      return { success: false, revertedCount: 0, failedCount: 0, details: ['Job not found'] };
    }

    if (!job.edits || job.edits.length === 0) {
      return { success: true, revertedCount: 0, failedCount: 0, details: ['No edits were made by this specialist.'] };
    }

    let revertedCount = 0;
    let failedCount = 0;
    const details: string[] = [];

    // Revert in reverse order
    const reversed = [...job.edits].reverse();
    for (const edit of reversed) {
      try {
        const pop = cdpSession.popUndoSnapshot(job.tabId);
        if (pop) {
          revertedCount++;
          details.push(`Reverted ${edit.kind} edit on "${edit.target}"`);
        } else {
          failedCount++;
          details.push(`Undo snapshot missing for ${edit.kind} on "${edit.target}"`);
        }
      } catch (e) {
        failedCount++;
        details.push(`Failed to revert ${edit.kind} on "${edit.target}": ${e}`);
      }
    }

    return {
      success: failedCount === 0,
      revertedCount,
      failedCount,
      details,
    };
  }

  /**
   * Recovers orphaned jobs on Service Worker restart.
   */
  async recoverOrphanedJobs(): Promise<void> {
    const all = await chrome.storage.session.get(null);
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(JOB_SESSION_KEY_PREFIX)) {
        const job = v as SpecialistJobState;
        if (job.status === 'running' || job.status === 'pending') {
          job.status = 'failed';
          job.error = 'worker_restarted';
          await this.saveJobState(job);
        }
      }
    }
    tabLockManager.releaseAll();
    await cdpSession.detachOrphanedSessions();
  }
}

export const specialistRegistry = new SpecialistRegistry();
