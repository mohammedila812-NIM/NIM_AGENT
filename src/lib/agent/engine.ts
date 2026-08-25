import { chatCompletion } from '../llm/client';
import type { ChatMessage, ProviderConfig, ContentPart } from '../llm/types';
import type { DiscoveredModel } from '../llm/model-registry';
import { CHAT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT, classifyIntent, formatToolResult } from './prompts';
import { AGENT_TOOLS, validateToolCall, type ValidatedToolCall } from './tools';
import { sanitizeWithQuarantine, InjectionDetectedError } from './quarantine';
import { validateAction } from './action-validator';
import { checkBudget, recordUsage, type CostLimits } from './cost-guard';
import { saveCheckpoint, deleteCheckpoint, type AgentCheckpoint } from './checkpoint';
import { compressIfNeeded, estimateTokens } from './memory';
import { appendSecurityEvent } from '../security/audit-log';
import { appendResearchNote } from '../storage/tasks';
import type { SearchConfig } from './tools/web-search';
import { webSearch } from './tools/web-search';
import { navigateTo } from './tools/navigator';
import { captureViewport } from './tools/screenshot';
import { summarizeContent } from './tools/summarizer';
import { listTabs, switchTab, closeTab } from './tools/tab-manager';
import { extractTableFromPage } from './tools/table-extractor';
import { executeParallelSubagents } from './subagent-runner';
import { findElement, clickElement, executeClickWithCache, selectOptionElement, pressKeyOnElement } from './tools/clicker';
import { typeIntoElement, isSensitiveField } from './tools/typer';
import { waitForDOMSettle, waitForSelector } from './tools/wait-utils';
import { shouldUseFallbackVision } from './tools/interaction-policy';
import { fxClick, fxType, fxScroll, fxScan, fxNavigate, fxFlash } from './page-effects';
import { DESTRUCTIVE_KEYWORDS } from './security-patterns';

export interface AgentRunCallbacks {
  onStep?: (stepNumber: number, reasoning: string, toolCall?: ValidatedToolCall, result?: string) => void;
  onChunk?: (chunk: string) => void;
  onStatusChange?: (status: AgentCheckpoint['status'], detail?: string) => void;
  onHITLRequired?: (action: ValidatedToolCall, reason: string) => Promise<boolean>;
}

export interface AgentEngineConfig {
  providerConfig: ProviderConfig;
  workerProviderConfig?: ProviderConfig;
  workerModel?: DiscoveredModel;
  searchConfig?: SearchConfig;
  model: DiscoveredModel;
  quarantineModelId?: string;
  maxIterations?: number;
  costLimits?: CostLimits;
  visionOptIn?: boolean;
  pinnedTabId?: number;          // if set, all tool handlers target this tab
  initialHostname?: string;      // if set, domain lock is enforced for navigate_to
  toolAllowlist?: string[];      // restrict which AGENT_TOOLS this engine may call
}

export class AgentEngine {
  private taskId: string;
  private instruction: string;
  private config: AgentEngineConfig;
  private callbacks: AgentRunCallbacks;
  private isAborted = false;
  private budgetOverride = false;
  private scopeDomains: string[] = [];
  private failedDomAttempts = 0;
  private resolvedTabId?: number;
  private recentActionSignatures: string[] = [];

  constructor(
    taskId: string,
    instruction: string,
    config: AgentEngineConfig,
    callbacks: AgentRunCallbacks = {},
  ) {
    this.taskId = taskId;
    this.instruction = instruction;
    this.config = config;
    this.callbacks = callbacks;
  }

  public abort(): void {
    this.isAborted = true;
  }

  /** Resolve the tab ID to target - uses pinnedTabId if set, otherwise cached active tab */
  private async resolveTabId(): Promise<number> {
    if (this.config.pinnedTabId) return this.config.pinnedTabId;
    if (this.resolvedTabId) {
      try {
        const tab = await chrome.tabs.get(this.resolvedTabId);
        if (tab?.id) return tab.id;
      } catch {
        // Tab closed, re-query below
      }
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');
    this.resolvedTabId = tab.id;
    return this.resolvedTabId;
  }

  /** Run the ReAct loop from start or resumed checkpoint. */
  public async run(initialCheckpoint?: AgentCheckpoint): Promise<string> {
    const maxIters = this.config.maxIterations ?? 20;
    let currentStep = initialCheckpoint ? initialCheckpoint.currentStepIndex : 0;

    // ── Intent Classification ──────────────────────────────────────────────────
    // Pre-classify before first LLM call to choose prompt tier and skip tools
    // for pure chat — saves ~500–2000 tokens and eliminates tool-confusion on small models.
    const intent = initialCheckpoint ? 'agent' : classifyIntent(this.instruction);
    const isChatMode = intent === 'chat';

    let transcript: ChatMessage[] = initialCheckpoint
      ? initialCheckpoint.transcript
      : [
          { role: 'system', content: isChatMode ? CHAT_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT },
          { role: 'user', content: this.instruction },
        ];

    const actionLog = initialCheckpoint ? initialCheckpoint.actionLog : [];

    this.callbacks.onStatusChange?.('running');

    while (currentStep < maxIters && !this.isAborted) {
      currentStep++;

      // 1. Memory / Adaptive context compression
      transcript = await compressIfNeeded(
        transcript,
        this.config.model,
        (textToSummarize) =>
          summarizeContent(
            textToSummarize,
            undefined,
            this.config.providerConfig,
            this.config.quarantineModelId ?? this.config.model.id,
          ),
      );

      // 2. Dynamic Cost Guard check before LLM call
      if (!this.budgetOverride) {
        const estimatedTokens = estimateTokens(transcript) + 1000;
        const budgetCheck = await checkBudget(
          estimatedTokens,
          0.5, // estimated standard cost per million tokens
          this.config.costLimits,
        );

        if (!budgetCheck.allowed) {
          const promptReason = `${budgetCheck.reason}. Do you want to proceed above the limit or stop?`;
          this.callbacks.onStatusChange?.('hitl_waiting', promptReason);

          const approved = this.callbacks.onHITLRequired
            ? await this.callbacks.onHITLRequired(
                { tool: 'summarize', focus: 'budget_override' },
                promptReason,
              )
            : false;

          if (approved) {
            this.budgetOverride = true;
            this.callbacks.onStatusChange?.('running');
          } else {
            const errorMsg = `Agent paused: ${budgetCheck.reason}`;
            this.callbacks.onStatusChange?.('paused', errorMsg);
            await saveCheckpoint({
              version: 1,
              taskId: this.taskId,
              status: 'paused',
              currentStepIndex: currentStep,
              originalIntent: this.instruction,
              taskScopeDomains: this.scopeDomains,
              transcript,
              actionLog,
              timestamp: Date.now(),
            });
            return errorMsg;
          }
        }
      }

      // 3. Save checkpoint before LLM call
      await saveCheckpoint({
        version: 1,
        taskId: this.taskId,
        status: 'running',
        currentStepIndex: currentStep,
        originalIntent: this.instruction,
        taskScopeDomains: this.scopeDomains,
        transcript,
        actionLog,
        timestamp: Date.now(),
      });

      // 4. LLM call — chat mode sends no tools (saves ~1000 tokens, prevents tool confusion)
      let response;
      const interactiveTools = new Set(['click_element', 'type_text', 'select_option', 'press_key', 'navigate_to', 'scroll_page']);
      const hasInteractiveAction = transcript.some((m) =>
        m.role === 'assistant' &&
        m.tool_calls?.some((tc) => interactiveTools.has(tc.function.name))
      );
      const executedToolCount = transcript.filter(m => m.role === 'tool').length;
      const isNearLimit = currentStep >= maxIters - 2;
      const shouldUseTools = !isChatMode && this.config.model.supportsTools !== false && !isNearLimit;

      // Only nudge pure research queries (not interactive multi-step tasks) when gathered enough data
      let callTranscript = transcript;
      if (!isChatMode && !hasInteractiveAction && (executedToolCount >= 5 || isNearLimit)) {
        callTranscript = [
          ...transcript,
          {
            role: 'user',
            content:
              'You have gathered sufficient research data. Please compile and present your final ranked answer now in a clean markdown table with prices and key specs. Do not call any more tools.',
          },
        ];
      }

      try {
        response = await chatCompletion(this.config.providerConfig, {
          model: this.config.model.id,
          messages: callTranscript,
          tools: shouldUseTools ? AGENT_TOOLS : undefined,
          tool_choice: shouldUseTools ? 'auto' : undefined,
          temperature: isChatMode ? 0.7 : 0.2,
          max_tokens: isChatMode ? 400 : 2500,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);

        // Auto-fallback: If provider returns "does not support tools", retry without tools
        if (shouldUseTools && /does not support tools|tools not supported|function.*calling/i.test(msg)) {
          this.config.model.supportsTools = false;
          response = await chatCompletion(this.config.providerConfig, {
            model: this.config.model.id,
            messages: callTranscript,
            tools: undefined,
            tool_choice: undefined,
            temperature: 0.2,
            max_tokens: 2500,
          });
        } else {
          this.callbacks.onStatusChange?.('error', msg);
          throw err;
        }
      }

      const choice = response.choices[0];
      const assistantMessage = choice?.message;
      if (!assistantMessage) break;

      // Record actual tokens
      if (response.usage) {
        await recordUsage(response.usage.total_tokens, (response.usage.total_tokens / 1_000_000) * 0.5);
      }

      // Extract reasoning vs user-facing content
      let rawContent = typeof assistantMessage.content === 'string' ? assistantMessage.content : '';
      let reasoningContent = assistantMessage.reasoning_content || '';

      // Check for <think>...</think> tags in content
      const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/i);
      if (thinkMatch) {
        reasoningContent = reasoningContent ? `${reasoningContent}\n${thinkMatch[1]}` : thinkMatch[1];
        rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      }

      // Check for <reasoning>...</reasoning>
      const reasoningTagMatch = rawContent.match(/<reasoning>([\s\S]*?)<\/reasoning>/i);
      if (reasoningTagMatch) {
        reasoningContent = reasoningContent ? `${reasoningContent}\n${reasoningTagMatch[1]}` : reasoningTagMatch[1];
        rawContent = rawContent.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').trim();
      }

      const textContent = rawContent;
      const stepReasoning = (reasoningContent || '').trim();

      // ── Inline JSON & Text Tool Call Extraction ──────────────────────────────
      let toolCalls = assistantMessage.tool_calls;
      if ((!toolCalls || toolCalls.length === 0) && !isChatMode && textContent) {
        const cleanText = textContent.replace(/```(?:json)?\s*([\s\S]*?)\s*```/, '$1');
        const jsonMatches = cleanText.match(/\{[\s\S]*?\}/g);
        if (jsonMatches) {
          for (const rawJson of jsonMatches) {
            try {
              const normalized = rawJson
                .replace(/:\s*False\b/g, ': false')
                .replace(/:\s*True\b/g, ': true')
                .replace(/:\s*None\b/g, ': null');
              const parsed = JSON.parse(normalized) as Record<string, unknown>;
              const toolName = (parsed.name || parsed.tool || parsed.action) as string | undefined;
              if (toolName && typeof toolName === 'string') {
                const params = (parsed.parameters || (({ name: _n, tool: _t, action: _a, ...rest }) => rest)(parsed)) as Record<string, unknown>;
                toolCalls = [{
                  id: `inlined-${Date.now()}`,
                  type: 'function' as const,
                  function: {
                    name: toolName,
                    arguments: JSON.stringify(params),
                  },
                }];
                break;
              }
            } catch {
              // Try next candidate block
            }
          }
        }

        // Textual tool command detection (e.g. "navigate_to: https://..." or "open https://...")
        if (!toolCalls || toolCalls.length === 0) {
          const navMatch = textContent.match(/(?:navigate_to|go to|open)\s*[:\(]?\s*(https?:\/\/[^\s\)\"\']+)/i);
          if (navMatch) {
            toolCalls = [{
              id: `inlined-${Date.now()}`,
              type: 'function' as const,
              function: {
                name: 'navigate_to',
                arguments: JSON.stringify({ url: navMatch[1] }),
              },
            }];
          }
        }
      }

      // When the entire message is an inline tool call, blank it out for transcript
      const displayContent =
        toolCalls && toolCalls.length > 0 && toolCalls[0].id.startsWith('inlined-')
          ? ''
          : textContent;

      // Append assistant turn to transcript
      transcript.push({
        role: 'assistant',
        content: displayContent,
        tool_calls: toolCalls,
      });

      // If no tool calls, this is the final response turn.
      if (!toolCalls || toolCalls.length === 0) {
        let cleaned = this.cleanFinalAnswer(textContent);

        // Check if the output is an internal scratchpad / stream-of-consciousness monologue
        const isMonologue = this.isInternalMonologue(cleaned);
        const isTooShort = cleaned.length < 25;

        // If the model produced a monologue or empty response after tool research:
        if (!isChatMode && (isMonologue || isTooShort)) {
          const toolMessages = transcript.filter(m => m.role === 'tool');
          if (toolMessages.length > 0) {
            // Post reasoning to trace telemetry
            this.callbacks.onStep?.(currentStep, cleaned || stepReasoning);

            const combinedResearch = toolMessages
              .map((m) =>
                typeof m.content === 'string'
                  ? m.content
                  : m.content
                      .filter((p) => p.type === 'text')
                      .map((p) => p.text)
                      .join('\n'),
              )
              .join('\n\n')
              .slice(0, 10000);
            try {
              cleaned = await summarizeContent(
                combinedResearch,
                `Create a clean, well-formatted markdown response for the user (using a table or bullet list with bold highlights, key specs, and prices) answering: "${this.instruction}"`,
                this.config.providerConfig,
                this.config.quarantineModelId ?? this.config.model.id,
              );
            } catch {
              cleaned = `Research complete for "${this.instruction}". Please see the active browser page for full details.`;
            }
          }
        }

        this.callbacks.onStep?.(currentStep, stepReasoning || cleaned);
        this.callbacks.onStatusChange?.('done');
        await deleteCheckpoint(this.taskId);
        return cleaned || textContent;
      }

      // 5. Process tool calls
      for (const tc of toolCalls) {
        let rawArgs = {};
        try {
          rawArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          rawArgs = {};
        }

        const rawCall = { tool: tc.function.name, ...rawArgs };
        const validation = validateToolCall(rawCall);

        this.callbacks.onStep?.(currentStep, textContent, validation.success ? validation.data : undefined);

        // Zod validation feedback
        if (!validation.success) {
          await appendSecurityEvent({
            type: 'tool_validation_error',
            rawCall,
            errors: validation.error,
          });
          transcript.push(
            formatToolResult(
              tc.id,
              `VALIDATION_ERROR: Tool call was malformed. Details: ${validation.error}. Please correct and retry.`,
              true,
            ),
          );
          continue;
        }

        const validTool = validation.data;

        // Tool Allowlist Enforcement (Bug #1 - for constrained sub-agents)
        if (this.config.toolAllowlist && !this.config.toolAllowlist.includes(validTool.tool)) {
          transcript.push(
            formatToolResult(
              tc.id,
              `TOOL_NOT_PERMITTED: "${validTool.tool}" is not available to this agent.`,
              true,
            ),
          );
          continue;
        }

        // Action Validator Intent & Scope Check
        const targetStr = (validTool as { target?: string; url?: string }).target ?? (validTool as { url?: string }).url ?? '';
        const intentCheck = await validateAction(
          validTool.tool,
          targetStr,
          this.scopeDomains,
          this.taskId,
        );

        if (intentCheck.riskLevel === 'block') {
          transcript.push(formatToolResult(tc.id, `SECURITY_BLOCKED: ${intentCheck.reason}`, true));
          continue;
        }

        if (intentCheck.riskLevel === 'warn') {
          this.callbacks.onStatusChange?.('hitl_waiting', intentCheck.reason);

          // Wrapped with 2-minute safety timeout to avoid hanging indefinitely if sidepanel closes
          const hitlPromise = this.callbacks.onHITLRequired
            ? this.callbacks.onHITLRequired(validTool, intentCheck.reason)
            : Promise.resolve(false);

          const timeoutPromise = new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), 120_000);
          });

          const approved = await Promise.race([hitlPromise, timeoutPromise]);

          if (!approved) {
            transcript.push(formatToolResult(tc.id, 'USER_REJECTED: Action was declined or timed out waiting for approval.', true));
            this.callbacks.onStatusChange?.('running');
            continue;
          }
          this.callbacks.onStatusChange?.('running');
        }

        // Execute Tool
        let toolResultStr = '';
        try {
          toolResultStr = await this.executeTool(validTool);
          this.failedDomAttempts = 0; // Reset failure counter on success
          actionLog.push({ action: { type: validTool.tool, ...rawArgs }, timestamp: Date.now() });
          this.callbacks.onStep?.(currentStep, textContent, validTool, toolResultStr);
        } catch (err: unknown) {
          this.failedDomAttempts++;
          if (err instanceof InjectionDetectedError) {
            this.callbacks.onStatusChange?.('error', `Prompt injection blocked: ${err.message}`);
            return `Task paused for security: ${err.message}`;
          }
          toolResultStr = `[Execution Error]: ${err instanceof Error ? err.message : String(err)}`;
          // Provide fallback text for error step display
          const stepText = textContent || `Error executing ${validTool.tool}`;
          this.callbacks.onStep?.(currentStep, stepText, validTool, toolResultStr);
        }

        // Parse tool result to check for multimodal content
        let toolContent: string | ContentPart[];
        try {
          const parsed = JSON.parse(toolResultStr);
          if (parsed._visionContent && parsed.imageUrl) {
            // Create ContentPart array for multimodal message
            toolContent = [
              { type: 'text', text: parsed.text || 'Screenshot captured.' },
              { type: 'image_url', image_url: { url: parsed.imageUrl, detail: 'auto' } },
            ];
          } else {
            toolContent = toolResultStr;
          }
        } catch {
          // Not JSON or not vision content, use as-is
          toolContent = toolResultStr;
        }

        // Add tool result to transcript
        transcript.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolContent,
        });

        // Action Loop Detection (Blocker 8)
        const actionSig = `${validTool.tool}:${targetStr}`;
        this.recentActionSignatures.push(actionSig);
        if (this.recentActionSignatures.length > 6) {
          this.recentActionSignatures.shift();
        }

        const recentConsecutive = this.recentActionSignatures.slice(-3);
        if (recentConsecutive.length >= 3 && recentConsecutive.every((s) => s === actionSig)) {
          transcript.push({
            role: 'user',
            content: `[SYSTEM ADVISORY: Action loop detected. You have called "${actionSig}" 3 times consecutively with no state progression. Please try an alternative approach, a different element or tool, or synthesize and present your final answer now.]`,
          });
        }

        // Ephemeral DOM History Pruning:
        // Conserve context window by replacing older DOM snapshots with compact references
        this.pruneOldDomSnapshots(transcript);

        // Multi-Tool Sequencing Break:
        // If a page-mutating tool runs (navigate_to or switch_tab), break the batch tool loop
        // so the model evaluates the new page cleanly in the next turn instead of executing on stale state.
        if (validTool.tool === 'navigate_to' || validTool.tool === 'switch_tab') {
          break;
        }
      }
    }

    this.callbacks.onStatusChange?.('done');
    await deleteCheckpoint(this.taskId);

    // If loop reached max steps without an explicit text conclusion, synthesize all gathered research:
    const toolMessages = transcript.filter(m => m.role === 'tool');
    if (toolMessages.length > 0) {
      const combinedResearch = toolMessages
        .map((m) =>
          typeof m.content === 'string'
            ? m.content
            : m.content
                .filter((p) => p.type === 'text')
                .map((p) => p.text)
                .join('\n'),
        )
        .join('\n\n')
        .slice(0, 15000);
      try {
        const synthesized = await summarizeContent(
          combinedResearch,
          `Compile a complete, user-facing markdown response (including a comparison table with prices, key specs, and links/names) answering the user's request: "${this.instruction}"`,
          this.config.providerConfig,
          this.config.quarantineModelId ?? this.config.model.id,
        );
        return synthesized;
      } catch {
        return `I've finished researching "${this.instruction}". Check the browser tabs for details.`;
      }
    }

    return 'Research task completed. No additional data found.';
  }

  /**
   * Ephemeral Transcript Pruning:
   * Keeps only the latest interactive DOM snapshot in the transcript to prevent token explosion.
   */
  private pruneOldDomSnapshots(transcript: ChatMessage[]): void {
    const domIndices: number[] = [];
    for (let i = 0; i < transcript.length; i++) {
      const m = transcript[i];
      if (m.role === 'tool' && typeof m.content === 'string') {
        if (m.content.includes('INTERACTIVE ELEMENTS') || m.content.includes('FRESH INTERACTIVE ELEMENTS')) {
          domIndices.push(i);
        }
      }
    }

    if (domIndices.length > 1) {
      for (let j = 0; j < domIndices.length - 1; j++) {
        const idx = domIndices[j];
        const msg = transcript[idx];
        if (typeof msg.content === 'string') {
          const firstLine = msg.content.split('\n')[0] || '[Action Result]';
          msg.content = `${firstLine}\n[Prior DOM element snapshot pruned to conserve context. Refer to the latest page snapshot below.]`;
        }
      }
    }
  }

  /**
   * Auto-generate a compact fresh snapshot of interactive elements after an action.
   */
  private async autoSnapshotAfterAction(tabId: number): Promise<string> {
    try {
      await waitForDOMSettle(tabId, 800);

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          function isVisible(el: Element): boolean {
            if (typeof (el as HTMLElement).checkVisibility === 'function') {
              return (el as HTMLElement).checkVisibility();
            }
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          }

          const interactiveQuery = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="option"]';
          const candidates = Array.from(document.querySelectorAll(interactiveQuery)).filter(isVisible);

          interface InteractiveEl { index: number; kind: string; meta: string; }
          const interactive: InteractiveEl[] = [];
          let idx = 1;

          for (const el of candidates.slice(0, 80)) {
            const tag = el.tagName.toLowerCase();
            const inputEl = el as HTMLInputElement;

            // Resolve associated label
            let label = el.getAttribute('aria-label') || '';
            if (!label && inputEl.id) {
              const labelEl = document.querySelector(`label[for="${inputEl.id}"]`);
              if (labelEl) label = labelEl.textContent?.trim() || '';
            }
            if (!label) {
              const parentLabel = el.closest('label');
              if (parentLabel) label = parentLabel.textContent?.trim() || '';
            }
            if (!label) {
              label = inputEl.placeholder || el.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('title') || '';
            }
            label = label.slice(0, 50);

            const parts: string[] = [];
            if (label) parts.push(`label="${label}"`);
            if (inputEl.name) parts.push(`name="${inputEl.name}"`);
            if (inputEl.required) parts.push('required');
            if (inputEl.value && tag === 'input' && inputEl.type !== 'password') {
              parts.push(`value="${inputEl.value.slice(0, 30)}"`);
            }
            if (tag === 'select') {
              const sel = el as HTMLSelectElement;
              const options = Array.from(sel.options).map(o => o.text.trim()).filter(Boolean).slice(0, 5);
              if (options.length > 0) parts.push(`options=[${options.map(o => `"${o}"`).join(',')}]`);
            }

            const kind = tag === 'a' ? 'link' : tag === 'input' ? `input[${inputEl.type || 'text'}]` : tag;
            el.setAttribute('data-nim-id', String(idx));
            interactive.push({ index: idx, kind, meta: parts.join(' ') });
            idx++;
          }

          return interactive;
        },
      });

      const interactive = results[0]?.result ?? [];
      if (interactive.length === 0) return '';

      const lines = interactive.map((e: { index: number; kind: string; meta: string }) => `  [${e.index}] ${e.kind} ${e.meta}`).join('\n');
      return `\n\nFRESH INTERACTIVE ELEMENTS (Snapshot):\n${lines}`;
    } catch {
      return '';
    }
  }

  /**
   * Post-process the LLM's raw final answer into clean, readable markdown.
   */
  private cleanFinalAnswer(raw: string): string {
    let text = raw;

    // Deduplicate repeating identical lines (breaks infinite hallucination loops)
    const lines = text.split('\n');
    const dedupedLines: string[] = [];
    let repeatCount = 0;
    let lastLine = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && trimmed === lastLine) {
        repeatCount++;
        if (repeatCount < 2) dedupedLines.push(line);
      } else {
        repeatCount = 0;
        lastLine = trimmed;
        dedupedLines.push(line);
      }
    }
    text = dedupedLines.join('\n');

    // Remove repeated JSON fragments like {"target": ""} {"target": ""} ...
    text = text.replace(/(?:\{\s*"target"[^}]*\}\s*)+/g, '');
    text = text.replace(/(?:\{\s*"[^"]+"\s*:\s*"[^"]*"\s*\}\s*){3,}/g, '');

    // Remove common verbose preambles
    text = text.replace(
      /^(final answer[:\s]*|here is (the|your|a|my)[^:\n]{0,40}:|conclusion[:\s]*|based on (my |the )?research[^:\n]{0,60}:|i have (researched|found|compiled)[^:\n]{0,80}:?\n)/i,
      '',
    );

    // Remove lines that are purely raw JSON artifacts
    text = text.replace(/^\s*\{[^}]{0,200}\}\s*$/gm, '');

    // Collapse excessive blank lines
    text = text.replace(/\n{3,}/g, '\n\n');

    // Remove trailing filler
    text = text.replace(
      /\n+(let me know if you (need|want|have)|feel free to ask|i hope this helps|is there anything else)[^]*$/i,
      '',
    );

    return text.trim();
  }

  /** Detect if output text is an internal thinking monologue rather than user-facing markdown */
  private isInternalMonologue(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return true;

    // Check for thinking keywords & scratchpad patterns
    const scratchpadPatterns = [
      /^(we have a list|need to extract|let's gather|let's open|let's check|we need to|we can try to|not sure price|could be time-consuming)/i,
      /\b(let's open|use navigate_to|we need to read the page|let's gather more details|maybe above|not sure price)\b/i,
      /^(i think|i will|let me|we should|first let's)\b/i,
    ];

    const hasScratchpadPattern = scratchpadPatterns.some(p => p.test(trimmed));
    // If it has markdown table pipes or clear markdown headers, it's structured
    const hasTableStructure = trimmed.includes('|') && trimmed.includes('\n|');
    const hasHeaderStructure = /^#{1,4}\s+/m.test(trimmed);

    if (hasTableStructure || hasHeaderStructure) return false;
    return hasScratchpadPattern;
  }

  private async executeTool(tool: ValidatedToolCall): Promise<string> {
    switch (tool.tool) {
      case 'web_search': {
        return await webSearch(tool.query, this.config.searchConfig);
      }

      case 'navigate_to': {
        // Enforce domain locking for sub-agents
        if (this.config.initialHostname) {
          try {
            const destHost = new URL(tool.url).hostname;
            const allowedHost = this.config.initialHostname;
            if (destHost !== allowedHost && !destHost.endsWith(`.${allowedHost}`)) {
              return `TOOL_BLOCKED: Sub-agent is domain-locked to "${allowedHost}". Navigation to "${destHost}" was blocked.`;
            }
          } catch {
            return `TOOL_ERROR: Invalid navigation URL: "${tool.url}"`;
          }
        }

        const currentTabId = await this.resolveTabId();
        await fxNavigate(currentTabId);

        const tabId = await navigateTo(tool.url, tool.newTab);
        try {
          const u = new URL(tool.url);
          if (!this.scopeDomains.includes(u.hostname)) {
            this.scopeDomains.push(u.hostname);
          }
        } catch {
          // ignore url parse
        }

        // Wait for page settlement
        await waitForDOMSettle(tabId, 1000);
        return `Navigated successfully to: ${tool.url}`;
      }

      case 'screenshot': {
        const snapTabId = await this.resolveTabId();
        await fxFlash(snapTabId);
        const dataUrl = await captureViewport();
        return `[IMAGE_DATA:${dataUrl}] Captured viewport screenshot. Visual context enabled.`;
      }

      case 'read_page': {
        const tabId = await this.resolveTabId();

        await fxScan(tabId);
        await waitForDOMSettle(tabId, 500);

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const NOISE_SELECTORS = [
              'nav', 'header', 'footer', 'aside',
              '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
              '[role="complementary"]', '.cookie', '.gdpr', '.consent',
              '.ad', '.ads', '.advertisement', '.popup', '.modal-overlay',
              '#cookie-banner', '#consent', '.sidebar',
            ].join(',');

            const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'META', 'HEAD', 'SVG', 'CANVAS']);

            function isVisible(el: Element): boolean {
              if (typeof (el as HTMLElement).checkVisibility === 'function') {
                return (el as HTMLElement).checkVisibility();
              }
              const style = getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            }

            const noiseEls = new Set<Element>();
            try {
              document.querySelectorAll(NOISE_SELECTORS).forEach(e => noiseEls.add(e));
            } catch { /* ignore */ }

            function inNoise(el: Element): boolean {
              let cur: Element | null = el;
              while (cur) { if (noiseEls.has(cur)) return true; cur = cur.parentElement; }
              return false;
            }

            // Extract main text content
            const seen = new Set<string>();
            const lines: string[] = [];
            let charBudget = 5000;

            const mainEl = document.querySelector('main, article, [role="main"], #content, #main, .content, .main') ?? document.body;
            const walker = document.createTreeWalker(mainEl, NodeFilter.SHOW_ELEMENT);
            let node = walker.nextNode() as Element | null;
            while (node && charBudget > 0) {
              const tag = node.tagName;
              if (SKIP_TAGS.has(tag) || inNoise(node)) {
                node = walker.nextNode() as Element | null;
                continue;
              }
              if (!isVisible(node)) {
                node = walker.nextNode() as Element | null;
                continue;
              }
              if (node.childElementCount === 0) {
                const t = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
                if (t.length > 1 && !seen.has(t)) {
                  seen.add(t);
                  const prefix = /^H[1-6]$/.test(tag) ? `\n## ` : '';
                  lines.push(`${prefix}${t}`);
                  charBudget -= t.length;
                }
              }
              node = walker.nextNode() as Element | null;
            }

            // Extract interactive elements with rich metadata up to 80 controls
            interface InteractiveEl { index: number; kind: string; meta: string; }
            const interactive: InteractiveEl[] = [];
            const interactiveQuery = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="option"]';
            const candidates = Array.from(document.querySelectorAll(interactiveQuery)).filter(isVisible);

            let idx = 1;
            for (const el of candidates.slice(0, 80)) {
              if (inNoise(el)) continue;
              const tag = el.tagName.toLowerCase();
              const inputEl = el as HTMLInputElement;

              // Resolve label
              let label = el.getAttribute('aria-label') || '';
              if (!label && inputEl.id) {
                const labelEl = document.querySelector(`label[for="${inputEl.id}"]`);
                if (labelEl) label = labelEl.textContent?.trim() || '';
              }
              if (!label) {
                const parentLabel = el.closest('label');
                if (parentLabel) label = parentLabel.textContent?.trim() || '';
              }
              if (!label) {
                label = inputEl.placeholder || el.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('title') || '';
              }
              label = label.slice(0, 50);

              const parts: string[] = [];
              if (label) parts.push(`label="${label}"`);
              if (inputEl.name) parts.push(`name="${inputEl.name}"`);
              if (inputEl.required) parts.push('required');
              if (inputEl.value && tag === 'input' && inputEl.type !== 'password') {
                parts.push(`value="${inputEl.value.slice(0, 30)}"`);
              }
              if (tag === 'select') {
                const sel = el as HTMLSelectElement;
                const options = Array.from(sel.options).map(o => o.text.trim()).filter(Boolean).slice(0, 5);
                if (options.length > 0) parts.push(`options=[${options.map(o => `"${o}"`).join(',')}]`);
              }

              const kind = tag === 'a' ? 'link' : tag === 'input' ? `input[${inputEl.type || 'text'}]` : tag;
              el.setAttribute('data-nim-id', String(idx));
              interactive.push({ index: idx, kind, meta: parts.join(' ') });
              idx++;
            }

            // First 10 links
            const links = Array.from(document.querySelectorAll('a[href]'))
              .filter(a => isVisible(a) && !inNoise(a))
              .slice(0, 10)
              .map(a => ({ text: a.textContent?.trim().slice(0, 40) || '', href: (a as HTMLAnchorElement).href }));

            return {
              title: document.title,
              url: window.location.href,
              lang: document.documentElement.lang || 'en',
              content: lines.join('\n'),
              interactive,
              links,
            };
          },
        });

        const page = results[0]?.result;
        if (!page) return 'Page was empty or unreadable.';

        // Quarantine sanitization - run page content through injection-locked LLM
        let sanitizedContent = page.content;
        let sanitizedLinks = page.links;
        try {
          const clean = await sanitizeWithQuarantine(
            page.content,
            page.url,
            this.config.providerConfig,
            this.config.quarantineModelId ?? this.config.model.id,
          );
          // Use sanitized keyFacts instead of raw content
          sanitizedContent = clean.keyFacts.join('\n');
          sanitizedLinks = clean.links;
        } catch (err: unknown) {
          if (err instanceof InjectionDetectedError) {
            // Don't abort entire task, just block this page read
            return `SECURITY_BLOCKED: Prompt injection detected on ${page.url}. ${err.details}`;
          }
          // Strict security: On quarantine failure (e.g. rate limit, timeout), withhold unverified raw content
          console.warn('Quarantine check failed, withholding raw content:', err);
          return `SECURITY_BLOCKED: Page content on ${page.url} could not be verified by security quarantine: ${err instanceof Error ? err.message : 'verification error'}. Content withheld for safety.`;
        }

        const interactiveLines = page.interactive
          .map((e: { index: number; kind: string; meta: string }) => `  [${e.index}] ${e.kind} ${e.meta}`)
          .join('\n');

        const linkLines = sanitizedLinks
          .filter((l: { text: string; href: string }) => l.text)
          .map((l: { text: string; href: string }) => `  - "${l.text}" → ${l.href}`)
          .join('\n');

        // Check if Vision Fallback should trigger (sparse DOM or previous action failures)
        let imagePrefix = '';
        if (
          shouldUseFallbackVision(sanitizedContent, this.failedDomAttempts, this.config.visionOptIn ?? false) &&
          (this.config.model.supportsVision || this.config.visionOptIn)
        ) {
          try {
            const dataUrl = await captureViewport();
            imagePrefix = `[IMAGE_DATA:${dataUrl}] `;
          } catch {
            // ignore screenshot error
          }
        }

        const output = [
          `PAGE: ${page.title} | ${page.url}`,
          `LANG: ${page.lang}`,
          `─────────────────────────────────`,
          `CONTENT:`,
          sanitizedContent.trim() || '(no main text found)',
          `─────────────────────────────────`,
          `INTERACTIVE ELEMENTS (${page.interactive.length}) [Target with ID [1], [2], etc.]:`,
          interactiveLines || '  (none)',
          `─────────────────────────────────`,
          `LINKS (${page.links.length}):`,
          linkLines || '  (none)',
        ].filter(Boolean).join('\n');

        return `${imagePrefix}${output}`;
      }

      case 'click_element': {
        const tabId = await this.resolveTabId();

        await fxClick(tabId, tool.target);

        // Single atomic operation: resolve → check destructive keywords → click
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (targetStr: string, destructiveKeywords: string[]) => {
            const trimmed = targetStr.trim();
            const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
            let el: HTMLElement | null = null;

            if (numMatch) {
              el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
            }
            if (!el) {
              try {
                el = document.querySelector<HTMLElement>(trimmed);
              } catch { /* ignore */ }
            }
            if (!el) {
              const all = Array.from(document.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])'));
              const lower = trimmed.toLowerCase();
              el = all.find((e) =>
                (e.textContent ?? '').toLowerCase().includes(lower) ||
                (e.getAttribute('aria-label') ?? '').toLowerCase().includes(lower) ||
                (e.getAttribute('title') ?? '').toLowerCase().includes(lower) ||
                ((e as HTMLInputElement).placeholder ?? '').toLowerCase().includes(lower) ||
                ((e as HTMLInputElement).name ?? '').toLowerCase().includes(lower)
              ) ?? null;
            }

            if (!el) return { success: false, error: `Could not locate element: "${targetStr}"` };

            const fingerprint = {
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().slice(0, 50),
              ariaLabel: el.getAttribute('aria-label') || '',
              title: el.getAttribute('title') || '',
              name: (el as HTMLInputElement).name || '',
              nimId: el.getAttribute('data-nim-id') || '',
            };

            // Check for destructive keywords in resolved element
            const searchIn = [
              fingerprint.text,
              fingerprint.ariaLabel,
              fingerprint.title,
              (el.getAttribute('value') || ''),
              fingerprint.name,
              el.getAttribute('role') || '',
              el.className || '',
            ].join(' ').toLowerCase();

            const isDestructive = destructiveKeywords.some((keyword) => searchIn.includes(keyword));
            
            if (isDestructive) {
              return { 
                success: false, 
                needsApproval: true,
                searchText: searchIn.slice(0, 100),
                fingerprint,
                error: 'Destructive action detected'
              };
            }

            // Safe to click - execute immediately
            try {
              el.scrollIntoView({ block: 'center', inline: 'center' });
            } catch { /* fallback */ }

            el.focus();

            if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
              if (el.type === 'checkbox') el.checked = !el.checked;
              else el.checked = true;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }

            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            el.click();

            return { success: true };
          },
          args: [tool.target, [...DESTRUCTIVE_KEYWORDS]],
        });

        const res = results[0]?.result;
        if (!res?.success) {
          if (res?.needsApproval) {
            // Destructive action detected - prompt for HITL approval
            const reason = `Clicking this element may perform a destructive action. Text/labels: "${res.searchText}"`;
            
            this.callbacks.onStatusChange?.('hitl_waiting', reason);

            const hitlPromise = this.callbacks.onHITLRequired
              ? this.callbacks.onHITLRequired(tool, reason)
              : Promise.resolve(false);

            const timeoutPromise = new Promise<boolean>((resolve) => {
              setTimeout(() => resolve(false), 120_000);
            });

            const approved = await Promise.race([hitlPromise, timeoutPromise]);

            if (!approved) {
              this.callbacks.onStatusChange?.('running');
              return 'SECURITY_BLOCKED: Destructive click action was declined or timed out waiting for approval.';
            }
            this.callbacks.onStatusChange?.('running');

            // Re-execute click now that it's approved with TOCTOU fingerprint verification
            const approvedResults = await chrome.scripting.executeScript({
              target: { tabId },
              func: (targetStr: string, expectedFingerprint?: { text: string; ariaLabel: string; name: string; nimId: string }) => {
                const trimmed = targetStr.trim();
                const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
                let el: HTMLElement | null = null;

                if (numMatch) {
                  el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
                }
                if (!el) {
                  try {
                    el = document.querySelector<HTMLElement>(trimmed);
                  } catch { /* ignore */ }
                }
                if (!el) {
                  const all = Array.from(document.querySelectorAll<HTMLElement>('button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])'));
                  const lower = trimmed.toLowerCase();
                  el = all.find((e) =>
                    (e.textContent ?? '').toLowerCase().includes(lower) ||
                    (e.getAttribute('aria-label') ?? '').toLowerCase().includes(lower) ||
                    (e.getAttribute('title') ?? '').toLowerCase().includes(lower) ||
                    ((e as HTMLInputElement).placeholder ?? '').toLowerCase().includes(lower) ||
                    ((e as HTMLInputElement).name ?? '').toLowerCase().includes(lower)
                  ) ?? null;
                }

                if (!el) return { success: false, error: `Could not locate element: "${targetStr}"` };

                // TOCTOU Verification: check if element signature changed during approval wait
                if (expectedFingerprint) {
                  const currentText = (el.textContent || '').trim().slice(0, 50);
                  const currentAria = el.getAttribute('aria-label') || '';
                  const currentName = (el as HTMLInputElement).name || '';
                  const currentNimId = el.getAttribute('data-nim-id') || '';

                  const textMatches = !expectedFingerprint.text || currentText.includes(expectedFingerprint.text) || expectedFingerprint.text.includes(currentText);
                  const idMatches = !expectedFingerprint.nimId || currentNimId === expectedFingerprint.nimId;

                  if (!textMatches && !idMatches && !currentAria && !currentName) {
                    return {
                      success: false,
                      error: `TOCTOU_MISMATCH: Page content shifted during approval. Target element is no longer the approved item (expected: "${expectedFingerprint.text || expectedFingerprint.nimId}", got: "${currentText || currentNimId}"). Click aborted for safety.`,
                    };
                  }
                }

                try {
                  el.scrollIntoView({ block: 'center', inline: 'center' });
                } catch { /* fallback */ }

                el.focus();

                if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
                  if (el.type === 'checkbox') el.checked = !el.checked;
                  else el.checked = true;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }

                el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                el.click();

                return { success: true };
              },
              args: [tool.target, res?.fingerprint],
            });

            const approvedRes = approvedResults[0]?.result;
            if (!approvedRes?.success) return `Failed: ${approvedRes?.error}`;
          } else {
            return `Failed: ${res?.error}`;
          }
        }

        // Auto re-read snapshot immediately after click
        const freshSnapshot = await this.autoSnapshotAfterAction(tabId);
        return `Clicked element "${tool.target}".${freshSnapshot}`;
      }

      case 'type_text': {
        const tabId = await this.resolveTabId();

        await fxType(tabId, tool.target);

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (targetStr: string, textToType: string) => {
            const trimmed = targetStr.trim();
            const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
            let el: HTMLElement | null = null;

            if (numMatch) {
              el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
            }
            if (!el) {
              try {
                el = document.querySelector<HTMLElement>(trimmed);
              } catch { /* ignore */ }
            }
            if (!el) {
              const all = Array.from(document.querySelectorAll<HTMLElement>('input, textarea, [contenteditable="true"]'));
              const lower = trimmed.toLowerCase();
              el = all.find((e) =>
                ((e as HTMLInputElement).placeholder || (e as HTMLElement).getAttribute('aria-label') || (e as HTMLInputElement).name || '')
                  .toLowerCase()
                  .includes(lower),
              ) ?? null;
            }

            if (!el) return { success: false, error: `Could not locate input element: "${targetStr}"` };

            // DOM-level Sensitive Field Check (catches numeric IDs like "[1]" or "2")
            const inputEl = el as HTMLInputElement;
            const searchIn = [
              inputEl.type,
              inputEl.name,
              inputEl.id,
              inputEl.placeholder,
              inputEl.getAttribute('aria-label') || '',
              inputEl.getAttribute('autocomplete') || '',
              inputEl.className || '',
            ].join(' ').toLowerCase();

            const SENSITIVE_PATTERNS = [/password/i, /credit.?card/i, /card.?number/i, /cvv/i, /ssn/i, /social.?security/i];
            if (inputEl.type === 'password' || SENSITIVE_PATTERNS.some((p) => p.test(searchIn))) {
              return { success: false, error: 'SECURITY_BLOCKED: Refusing to auto-fill a sensitive field (password / payment / SSN)' };
            }

            try {
              el.scrollIntoView({ block: 'center', inline: 'center' });
            } catch { /* fallback */ }

            el.focus();

            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              el.value = '';
              const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
              const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (nativeSetter) {
                nativeSetter.call(el, textToType);
              } else {
                el.value = textToType;
              }
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true };
            }

            if (el.isContentEditable) {
              el.focus();
              document.execCommand('selectAll', false);
              document.execCommand('insertText', false, textToType);
              return { success: true };
            }

            return { success: false, error: 'Target was not a supported input or textarea' };
          },
          args: [tool.target, tool.value],
        });

        const res = results[0]?.result;
        if (!res?.success) return `Failed: ${res?.error}`;

        const freshSnapshot = await this.autoSnapshotAfterAction(tabId);
        return `Typed "${tool.value}" into "${tool.target}".${freshSnapshot}`;
      }

      case 'select_option': {
        const tabId = await this.resolveTabId();

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (targetStr: string, optValue: string) => {
            const trimmed = targetStr.trim();
            const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
            let el: HTMLElement | null = null;

            if (numMatch) el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
            if (!el) {
              try { el = document.querySelector<HTMLElement>(trimmed); } catch { /* ignore */ }
            }
            if (!el) {
              const all = Array.from(document.querySelectorAll<HTMLElement>('select, [role="combobox"], [role="listbox"]'));
              el = all.find(e => (e.getAttribute('aria-label') || (e as HTMLSelectElement).name || '').toLowerCase().includes(trimmed.toLowerCase())) ?? null;
            }

            if (!el) return { success: false, error: `Could not find dropdown: "${targetStr}"` };

            try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* fallback */ }
            el.focus();

            if (el instanceof HTMLSelectElement) {
              const lower = optValue.toLowerCase().trim();
              let matchedIndex = -1;
              for (let i = 0; i < el.options.length; i++) {
                const opt = el.options[i];
                if (opt.value.toLowerCase() === lower || opt.text.toLowerCase() === lower || opt.text.toLowerCase().includes(lower)) {
                  matchedIndex = i;
                  break;
                }
              }
              if (matchedIndex === -1) {
                const available = Array.from(el.options).map(o => `"${o.text}"`).slice(0, 6).join(', ');
                return { success: false, error: `Option "${optValue}" not found. Available: [${available}]` };
              }
              el.selectedIndex = matchedIndex;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true };
            }

            return { success: false, error: 'Target is not a standard <select> element' };
          },
          args: [tool.target, tool.option],
        });

        const res = results[0]?.result;
        if (!res?.success) return `Failed: ${res?.error}`;

        const freshSnapshot = await this.autoSnapshotAfterAction(tabId);
        return `Selected option "${tool.option}" on "${tool.target}".${freshSnapshot}`;
      }

      case 'press_key': {
        const tabId = await this.resolveTabId();

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (keyName: string, targetStr?: string): { success: boolean; error?: string } => {
            let el: HTMLElement | null = null;
            if (targetStr) {
              const trimmed = targetStr.trim();
              const numMatch = trimmed.match(/^\[?(\d+)\]?$/) || trimmed.match(/^id:(\d+)$/);
              if (numMatch) el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
              if (!el) {
                try { el = document.querySelector<HTMLElement>(trimmed); } catch { /* ignore */ }
              }
            }
            if (!el) el = (document.activeElement as HTMLElement) || document.body;

            el.focus();

            const keyLower = keyName.toLowerCase();
            const keyMap: Record<string, { key: string; code: string; keyCode: number }> = {
              enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
              tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
              escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
              esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
              arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
              down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
              arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
              up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
            };

            const info = keyMap[keyLower] || { key: keyName, code: `Key${keyName.toUpperCase()}`, keyCode: keyName.charCodeAt(0) };
            const props = { key: info.key, code: info.code, keyCode: info.keyCode, which: info.keyCode, bubbles: true, cancelable: true };

            el.dispatchEvent(new KeyboardEvent('keydown', props));
            el.dispatchEvent(new KeyboardEvent('keypress', props));
            el.dispatchEvent(new KeyboardEvent('keyup', props));

            if (info.key === 'Enter' && el instanceof HTMLInputElement && el.form) {
              el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }

            return { success: true };
          },
          args: [tool.key, tool.target],
        });

        const res = results[0]?.result;
        if (!res?.success) return `Failed: ${res?.error}`;

        const freshSnapshot = await this.autoSnapshotAfterAction(tabId);
        return `Pressed "${tool.key}".${freshSnapshot}`;
      }

      case 'wait_for': {
        const tabId = await this.resolveTabId();

        const waitRes = await waitForSelector(tabId, tool.selector, tool.state ?? 'visible', tool.timeoutMs ?? 5000);
        return waitRes.success
          ? `Successfully waited for "${tool.selector}" to be ${tool.state ?? 'visible'}.`
          : `Wait failed: ${waitRes.error}`;
      }

      case 'scroll_page': {
        const tabId = await this.resolveTabId();

        await fxScroll(tabId, tool.direction);

        await chrome.scripting.executeScript({
          target: { tabId },
          func: (dir: string, px?: number) => {
            const amount = px ?? window.innerHeight * 0.8;
            window.scrollBy({ top: dir === 'down' ? amount : -amount, behavior: 'smooth' });
          },
          args: [tool.direction, tool.pixels],
        });

        await new Promise((r) => setTimeout(r, 400));
        const freshSnapshot = await this.autoSnapshotAfterAction(tabId);
        return `Scrolled page ${tool.direction}.${freshSnapshot}`;
      }

      case 'summarize': {
        const tabId = await this.resolveTabId();
        let pageText = '';
        let tabInfo: chrome.tabs.Tab | undefined;
        
        if (tabId) {
          try {
            tabInfo = await chrome.tabs.get(tabId);
            const results = await chrome.scripting.executeScript({
              target: { tabId },
              func: () => document.body.innerText.slice(0, 10000),
            });
            pageText = results[0]?.result ?? '';
          } catch {
            // ignore
          }
        }

        const summary = await summarizeContent(
          pageText || this.instruction,
          tool.focus,
          this.config.providerConfig,
          this.config.quarantineModelId ?? this.config.model.id,
        );

        await appendResearchNote({
          sourceUrl: tabInfo?.url ?? '',
          sourceTitle: tabInfo?.title ?? 'Web Page Summary',
          summary,
        });

        return `Summary generated and saved to Research Notes:\n${summary}`;
      }

      case 'list_tabs': {
        const tabs = await listTabs();
        const formatted = tabs
          .map(t => `  - [Tab ID ${t.id}] "${t.title}" (${t.url})${t.active ? ' [ACTIVE]' : ''}`)
          .join('\n');
        return `OPEN BROWSER TABS (${tabs.length}):\n${formatted || '  (none)'}`;
      }

      case 'switch_tab': {
        const res = await switchTab(tool.tabId);
        return res.success
          ? `Switched active tab to: "${res.tab?.title}" (${res.tab?.url})`
          : `Failed to switch tab: ${res.error}`;
      }

      case 'close_tab': {
        const res = await closeTab(tool.tabId);
        return res.success ? 'Tab closed successfully.' : `Failed to close tab: ${res.error}`;
      }

      case 'extract_table': {
        const tabId = await this.resolveTabId();
        
        const res = await extractTableFromPage(tabId, tool.selector);
        if ('error' in res) return `Table extraction error: ${res.error}`;
        
        // Get current URL for quarantine check
        const tabInfo = await chrome.tabs.get(tabId);
        const pageUrl = tabInfo.url ?? 'unknown';
        
        // Quarantine sanitization - table data could contain injection payloads
        // Note: We check for injection but preserve the original CSV structure
        // (keyFacts would mangle tabular data into prose)
        let sanitizedCsv = res.csv;
        try {
          const clean = await sanitizeWithQuarantine(
            res.csv,
            pageUrl,
            this.config.providerConfig,
            this.config.quarantineModelId ?? this.config.model.id,
          );
          // Quarantine passed - use original CSV (injection detection only, no data transform)
          sanitizedCsv = res.csv;
        } catch (err: unknown) {
          if (err instanceof InjectionDetectedError) {
            return `SECURITY_BLOCKED: Prompt injection detected in table data from ${pageUrl}. ${err.details}`;
          }
          // For other errors, fall back to original CSV
          console.warn('Quarantine check failed for table, using original:', err);
        }
        
        return `EXTRACTED TABLE (${res.rowCount} rows):\nHeaders: ${res.headers.join(', ')}\n\nCSV DATA:\n${sanitizedCsv}`;
      }

      case 'parallel_research': {
        const workerProvider = this.config.workerProviderConfig || this.config.providerConfig;
        const workerModel = this.config.workerModel || this.config.model;

        // Validate each task URL against scope before proceeding
        const checked = await Promise.all(tool.tasks.map(async (t) => {
          const check = await validateAction('navigate_to', t.url, this.scopeDomains, this.taskId);
          return { task: t, check };
        }));

        const blocked = checked.filter(c => c.check.riskLevel === 'block');
        const needsApproval = checked.filter(c => c.check.riskLevel === 'warn');
        let allowed = checked.filter(c => c.check.riskLevel === 'safe').map(c => c.task);

        // Handle blocked tasks
        if (blocked.length > 0) {
          const blockedUrls = blocked.map(b => b.task.url).join(', ');
          const blockedMsg = `SECURITY_BLOCKED: ${blocked.length} task(s) blocked (out of scope or high-risk): ${blockedUrls}`;
          this.callbacks.onStep?.(0, blockedMsg, tool);
          
          // If all tasks are blocked, return error
          if (blocked.length === tool.tasks.length) {
            return blockedMsg;
          }
        }

        // Handle tasks that need approval
        for (const item of needsApproval) {
          this.callbacks.onStatusChange?.('hitl_waiting', item.check.reason);

          const hitlPromise = this.callbacks.onHITLRequired
            ? this.callbacks.onHITLRequired({ tool: 'navigate_to', url: item.task.url }, item.check.reason)
            : Promise.resolve(false);

          const timeoutPromise = new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), 120_000);
          });

          const approved = await Promise.race([hitlPromise, timeoutPromise]);

          if (approved) {
            allowed.push(item.task);
          }
          this.callbacks.onStatusChange?.('running');
        }

        // If no tasks remain after filtering, return early
        if (allowed.length === 0) {
          return 'All parallel_research tasks were blocked or declined. No research was performed.';
        }

        this.callbacks.onStep?.(
          0,
          `Launching ${allowed.length} worker sub-agents in parallel background tabs...`,
          tool,
        );

        const subagentRun = await executeParallelSubagents(allowed, {
          workerProviderConfig: workerProvider,
          workerModel,
          parentTaskId: this.taskId,
          costLimits: this.config.costLimits,
          onProgress: (taskName, status, detail) => {
            this.callbacks.onStep?.(
              0,
              `[Sub-Agent: ${taskName}] ${detail || status}`,
              undefined,
            );
          },
        });

        // Include blocked task information in the report if any were blocked
        let finalReport = subagentRun.formattedReport;
        if (blocked.length > 0) {
          const blockedList = blocked.map(b => `- ${b.task.name} (${b.task.url}): ${b.check.reason}`).join('\n');
          finalReport = `${finalReport}\n\n**Blocked Tasks:**\n${blockedList}`;
        }

        return finalReport;
      }
    }
  }
}
