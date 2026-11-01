/**
 * Specialist Sub-Agent Execution Loop
 *
 * Runs a dedicated ReAct/JSON iteration loop for a specialist job.
 * Manages its own transcript, enforces tier tool allowlists, tracks token usage,
 * detects loops, strips reasoning blocks, and produces a validated final report.
 */

import { chatCompletion } from '../../llm/client';
import type { ProviderConfig, ChatMessage, Tool } from '../../llm/types';
import type { DiscoveredModel } from '../../llm/model-registry';
import { getSpecialistSystemPrompt } from './prompts';
import {
  type SpecialistJobState,
  type SpecialistReport,
  type SpecialistEditRecord,
  SPECIALIST_CDP_TOOLS,
} from './types';
import { stripThinkingBlocks, parseSpecialistAction } from './json-action-protocol';
import { cdpSession } from '../devtools/cdp-session';
import { isDevToolsBlockedUrl } from '../devtools/policy';
import {
  inspectElement,
  readConsole,
  readNetwork,
  readStorage,
  getAxTree,
  editElement,
  editStyles,
  liveEditScript,
  mockRequest,
  runInPage,
  trustedClick,
  trustedType,
  undoDevToolsEdit,
  devToolsStatus,
} from '../devtools/tools';
import { AGENT_TOOLS } from '../tools';
import { wrapUntrustedContent } from '../prompts';
import { recordWorkerUsage, checkBudget } from '../cost-guard';

export interface SpecialistRunnerCallbacks {
  onProgress?: (job: SpecialistJobState, step: number, status: string, detail?: string) => void;
  onHITLRequired?: (details: {
    actor: string;
    model: string;
    action: unknown;
    reason: string;
  }) => Promise<boolean>;
}

export class SpecialistRunner {
  private job: SpecialistJobState;
  private providerConfig: ProviderConfig;
  private model: DiscoveredModel;
  private callbacks: SpecialistRunnerCallbacks;
  private abortController = new AbortController();
  private transcript: ChatMessage[] = [];
  private totalTokensUsed = 0;
  private isInterrupted = false;

  constructor(
    job: SpecialistJobState,
    providerConfig: ProviderConfig,
    model: DiscoveredModel,
    callbacks: SpecialistRunnerCallbacks = {},
  ) {
    this.job = job;
    this.providerConfig = providerConfig;
    this.model = model;
    this.callbacks = callbacks;
  }

  public abort(): void {
    this.isInterrupted = true;
    this.abortController.abort();
    this.job.status = 'cancelled';
  }

  public async run(): Promise<SpecialistReport> {
    const actor = `specialist:${this.model.id}:${this.job.id}`;
    const allowedToolNames = SPECIALIST_CDP_TOOLS[this.job.effectiveTier] || SPECIALIST_CDP_TOOLS.T0;
    const toolsForModel: Tool[] = AGENT_TOOLS.filter((t) => allowedToolNames.includes(t.function.name));

    const systemPrompt = getSpecialistSystemPrompt(
      this.job.role,
      this.job.goal,
      this.job.effectiveTier,
      this.job.tabId,
      allowedToolNames,
    );

    this.transcript = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `GOAL: ${this.job.goal}${this.job.context ? `\nCONTEXT: ${this.job.context}` : ''}\nBegin your investigation using your authorized tools.`,
      },
    ];

    const nativeToolsSupported = this.model.supportsTools !== false;
    this.job.status = 'running';
    this.callbacks.onProgress?.(this.job, 0, 'running', `Initialized (${nativeToolsSupported ? 'Native' : 'JSON-Protocol'})`);

    let consecutiveErrors = 0;
    const actionHistory: string[] = [];
    const findings: string[] = [];
    const edits: SpecialistEditRecord[] = [];
    const unresolved: string[] = [];

    // Wall-clock timeout (120s)
    const timeoutHandle = setTimeout(() => {
      this.abort();
    }, 120_000);

    try {
      while (this.job.stepCount < this.job.maxSteps && !this.isInterrupted) {
        this.job.stepCount++;

        // 1. Budget check
        const { costLimits } = (await chrome.storage.local.get(['costLimits'])) as { costLimits?: import('../cost-guard').CostLimits };
        const budget = await checkBudget(1500, 1.0, costLimits);
        if (!budget.allowed) {
          return this.createFinalReport(
            'budget',
            `Budget exhausted: ${budget.reason}. (You can reset today's usage in Settings -> "Reset Today's Usage" or increase limits in "Hard Token & Cost Ceilings")`,
            findings,
            edits,
            unresolved,
          );
        }

        // 2. Tab domain safety check
        try {
          const tab = await chrome.tabs.get(this.job.tabId);
          if (tab?.url) {
            const { blocked, reason } = isDevToolsBlockedUrl(tab.url);
            if (blocked) {
              return this.createFinalReport('blocked', `Tab navigated to blocked domain (${tab.url}): ${reason}`, findings, edits, unresolved);
            }
          }
        } catch {
          return this.createFinalReport('failed', 'Target tab was closed or became unreachable.', findings, edits, unresolved);
        }

        // 3. LLM Completion
        this.callbacks.onProgress?.(this.job, this.job.stepCount, 'running', 'Querying specialist model...');

        let response: Awaited<ReturnType<typeof chatCompletion>>;
        try {
          response = await chatCompletion(
            this.providerConfig,
            {
              model: this.model.id,
              messages: this.transcript,
              tools: nativeToolsSupported ? toolsForModel : undefined,
              tool_choice: nativeToolsSupported ? 'auto' : undefined,
              temperature: 0.1,
              max_tokens: 2500,
            },
            {
              signal: this.abortController.signal,
              maxRetries: 1,
            },
          );
        } catch (llmErr) {
          if (this.isInterrupted) {
            return this.createFinalReport('cancelled', 'Job was cancelled or aborted.', findings, edits, unresolved);
          }
          const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            return this.createFinalReport('failed', `Model invocation failed repeatedly: ${msg}`, findings, edits, unresolved);
          }
          continue;
        }

        if (response.usage) {
          this.totalTokensUsed += response.usage.total_tokens;
          recordWorkerUsage(actor, response.usage.total_tokens);
        }

        const choice = response.choices[0];
        if (!choice?.message) {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) break;
          continue;
        }

        const rawContent = choice.message.content || '';
        const cleanContent = stripThinkingBlocks(rawContent);

        // 4. Handle Native Tool Calling vs JSON Action Protocol
        const nativeToolCalls = choice.message.tool_calls;

        if (nativeToolsSupported && nativeToolCalls && nativeToolCalls.length > 0) {
          consecutiveErrors = 0;
          this.transcript.push({
            role: 'assistant',
            content: cleanContent,
            tool_calls: nativeToolCalls,
          });

          for (const tc of nativeToolCalls) {
            const toolName = tc.function.name;
            let toolArgs: Record<string, unknown> = {};
            try {
              toolArgs = JSON.parse(tc.function.arguments || '{}');
            } catch { /* ignore */ }

            // Loop detection
            const callSig = `${toolName}:${JSON.stringify(toolArgs)}`;
            actionHistory.push(callSig);
            if (this.detectRepeatedLoop(actionHistory)) {
              return this.createFinalReport('blocked', `Detected repeated loop on ${toolName}. Terminating.`, findings, edits, unresolved);
            }

            const toolResult = await this.executeSpecialistTool(toolName, toolArgs, actor, edits, findings);
            this.transcript.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: wrapUntrustedContent(actor, toolResult),
            });
          }
          continue;
        }

        // Fallback: JSON action protocol parser
        const actionParse = parseSpecialistAction(cleanContent);
        if (actionParse.type === 'final') {
          // Specialist signaled completion with final report
          const finalRep = actionParse.report;
          finalRep.stepsUsed = this.job.stepCount;
          finalRep.tokens = this.totalTokensUsed;
          finalRep.edits = edits;
          return finalRep;
        }

        if (actionParse.type === 'tool') {
          consecutiveErrors = 0;
          const { tool: toolName, args: toolArgs } = actionParse.action;

          // Loop detection
          const callSig = `${toolName}:${JSON.stringify(toolArgs)}`;
          actionHistory.push(callSig);
          if (this.detectRepeatedLoop(actionHistory)) {
            return this.createFinalReport('blocked', `Detected repeated loop on ${toolName}. Terminating.`, findings, edits, unresolved);
          }

          this.transcript.push({ role: 'assistant', content: cleanContent });
          const toolResult = await this.executeSpecialistTool(toolName, toolArgs, actor, edits, findings);
          this.transcript.push({
            role: 'user',
            content: `TOOL_RESULT for ${toolName}:\n${wrapUntrustedContent(toolResult, actor)}`,
          });
          continue;
        }

        // Invalid JSON output - attempt 1 repair retry
        if (actionParse.type === 'invalid') {
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            return this.createFinalReport('failed', `Repeated invalid output from specialist model: ${actionParse.error}`, findings, edits, unresolved);
          }
          this.transcript.push({ role: 'assistant', content: cleanContent });
          this.transcript.push({
            role: 'user',
            content: `REPAIR_REQUIRED: Your output was not valid JSON. Please reply ONLY with a valid tool action {"tool": "...", "args": {...}} or final report {"final": {...}}. Error: ${actionParse.error}`,
          });
        }
      }

      if (this.isInterrupted) {
        return this.createFinalReport('cancelled', 'Specialist job was cancelled.', findings, edits, unresolved);
      }

      return this.createFinalReport('done', `Completed allocated max steps (${this.job.stepCount}/${this.job.maxSteps}).`, findings, edits, unresolved);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private detectRepeatedLoop(history: string[]): boolean {
    if (history.length < 3) return false;
    const last = history[history.length - 1];
    return history[history.length - 2] === last && history[history.length - 3] === last;
  }

  private async executeSpecialistTool(
    name: string,
    args: Record<string, unknown>,
    actor: string,
    edits: SpecialistEditRecord[],
    findings: string[],
  ): Promise<string> {
    const allowed = SPECIALIST_CDP_TOOLS[this.job.effectiveTier] || [];
    if (!allowed.includes(name)) {
      return `TOOL_DENIED: "${name}" is not permitted for specialist role "${this.job.role}" at tier "${this.job.effectiveTier}".`;
    }

    const hitlWrapper = async (action: unknown, reason: string): Promise<boolean> => {
      if (!this.callbacks.onHITLRequired) return false;
      return this.callbacks.onHITLRequired({
        actor,
        model: this.model.id,
        action,
        reason,
      });
    };

    const ctx = {
      tabId: this.job.tabId,
      isAutonomous: false,
      onHITLRequired: hitlWrapper,
    };

    try {
      let res = '';
      switch (name) {
        case 'inspect_element':
          res = await inspectElement(ctx, args as { selector?: string; nodeId?: number });
          findings.push(`Inspected ${args.selector || args.nodeId || 'element'}`);
          break;
        case 'read_console':
          res = await readConsole(ctx, args as { level?: 'error' | 'warning' | 'log' | 'all' });
          break;
        case 'read_network':
          res = await readNetwork(ctx, args as { includeResponseBody?: boolean; filter?: string });
          break;
        case 'read_storage':
          res = await readStorage(ctx, args as { type: 'localStorage' | 'sessionStorage' | 'cookies' });
          break;
        case 'get_ax_tree':
          res = await getAxTree(ctx, args as { maxDepth?: number });
          break;
        case 'edit_element':
          res = await editElement(ctx, args as { selector: string; outerHTML?: string; attributeName?: string; attributeValue?: string });
          edits.push({
            undoId: crypto.randomUUID(),
            kind: 'html',
            target: String(args.selector || 'element'),
            description: args.outerHTML ? 'Modified outerHTML' : `Set attribute ${args.attributeName}`,
          });
          break;
        case 'edit_styles':
          res = await editStyles(ctx, args as { selector: string; cssText: string });
          edits.push({
            undoId: crypto.randomUUID(),
            kind: 'style',
            target: String(args.selector || 'element'),
            description: `Applied styles: ${String(args.cssText || '').slice(0, 40)}`,
          });
          break;
        case 'live_edit_script':
          res = await liveEditScript(ctx, args as { scriptId: string; newSource: string });
          edits.push({
            undoId: crypto.randomUUID(),
            kind: 'script',
            target: String(args.scriptId),
            description: 'Live-edited V8 script source',
          });
          break;
        case 'mock_request':
          res = await mockRequest(ctx, args as { urlPattern: string; responseCode?: number; responseBody?: string });
          break;
        case 'run_in_page':
          res = await runInPage(ctx, args as { expression: string });
          break;
        case 'trusted_click':
          res = await trustedClick(ctx, args as { x: number; y: number; clickLabel?: string });
          break;
        case 'trusted_type':
          res = await trustedType(ctx, args as { text: string; fieldName?: string });
          break;
        case 'undo_devtools_edit':
          res = await undoDevToolsEdit(ctx);
          break;
        case 'devtools_status':
          res = await devToolsStatus(ctx);
          break;
        default:
          return `UNKNOWN_SPECIALIST_TOOL: Tool "${name}" is not implemented.`;
      }
      return res;
    } catch (err) {
      return `TOOL_EXECUTION_ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private createFinalReport(
    status: SpecialistReport['status'],
    summary: string,
    findings: string[],
    edits: SpecialistEditRecord[],
    unresolved: string[],
  ): SpecialistReport {
    this.job.status = status;
    return {
      status,
      summary,
      findings,
      edits,
      unresolved,
      stepsUsed: this.job.stepCount,
      tokens: this.totalTokensUsed,
    };
  }
}
