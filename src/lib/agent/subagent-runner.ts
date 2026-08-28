import { openBackgroundTab, closeTabs, readTabContent } from './tools/tab-manager';
import { extractTableFromPage } from './tools/table-extractor';
import { chatCompletion } from '../llm/client';
import type { ProviderConfig } from '../llm/types';
import type { DiscoveredModel } from '../llm/model-registry';
import { AgentEngine } from './engine';
import { waitForDOMSettle } from './tools/wait-utils';
import {
  publishFinding,
  getFindings,
  isGoalSatisfied,
  clearBlackboard,
} from './blackboard';
import { checkWorkerBudget, recordWorkerUsage, clearWorkerBudget } from './cost-guard';

export interface SubAgentTask {
  name: string;
  url: string;
  instruction: string;
  maxSteps?: number;
  mode?: 'extract' | 'interact';
}

export interface SubAgentResult {
  name: string;
  url: string;
  success: boolean;
  summary: string;
  tableData?: string;
  error?: string;
}

export interface ParallelRunnerOptions {
  workerProviderConfig: ProviderConfig;
  workerModel: DiscoveredModel;
  parentTaskId?: string;
  costLimits?: import('./cost-guard').CostLimits;
  onProgress?: (taskName: string, status: 'started' | 'loaded' | 'analyzing' | 'done' | 'error', detail?: string) => void;
}

/**
 * Sub-agent tool allowlist - interaction tools with domain-locked navigation
 */
const SUBAGENT_TOOL_ALLOWLIST = [
  'navigate_to',
  'read_page',
  'click_element',
  'type_text',
  'select_option',
  'press_key',
  'scroll_page',
  'wait_for',
  'extract_table',
  'screenshot',
  'summarize',
  'fill_form',
];

/**
 * Fast extraction mode - lightweight path for pure scraping
 */
async function runSingleSubagentExtractMode(
  task: SubAgentTask,
  options: ParallelRunnerOptions,
  groupId: string,
): Promise<{ result: SubAgentResult; tabId?: number }> {
  // Check if goal was already satisfied by a sibling worker
  const goalCheck = isGoalSatisfied(groupId);
  if (goalCheck.satisfied) {
    return {
      result: {
        name: task.name,
        url: task.url,
        success: true,
        summary: `[Goal satisfied early by sibling sub-agent]: ${goalCheck.summary}`,
      },
    };
  }

  options.onProgress?.(task.name, 'started', `Opening background tab for ${task.url}`);

  let tab: chrome.tabs.Tab | undefined;
  try {
    // 1. Open background tab and wait for load with proper DOM settle
    tab = await openBackgroundTab(task.url, 10000);
    if (!tab?.id) {
      throw new Error(`Failed to create browser tab for ${task.url}`);
    }

    await waitForDOMSettle(tab.id, 1500);

    options.onProgress?.(task.name, 'loaded', `Page loaded. Extracting content...`);

    // 2. Read page text and check for tables concurrently
    const pageText = await readTabContent(tab.id, 10000);
    const tableRes = await extractTableFromPage(tab.id);
    const tableCsv = !('error' in tableRes) && tableRes.rowCount > 0 ? tableRes.csv : undefined;

    // Quarantine sanitization for sub-agent content
    let sanitizedContent = pageText;
    try {
      const { sanitizeWithQuarantine } = await import('./quarantine');
      const clean = await sanitizeWithQuarantine(
        pageText,
        task.url,
        options.workerProviderConfig,
        options.workerModel.id,
      );
      sanitizedContent = clean.keyFacts.join('\n');
    } catch (err: unknown) {
      const { InjectionDetectedError } = await import('./quarantine');
      if (err instanceof InjectionDetectedError) {
        return {
          tabId: tab.id,
          result: {
            name: task.name,
            url: task.url,
            success: false,
            summary: `SECURITY_BLOCKED: Prompt injection detected on ${task.url}. ${err.details}`,
            error: 'Injection detected',
          },
        };
      }
      // Strict security: On non-detection quarantine failure, withhold unverified raw content
      console.warn('Quarantine check failed for sub-agent:', err);
      sanitizedContent = `[Warning: Page content at ${task.url} could not be verified by security quarantine: ${err instanceof Error ? err.message : 'verification error'}. Content withheld for safety.]`;
    }

    options.onProgress?.(task.name, 'analyzing', `Analyzing extracted data with worker LLM...`);

    // Dynamic cost estimation & worker quota check
    const estimatedTokens = Math.ceil((sanitizedContent.length + task.instruction.length) / 4) + 1500;
    const workerQuota = checkWorkerBudget(`${groupId}:${task.name}`, estimatedTokens, 25_000);
    if (!workerQuota.allowed) {
      return {
        tabId: tab.id,
        result: {
          name: task.name,
          url: task.url,
          success: false,
          summary: `Sub-agent quota exceeded: ${workerQuota.reason}`,
          error: 'Worker token limit reached',
        },
      };
    }

    // 3. Prompt the worker LLM to process and extract target facts
    const workerPrompt = `You are a specialized sub-agent researching a specific web page.
TARGET URL: ${task.url}
SUB-TASK INSTRUCTION: ${task.instruction}

PAGE TEXT EXTRACT:
${sanitizedContent || '(No text could be extracted)'}
${tableCsv ? `\nPAGE TABLE DATA (CSV):\n${tableCsv.slice(0, 3000)}` : ''}

INSTRUCTIONS:
1. Extract ALL relevant items, prices, specs, ratings, and answers matching the sub-task instruction.
2. Present the extracted information as a clean markdown bullet list or table.
3. Be concise, accurate, and include specific prices and model numbers found on the page.`;

    const response = await chatCompletion(options.workerProviderConfig, {
      model: options.workerModel.id,
      messages: [
        { role: 'system', content: 'You are a precise data extraction sub-agent. Return clean facts and structured markdown.' },
        { role: 'user', content: workerPrompt },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    if (response.usage) {
      recordWorkerUsage(`${groupId}:${task.name}`, response.usage.total_tokens);
    }

    const summary = response.choices[0]?.message?.content?.trim() || 'No data extracted.';
    options.onProgress?.(task.name, 'done', `Completed extraction for ${task.name}`);

    // Publish finding to blackboard
    publishFinding(groupId, {
      sourceWorker: task.name,
      sourceUrl: task.url,
      key: 'summary',
      value: summary,
    });

    return {
      tabId: tab.id,
      result: {
        name: task.name,
        url: task.url,
        success: true,
        summary,
        tableData: tableCsv,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    options.onProgress?.(task.name, 'error', errorMsg);
    return {
      tabId: tab?.id,
      result: {
        name: task.name,
        url: task.url,
        success: false,
        summary: `Failed to research ${task.url}: ${errorMsg}`,
        error: errorMsg,
      },
    };
  }
}

/**
 * Interactive mode - full AgentEngine with constrained tools and child tab tracking
 */
async function runSingleSubagentInteractMode(
  task: SubAgentTask,
  options: ParallelRunnerOptions,
  groupId: string,
  extraTabIds: number[],
): Promise<{ result: SubAgentResult; tabId?: number }> {
  // Check if goal was already satisfied by a sibling worker
  const goalCheck = isGoalSatisfied(groupId);
  if (goalCheck.satisfied) {
    return {
      result: {
        name: task.name,
        url: task.url,
        success: true,
        summary: `[Goal satisfied early by sibling sub-agent]: ${goalCheck.summary}`,
      },
    };
  }

  options.onProgress?.(task.name, 'started', `Opening background tab for ${task.url}`);

  let tab: chrome.tabs.Tab | undefined;
  let tabCreatedListener: ((createdTab: chrome.tabs.Tab) => void) | undefined;

  try {
    // 1. Open background tab and wait for load with proper DOM settle
    tab = await openBackgroundTab(task.url, 10000);
    if (!tab?.id) {
      throw new Error(`Failed to create browser tab for ${task.url}`);
    }

    const initialTabId = tab.id;

    // Track any popup or target="_blank" child tabs opened by this sub-agent
    tabCreatedListener = (createdTab: chrome.tabs.Tab) => {
      if (createdTab.openerTabId === initialTabId && createdTab.id) {
        extraTabIds.push(createdTab.id);
      }
    };
    chrome.tabs.onCreated.addListener(tabCreatedListener);

    await waitForDOMSettle(tab.id, 1500);

    options.onProgress?.(task.name, 'loaded', `Page loaded. Launching interactive worker...`);

    const hostname = new URL(task.url).hostname;
    const subTaskId = `${groupId}:sub:${task.name}`;

    // 2. Create a constrained AgentEngine for this worker
    const worker = new AgentEngine(
      subTaskId,
      task.instruction,
      {
        providerConfig: options.workerProviderConfig,
        model: options.workerModel,
        maxIterations: task.maxSteps ?? 8,
        pinnedTabId: tab.id,
        initialHostname: hostname,
        toolAllowlist: SUBAGENT_TOOL_ALLOWLIST,
        costLimits: options.costLimits,
        visionOptIn: options.workerModel.supportsVision ?? false,
      },
      {
        onStep: (_n, reasoning) => {
          options.onProgress?.(task.name, 'analyzing', reasoning.slice(0, 100));
        },
        // Delegated HITL with safe search form bypass & async sidepanel queue
        onHITLRequired: async (action, reason) => {
          const safePattern = /search|filter|sort|find|query|apply/i;
          const actionTarget = (action as { target?: string; url?: string }).target ?? (action as { url?: string }).url ?? '';
          if (safePattern.test(reason) || safePattern.test(action.tool) || safePattern.test(actionTarget)) {
            return true;
          }

          options.onProgress?.(task.name, 'analyzing', `Requesting approval for: ${reason}`);

          chrome.runtime.sendMessage({
            type: 'SUBAGENT_HITL_REQUEST',
            taskId: subTaskId,
            action: action as Record<string, unknown>,
            reason,
          }).catch(() => {});

          return new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (approved: boolean) => {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                chrome.runtime.onMessage.removeListener(msgListener);
                resolve(approved);
              }
            };

            const timer = setTimeout(() => {
              options.onProgress?.(task.name, 'error', `Approval timed out: ${reason}`);
              finish(false);
            }, 30_000);

            const msgListener = (msg: unknown) => {
              const m = msg as { type?: string; taskId?: string; approved?: boolean };
              if (m?.type === 'SUBAGENT_HITL_RESPONSE' && m?.taskId === subTaskId) {
                finish(!!m.approved);
              }
            };
            chrome.runtime.onMessage.addListener(msgListener);
          });
        },
      },
    );

    // 3. Run the worker's full agentic loop
    const summary = await worker.run();

    options.onProgress?.(task.name, 'done', `Completed interactive research for ${task.name}`);

    // Publish finding to blackboard
    publishFinding(groupId, {
      sourceWorker: task.name,
      sourceUrl: task.url,
      key: 'summary',
      value: summary,
    });

    return {
      tabId: tab.id,
      result: {
        name: task.name,
        url: task.url,
        success: true,
        summary,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    options.onProgress?.(task.name, 'error', errorMsg);
    return {
      tabId: tab?.id,
      result: {
        name: task.name,
        url: task.url,
        success: false,
        summary: `Failed to research ${task.url}: ${errorMsg}`,
        error: errorMsg,
      },
    };
  } finally {
    if (tabCreatedListener) {
      chrome.tabs.onCreated.removeListener(tabCreatedListener);
    }
  }
}

/**
 * Executes a single sub-agent worker - routes to extract or interact mode
 */
async function runSingleSubagent(
  task: SubAgentTask,
  options: ParallelRunnerOptions,
  groupId: string,
  extraTabIds: number[],
): Promise<{ result: SubAgentResult; tabId?: number }> {
  const mode = task.mode ?? 'interact';
  
  if (mode === 'extract') {
    return runSingleSubagentExtractMode(task, options, groupId);
  } else {
    return runSingleSubagentInteractMode(task, options, groupId, extraTabIds);
  }
}

/**
 * Run multiple sub-agents in parallel across separate background tabs with Blackboard coordination.
 */
export async function executeParallelSubagents(
  tasks: SubAgentTask[],
  options: ParallelRunnerOptions,
): Promise<{
  results: SubAgentResult[];
  formattedReport: string;
}> {
  const createdTabIds: number[] = [];
  const extraChildTabIds: number[] = [];
  const groupId = options.parentTaskId || crypto.randomUUID();

  try {
    // Launch all sub-agent workers concurrently with Blackboard event bus
    const settled = await Promise.allSettled(
      tasks.map((task) => runSingleSubagent(task, options, groupId, extraChildTabIds)),
    );

    const results: SubAgentResult[] = [];

    for (const item of settled) {
      if (item.status === 'fulfilled') {
        if (item.value.tabId) createdTabIds.push(item.value.tabId);
        results.push(item.value.result);
      } else {
        results.push({
          name: 'Sub-agent Task',
          url: '',
          success: false,
          summary: `Worker task failed: ${item.reason}`,
          error: String(item.reason),
        });
      }
    }

    // Retrieve any structured findings from the shared Blackboard
    const blackboardFindings = getFindings(groupId);
    const hasFindings = blackboardFindings.length > 0;

    // Format consolidated report for the main orchestrator agent
    const reportBlocks = results.map((r, idx) => {
      return `### Source ${idx + 1}: ${r.name} (${r.url})\nStatus: ${r.success ? '✅ Success' : '❌ Error'}\nFindings:\n${r.summary}\n${r.tableData ? `\nStructured Table:\n${r.tableData.slice(0, 2000)}\n` : ''}`;
    });

    const formattedReport = `PARALLEL MULTI-TAB RESEARCH REPORT (${results.length} sources processed simultaneously${hasFindings ? `, ${blackboardFindings.length} blackboard findings synchronized` : ''}):\n\n${reportBlocks.join('\n---\n')}`;

    return {
      results,
      formattedReport,
    };
  } finally {
    // Clean up worker budget & blackboard
    clearBlackboard(groupId);
    for (const task of tasks) {
      clearWorkerBudget(`${groupId}:${task.name}`);
    }

    // Cleanly close all created background tabs and any child popup tabs
    const allTabsToClose = [...createdTabIds, ...extraChildTabIds];
    if (allTabsToClose.length > 0) {
      await closeTabs(allTabsToClose);
    }
  }
}
