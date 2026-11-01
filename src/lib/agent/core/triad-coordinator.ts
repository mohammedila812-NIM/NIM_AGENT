/**
 * Triad Coordinator (Phase 2 / Phase 3 Architecture)
 * Coordinates milestone checklist planning, before/after DOM snapshots,
 * CAPTCHA/2FA detection, visual spotlight flashing, and self-healing action validation.
 */

import type { ProviderConfig } from '../../llm/types';
import type { DiscoveredModel } from '../../llm/model-registry';
import type { ValidatedToolCall } from '../tools';
import {
  planMilestones,
  getActiveMilestone,
  completeMilestone,
  advanceMilestone,
  isChecklistComplete,
  renderChecklist,
  type MilestoneChecklist,
} from '../triad/planner';
import {
  captureSnapshot,
  validateActionOutcome,
  type PageSnapshot,
} from '../triad/validator';
import { executeFallback, detectSecurityChallenge } from '../triad/reflector';
import { flashSpotlight, showCaptchaHUD, removeCaptchaHUD } from '../triad/spotlight';
import { captureViewport } from '../tools/screenshot';
import { chatCompletion } from '../../llm/client';
import type { AgentRunCallbacks } from '../engine';

export interface TriadActionHookResult {
  snapshotBefore?: PageSnapshot;
}

export class TriadCoordinator {
  private checklist?: MilestoneChecklist;
  private captchaActive = false;

  public getChecklist(): MilestoneChecklist | undefined {
    return this.checklist;
  }

  public setChecklist(checklist: MilestoneChecklist): void {
    this.checklist = checklist;
  }

  /**
   * Initialize milestone checklist plan for the instruction if triadMode is active.
   * Returns a context string to inject into the system prompt, or undefined.
   */
  public async initializePlan(
    instruction: string,
    providerConfig: ProviderConfig,
    model: DiscoveredModel,
    callbacks: AgentRunCallbacks,
  ): Promise<string | undefined> {
    try {
      this.checklist = await planMilestones(instruction, providerConfig, model);
      advanceMilestone(this.checklist);
      callbacks.onPlanUpdate?.(this.checklist);
      return `\n\n[TASK PLAN]\n${renderChecklist(this.checklist)}\n\nWork through these milestones in order. After each action, verify the milestone is complete before moving on.`;
    } catch {
      // Planner failure is non-fatal — continue without checklist
      return undefined;
    }
  }

  /**
   * Detect and handle CAPTCHA / 2FA challenges before executing browser actions.
   */
  public async handleSecurityChallenge(
    tabId: number,
    callbacks: AgentRunCallbacks,
  ): Promise<void> {
    try {
      const challenge = await detectSecurityChallenge(tabId);
      if (challenge.detected && !this.captchaActive) {
        this.captchaActive = true;
        await showCaptchaHUD({
          type: challenge.type ?? 'unknown',
          message: challenge.message ?? 'Security challenge detected. Please solve it to continue.',
          tabId,
        });
        callbacks.onStatusChange?.(
          'hitl_waiting',
          challenge.message ?? 'Security challenge detected. Please solve it manually — NIM Agent will auto-resume.',
        );

        // Poll until challenge is cleared or dismissed by user (checks every 1.2s)
        for (let attempt = 0; attempt < 75; attempt++) {
          await new Promise((res) => setTimeout(res, 1200));
          const recheck = await detectSecurityChallenge(tabId);
          if (!recheck.detected) break;
        }

        await removeCaptchaHUD(tabId);
        this.captchaActive = false;
        callbacks.onStatusChange?.('running');
      }
    } catch {
      // CAPTCHA detection failure is non-fatal
    }
  }

  /**
   * Pre-action hook: Capture DOM snapshot and flash spotlight indicator.
   */
  public async beforeAction(
    tabId: number,
    tool: ValidatedToolCall,
  ): Promise<TriadActionHookResult> {
    let snapshotBefore: PageSnapshot | undefined;
    try {
      snapshotBefore = await captureSnapshot(tabId);
    } catch {
      // Non-fatal
    }

    if (['click_element', 'act_on_element'].includes(tool.tool)) {
      const target =
        (tool as { selector?: string; target?: string }).selector ??
        (tool as { target?: string }).target;
      try {
        void flashSpotlight(tabId, { selector: target });
      } catch {
        // Non-fatal
      }
    }

    return { snapshotBefore };
  }

  /**
   * Post-action hook: Capture after snapshot, validate outcome against active milestone,
   * trigger self-healing fallback if state was unchanged, and advance plan.
   */
  public async afterAction(
    tabId: number,
    tool: ValidatedToolCall,
    snapshotBefore: PageSnapshot | undefined,
    providerConfig: ProviderConfig,
    model: DiscoveredModel,
    callbacks: AgentRunCallbacks,
  ): Promise<{ feedbackNote?: string; isComplete?: boolean }> {
    if (!snapshotBefore || !this.checklist) {
      return {};
    }

    try {
      const snapshotAfter = await captureSnapshot(tabId);
      const activeMilestone = getActiveMilestone(this.checklist);
      if (!activeMilestone) {
        return {};
      }

      const outcome = await validateActionOutcome(
        activeMilestone,
        tool.tool,
        snapshotBefore,
        snapshotAfter,
        providerConfig,
        model,
      );

      if (outcome.verdict === 'passed') {
        completeMilestone(this.checklist, activeMilestone.id, outcome.evidence);
        advanceMilestone(this.checklist);
        callbacks.onPlanUpdate?.(this.checklist);

        if (isChecklistComplete(this.checklist)) {
          return {
            feedbackNote: `[Plan Complete: All milestones finished. Provide your final answer now.]`,
            isComplete: true,
          };
        }
      } else if (outcome.verdict === 'unchanged') {
        // If DOM state appeared unchanged, but the model supports vision:
        // Perform visual verification before concluding unchanged
        if (model.supportsVision) {
          try {
            const currentDataUrl = await captureViewport();
            const verifyPrompt = `You are the Visual Verification Auditor for NIM Agent.
The agent just executed the action: "${tool.tool}".
The target milestone is: "${activeMilestone.label}".
Look at the attached screenshot of the current page. Did this action visually achieve or progress toward this milestone?
Reply with JSON: {"achieved": true, "evidence": "<one-sentence visual evidence>"} OR {"achieved": false, "reason": "<what is missing>"}`;

            const vRes = await chatCompletion(providerConfig, {
              model: model.id,
              messages: [
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: verifyPrompt },
                    { type: 'image_url', image_url: { url: currentDataUrl, detail: 'low' } },
                  ],
                },
              ],
              max_tokens: 150,
              temperature: 0.1,
            });

            const rawJson = vRes.choices[0]?.message?.content || '{}';
            const match = rawJson.match(/\{[\s\S]*?\}/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              if (parsed.achieved === true) {
                completeMilestone(this.checklist, activeMilestone.id, `[Visual Verification Passed]: ${parsed.evidence}`);
                advanceMilestone(this.checklist);
                callbacks.onPlanUpdate?.(this.checklist);
                return {
                  feedbackNote: `[Visual Verification Passed]: Action confirmed visually (${parsed.evidence}). Milestone "${activeMilestone.label}" complete.`,
                  isComplete: isChecklistComplete(this.checklist),
                };
              }
            }
          } catch {
            // Visual check failure is non-fatal — fall through to standard fallback
          }
        }

        // Self-healing: execute fallback and return feedback note
        const fallbackResult = await executeFallback(tabId, outcome.suggestion);
        const feedbackNote = `[Self-Healing: Action had no effect. Executed fallback "${outcome.suggestion}": ${fallbackResult.note}. Retry or pivot your approach.]`;
        return { feedbackNote };
      }
    } catch {
      // Validation failure is non-fatal
    }

    return {};
  }
}
