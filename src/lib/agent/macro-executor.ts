import { type Macro, type MacroAction, saveMacro } from '../storage/tasks';
import { validateAction } from './action-validator';
import { loadWorkerConfig } from '../storage/secure';
import { chatCompletion } from '../llm/client';
import { appendSecurityEvent } from '../security/audit-log';
import { checkBudget, recordUsage } from './cost-guard';

export interface MacroStepResult {
  stepNumber: number;
  tool: string;
  success: boolean;
  healed: boolean;
  target?: string;
  result?: string;
  error?: string;
}

export interface MacroExecutionResult {
  macroId: string;
  name: string;
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  stepResults: MacroStepResult[];
  tokensUsed: number;
  error?: string;
}

export interface MacroExecutionCallbacks {
  onStepStart?: (stepNumber: number, total: number, action: MacroAction) => void;
  onStepComplete?: (stepNumber: number, total: number, result: MacroStepResult) => void;
}

/**
 * Deterministically resolve a target element in the page DOM using exact match or semantic label drift matching.
 */
export async function resolveTargetInPage(
  tabId: number,
  target: string,
  recordedLabel?: string,
): Promise<{ resolvedTarget: string | null; method: 'exact' | 'semantic' | 'none' }> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (tgt: string, label: string) => {
        const cleanTgt = tgt.trim();
        const cleanLabel = label.trim().toLowerCase();

        // 1. Exact ID or Selector check
        try {
          const directEl = document.querySelector(cleanTgt);
          if (directEl) return { resolved: cleanTgt, method: 'exact' as const };
        } catch { /* invalid selector */ }

        // Check Set-of-Marks ID or data attributes
        const markedEl = document.querySelector(
          `[data-som-id="${cleanTgt}"], [data-nim-id="${cleanTgt}"], [id="${cleanTgt}"], [name="${cleanTgt}"]`
        );
        if (markedEl) return { resolved: cleanTgt, method: 'exact' as const };

        // 2. Semantic Drift Match: search interactive elements for matching text / aria
        if (cleanLabel || cleanTgt) {
          const searchKey = (cleanLabel || cleanTgt).toLowerCase();
          const interactives = Array.from(
            document.querySelectorAll(
              'button, a, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], .btn, .button'
            )
          ) as HTMLElement[];

          let bestMatch: HTMLElement | null = null;
          let bestScore = 0;

          for (const el of interactives) {
            // Visible check
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            const text = (el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
            const placeholder = (el.getAttribute('placeholder') || '').trim().toLowerCase();
            const name = (el.getAttribute('name') || '').trim().toLowerCase();
            const title = (el.getAttribute('title') || '').trim().toLowerCase();
            const value = (el as HTMLInputElement).value?.trim().toLowerCase() || '';

            // Exact match on any semantic attribute
            if (
              text === searchKey ||
              aria === searchKey ||
              placeholder === searchKey ||
              name === searchKey ||
              title === searchKey ||
              value === searchKey
            ) {
              bestMatch = el;
              bestScore = 100;
              break;
            }

            // Substring inclusion match
            if (
              (text && (text.includes(searchKey) || searchKey.includes(text))) ||
              (aria && (aria.includes(searchKey) || searchKey.includes(aria))) ||
              (placeholder && (placeholder.includes(searchKey) || searchKey.includes(placeholder)))
            ) {
              const score = Math.max(text.length, aria.length, placeholder.length);
              if (score > bestScore) {
                bestMatch = el;
                bestScore = score;
              }
            }
          }

          if (bestMatch) {
            // Assign a temporary unique attribute for immediate execution
            const tempId = `macro-target-${Date.now()}`;
            bestMatch.setAttribute('data-macro-resolved', tempId);
            return { resolved: `[data-macro-resolved="${tempId}"]`, method: 'semantic' as const };
          }
        }

        return { resolved: null, method: 'none' as const };
      },
      args: [target || '', recordedLabel || ''],
    });

    const res = results[0]?.result;
    return {
      resolvedTarget: res?.resolved ?? null,
      method: res?.method ?? 'none',
    };
  } catch {
    return { resolvedTarget: null, method: 'none' };
  }
}

/**
 * Self-healing fallback: Use a single fast LLM call to relocate a missing target on the current page.
 */
export async function healTargetWithLLM(
  tabId: number,
  action: MacroAction,
): Promise<string | null> {
  const workerConfig = await loadWorkerConfig();
  if (!workerConfig?.apiKey) return null;

  // Check budget before making self-heal LLM call
  const budget = await checkBudget(400, 0);
  if (!budget.allowed) return null;

  try {
    // 1. Extract visible interactive elements from the page
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const els = Array.from(
          document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="tab"]')
        ) as HTMLElement[];

        return els
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .slice(0, 35)
          .map((el, i) => {
            const tempId = `heal-opt-${i + 1}`;
            el.setAttribute('data-heal-id', tempId);
            return {
              healId: tempId,
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
              aria: el.getAttribute('aria-label') || '',
              placeholder: el.getAttribute('placeholder') || '',
              type: el.getAttribute('type') || '',
            };
          });
      },
    });

    const elements = results[0]?.result;
    if (!elements || elements.length === 0) return null;

    const providerConfig = {
      id: workerConfig.providerId,
      label: workerConfig.providerId,
      baseUrl: workerConfig.baseUrl ?? '',
      apiKey: workerConfig.apiKey,
    };

    const prompt = `PAGE INTERACTIVE ELEMENTS:\n${JSON.stringify(elements, null, 2)}\n\nFAILED ACTION TO HEAL:\nTool: ${action.tool}\nTarget Label: "${action.targetLabel || ''}"\nArgs: ${JSON.stringify(action.args || {})}\nReasoning: "${action.reasoning || ''}"\n\nTask: Find the single element from the list above that corresponds to this intended action. Respond ONLY with valid JSON in this exact format:\n{"healId": "heal-opt-X"}`;

    const res = await chatCompletion(providerConfig as Parameters<typeof chatCompletion>[0], {
      model: workerConfig.modelId ?? 'default',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 60,
    });

    await recordUsage(350, 0);

    const reply = (res.choices[0]?.message?.content || '').trim();
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { healId?: string };
      if (parsed.healId) {
        return `[data-heal-id="${parsed.healId}"]`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Execute a recorded Macro deterministically against a target browser tab.
 */
export async function executeMacro(
  macro: Macro,
  tabId: number,
  callbacks?: MacroExecutionCallbacks,
): Promise<MacroExecutionResult> {
  const stepResults: MacroStepResult[] = [];
  let stepsCompleted = 0;
  let totalTokens = 0;

  for (let i = 0; i < macro.actionSequence.length; i++) {
    const action = macro.actionSequence[i];
    const stepNumber = i + 1;

    callbacks?.onStepStart?.(stepNumber, macro.actionSequence.length, action);

    // 1. Safety Validation via action-validator
    const targetParam = (action.args?.target as string) || (action.args?.url as string) || '';
    const combinedDescriptor = [
      targetParam,
      action.targetLabel || '',
      action.reasoning || '',
    ].filter(Boolean).join(' ');

    const validation = await validateAction(
      action.tool,
      combinedDescriptor,
      [],
      macro.macroId,
    );

    if (validation.riskLevel === 'block' || validation.riskLevel === 'warn') {
      const errorMsg = `Action blocked by safety policy: ${validation.reason}`;
      const stepRes: MacroStepResult = {
        stepNumber,
        tool: action.tool,
        success: false,
        healed: false,
        error: errorMsg,
      };
      stepResults.push(stepRes);
      callbacks?.onStepComplete?.(stepNumber, macro.actionSequence.length, stepRes);

      await appendSecurityEvent({
        type: 'macro_executed',
        macroId: macro.macroId,
        macroName: macro.name,
        stepCount: stepsCompleted,
        success: false,
        error: errorMsg,
      });

      return {
        macroId: macro.macroId,
        name: macro.name,
        success: false,
        stepsCompleted,
        totalSteps: macro.actionSequence.length,
        stepResults,
        tokensUsed: totalTokens,
        error: errorMsg,
      };
    }

    // 2. Dispatch Action via direct tab scripting
    try {
      let stepSuccess = false;
      let healed = false;
      let effectiveTarget = targetParam;
      let resultMessage = '';

      if (action.tool === 'navigate_to') {
        const url = (action.args?.url as string) || '';
        if (url) {
          await chrome.tabs.update(tabId, { url });
          // Wait for load settle
          await new Promise((r) => setTimeout(r, 2000));
          stepSuccess = true;
          resultMessage = `Navigated to ${url}`;
        }
      } else if (
        ['click_element', 'type_text', 'select_option', 'press_key'].includes(action.tool)
      ) {
        // Resolve Target (Deterministic first, Self-Heal fallback)
        let resolved = await resolveTargetInPage(tabId, targetParam, action.targetLabel);

        if (!resolved.resolvedTarget) {
          // Self-Healing Fallback
          const healedTarget = await healTargetWithLLM(tabId, action);
          if (healedTarget) {
            effectiveTarget = healedTarget;
            healed = true;
            totalTokens += 350;
          } else {
            throw new Error(`Target "${targetParam}" (label: "${action.targetLabel || ''}") could not be located in page DOM.`);
          }
        } else {
          effectiveTarget = resolved.resolvedTarget;
        }

        // Execute atomic interaction inside page context
        const execResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: (toolName: string, targetSelector: string, val: string, opt: string, keyName: string) => {
            let el = document.querySelector<HTMLElement>(targetSelector);
            if (!el) {
              const numMatch = targetSelector.match(/^\[?(\d+)\]?$/) || targetSelector.match(/^id:(\d+)$/);
              if (numMatch) {
                el = document.querySelector<HTMLElement>(`[data-nim-id="${numMatch[1]}"]`);
              }
            }

            if (toolName === 'click_element') {
              if (!el) return { success: false, error: `Element not found: ${targetSelector}` };
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.focus?.();
              el.click();
              return { success: true };
            }

            if (toolName === 'type_text') {
              if (!el) return { success: false, error: `Element not found: ${targetSelector}` };
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.focus?.();
              const inputEl = el as HTMLInputElement;
              const prototype = Object.getPrototypeOf(inputEl);
              const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
              if (prototypeValueSetter) {
                prototypeValueSetter.call(inputEl, val);
              } else {
                inputEl.value = val;
              }
              inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              return { success: true };
            }

            if (toolName === 'select_option') {
              if (!el) return { success: false, error: `Select element not found: ${targetSelector}` };
              const sel = el as HTMLSelectElement;
              const matchingOpt = Array.from(sel.options).find((o) => o.text.includes(opt) || o.value === opt);
              if (matchingOpt) {
                sel.value = matchingOpt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true };
              }
              return { success: false, error: `Option "${opt}" not found` };
            }

            if (toolName === 'press_key') {
              const active = el || (document.activeElement as HTMLElement) || document.body;
              active.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true }));
              active.dispatchEvent(new KeyboardEvent('keyup', { key: keyName, bubbles: true }));
              return { success: true };
            }

            return { success: true };
          },
          args: [
            action.tool,
            effectiveTarget,
            (action.args?.value as string) || '',
            (action.args?.option as string) || '',
            (action.args?.key as string) || '',
          ],
        });

        const execRes = execResults[0]?.result as { success: boolean; error?: string } | undefined;
        if (execRes && execRes.success) {
          stepSuccess = true;
          resultMessage = `Executed ${action.tool} on target ${effectiveTarget}${healed ? ' (Self-Healed)' : ''}`;
        } else {
          throw new Error(execRes?.error || `Script execution failed for ${action.tool}`);
        }

        // Settle delay between UI interactions
        await new Promise((r) => setTimeout(r, 600));
      } else if (action.tool === 'scroll_page') {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (dir: string, px: number, sel: string) => {
            if (dir === 'to_element' && sel) {
              document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return;
            }
            const amount = px || window.innerHeight * 0.8;
            window.scrollBy({ top: dir === 'down' ? amount : -amount, behavior: 'smooth' });
          },
          args: [
            (action.args?.direction as string) || 'down',
            Number(action.args?.pixels) || 0,
            (action.args?.selector as string) || '',
          ],
        });
        stepSuccess = true;
        resultMessage = `Scrolled page ${action.args?.direction || 'down'}`;
        await new Promise((r) => setTimeout(r, 400));
      } else if (action.tool === 'wait_for') {
        const ms = Number(action.args?.ms) || 1000;
        await new Promise((r) => setTimeout(r, Math.min(ms, 5000)));
        stepSuccess = true;
        resultMessage = `Waited ${ms}ms`;
      } else {
        // Generic fallback for other non-DOM tools
        stepSuccess = true;
        resultMessage = `Step ${action.tool} marked completed`;
      }

      const stepRes: MacroStepResult = {
        stepNumber,
        tool: action.tool,
        success: stepSuccess,
        healed,
        target: effectiveTarget,
        result: resultMessage,
      };

      stepResults.push(stepRes);
      stepsCompleted++;
      callbacks?.onStepComplete?.(stepNumber, macro.actionSequence.length, stepRes);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const stepRes: MacroStepResult = {
        stepNumber,
        tool: action.tool,
        success: false,
        healed: false,
        error: errorMsg,
      };
      stepResults.push(stepRes);
      callbacks?.onStepComplete?.(stepNumber, macro.actionSequence.length, stepRes);

      await appendSecurityEvent({
        type: 'macro_executed',
        macroId: macro.macroId,
        macroName: macro.name,
        stepCount: stepsCompleted,
        success: false,
        error: errorMsg,
      });

      return {
        macroId: macro.macroId,
        name: macro.name,
        success: false,
        stepsCompleted,
        totalSteps: macro.actionSequence.length,
        stepResults,
        tokensUsed: totalTokens,
        error: errorMsg,
      };
    }
  }

  // 3. Update Macro run count on successful completion
  await saveMacro({
    ...macro,
    runCount: macro.runCount + 1,
  });

  await appendSecurityEvent({
    type: 'macro_executed',
    macroId: macro.macroId,
    macroName: macro.name,
    stepCount: stepsCompleted,
    success: true,
  });

  return {
    macroId: macro.macroId,
    name: macro.name,
    success: true,
    stepsCompleted,
    totalSteps: macro.actionSequence.length,
    stepResults,
    tokensUsed: totalTokens,
  };
}
