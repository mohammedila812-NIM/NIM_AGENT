import { defineBackground } from 'wxt/utils/define-background';
import { initPortManager, onPort } from '../lib/messaging/port-manager';
import { findInterruptedTasks, saveCheckpoint, loadCheckpoint, type AgentCheckpoint } from '../lib/agent/checkpoint';
import { AgentEngine } from '../lib/agent/engine';
import { loadProviderKeys, loadWorkerConfig } from '../lib/storage/secure';
import { getPreset } from '../lib/llm/providers';
import type { ProviderConfig } from '../lib/llm/types';
import { isChatModel, inferVisionSupport, type DiscoveredModel } from '../lib/llm/model-registry';
import { resetTaskCounters, checkBudget } from '../lib/agent/cost-guard';
import { saveTask } from '../lib/storage/tasks';
import { recordTaskCompletion } from '../lib/agent/session-store';
import { sliceRecentPrompts } from '../lib/agent/session-memory';
import { wrapUntrustedContent } from '../lib/agent/prompts';
import { isValidMessage } from '../lib/messaging/protocol';
import { fxUpdatePill, fxRemovePill } from '../lib/agent/page-effects';
import { syncWatchAlarms, loadWatch } from '../lib/storage/watch';
import { executeWatchCheck } from '../lib/agent/watch-engine';
import { setupContextMenus } from '../lib/agent/context-menu';
import {
  getActiveWatcher,
  removeActiveWatcher,
  saveUnseenAlert,
  updateExtensionBadge,
} from '../lib/agent/sentinel/sentinel-registry';
import { startPageChangeDetector } from '../lib/agent/sentinel/change-detector';
import { cdpSession } from '../lib/agent/devtools/cdp-session';
import { specialistRegistry } from '../lib/agent/specialist/specialist-registry';

let activeEngine: AgentEngine | null = null;
let activeRunPromise: Promise<void> | null = null;

// Map of tabId -> timestamp of last agent action (Finding 8: Loop prevention)
const lastAgentActionTimestamps = new Map<number, number>();
const notificationTabMap = new Map<string, number>();

// Rate limiting state for sentinel watches: key is `${tabId}:${target}`
interface WatchRateLimitState {
  lastTriggerTimestamp: number;
  triggerTimestampsHour: number[];
}
const watchRateLimits = new Map<string, WatchRateLimitState>();

interface QueuedSentinelTask {
  taskId: string;
  instruction: string;
  pinnedTabId?: number;
  summary: string;
  timestamp: number;
}
const queuedSentinelTasks: QueuedSentinelTask[] = [];

function isExtensionOrigin(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url) return false;
  const extUrlPrefix = chrome.runtime.getURL('');
  return sender.id === chrome.runtime.id && !sender.tab && sender.url.startsWith(extUrlPrefix);
}

const connectedPorts = new Set<chrome.runtime.Port>();
function broadcast(msg: Record<string, unknown>): void {
  // Send to all connected sidepanel ports
  for (const port of connectedPorts) {
    try {
      port.postMessage(msg);
    } catch {
      connectedPorts.delete(port);
    }
  }
  // Fallback broadcast via runtime message
  chrome.runtime.sendMessage(msg).catch(() => {});
}

export default defineBackground(() => {
  initPortManager();
  setupContextMenus();
  void cdpSession.detachOrphanedSessions();
  void specialistRegistry.recoverOrphanedJobs();

  // Handle stream port from sidepanel
  onPort('sidepanel-stream', (port) => {
    connectedPorts.add(port);

    port.onMessage.addListener((msg) => {
      if (msg.type === 'HEARTBEAT') {
        port.postMessage({ type: 'PONG' });
      }
    });

    port.onDisconnect.addListener(() => {
      connectedPorts.delete(port);
    });
  });

  // Open side panel on action button click
  chrome.action?.onClicked?.addListener((tab) => {
    if (tab.id && chrome.sidePanel?.open) {
      chrome.sidePanel.open({ tabId: tab.id });
    }
  });

  // Check for interrupted tasks on worker wake
  void recoverInterruptedTasks();

  // Sync scheduled monitors (Watch Mode alarms)
  void syncWatchAlarms();

  // Handle scheduled watch alarms
  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm.name.startsWith('watch:')) {
      const watchId = alarm.name.replace(/^watch:/, '');
      void executeWatchCheck(watchId);
    }
  });

  // Handle browser alert notification clicks (opens target URL)
  chrome.notifications?.onClicked?.addListener(async (notifId) => {
    if (notifId.startsWith('watch-alert-')) {
      const parts = notifId.split('-');
      const watchId = parts[2];
      if (watchId) {
        const watch = await loadWatch(watchId);
        if (watch?.url) {
          chrome.tabs.create({ url: watch.url });
        }
      }
    } else if (notifId.startsWith('sentinel-alert-')) {
      const tabId = notificationTabMap.get(notifId);
      if (tabId && chrome.tabs?.get) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab?.windowId && chrome.windows?.update) {
            await chrome.windows.update(tab.windowId, { focused: true });
          }
          await chrome.tabs.update(tabId, { active: true });
        } catch { /* tab may have closed */ }
      }
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id && chrome.sidePanel?.open) {
        chrome.sidePanel.open({ tabId: activeTab.id }).catch(() => {});
      }
    }
  });

  // Auto-restore active watchers across tab reloads (Finding 15)
  if (chrome.tabs?.onUpdated) {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
      if (changeInfo.status === 'complete') {
        const activeWatcher = await getActiveWatcher(tabId);
        if (activeWatcher) {
          try {
            await startPageChangeDetector(tabId, activeWatcher.options);
          } catch (err) {
            console.warn(`[Sentinel] Failed to re-inject watcher on tab ${tabId}:`, err);
          }
        }
      }
    });
  }

  // Cleanup watcher registry when tab closes (Finding 15)
  if (chrome.tabs?.onRemoved) {
    chrome.tabs.onRemoved.addListener(async (tabId) => {
      await removeActiveWatcher(tabId);
      await updateExtensionBadge();
    });
  }

  // Main agent communication listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // SECURITY: Reject foreign senders
    if (sender.id !== chrome.runtime.id) {
      console.warn('[Security] Rejecting message from foreign extension:', sender.id);
      return false;
    }

    if (!isValidMessage(message)) {
      return false;
    }

    if (message.type === 'AGENT_START') {
      if (!isExtensionOrigin(sender)) {
        console.warn('[Security] Rejecting AGENT_START from unauthorized origin:', sender.url || sender.tab?.id);
        sendResponse({ status: 'rejected', error: 'Unauthorized sender origin' });
        return true;
      }
      void handleAgentStart(
        message.taskId,
        message.instruction,
        message.modelId,
        message.visionOptIn,
        undefined,
        message.conversationHistory,
      );
      sendResponse({ status: 'started' });
      return true;
    }

    if (message.type === 'HITL_RESPONSE') {
      if (!isExtensionOrigin(sender)) {
        console.warn('[Security] Rejecting HITL_RESPONSE from unauthorized origin:', sender.url || sender.tab?.id);
        sendResponse({ status: 'rejected', error: 'Unauthorized sender origin' });
        return true;
      }
    }

    if (message.type === 'AGENT_RESUME') {
      void handleAgentResume(message.taskId);
      sendResponse({ status: 'resuming' });
      return true;
    }

    if (message.type === 'AGENT_STOP') {
      if (activeEngine) {
        activeEngine.abort();
        activeEngine = null;
      }
      void cdpSession.detachAll('Agent stopped');
      if (message.taskId) {
        void specialistRegistry.cancelAllForTask(message.taskId);
      }
      sendResponse({ status: 'stopped' });
      return true;
    }

    if (message.type === 'DEVTOOLS_KILL_SWITCH') {
      if (!isExtensionOrigin(sender)) {
        sendResponse({ success: false, error: 'Unauthorized origin' });
        return true;
      }
      void cdpSession.detachAll('Kill switch activated from sidepanel');
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'PAGE_CHANGE_DETECTED') {
      const sourceTabId = sender.tab?.id ?? message.tabId;

      // Loop prevention (Finding 8): ignore changes caused by the agent's own action (within 10s)
      if (sourceTabId) {
        const lastAction = lastAgentActionTimestamps.get(sourceTabId);
        if (lastAction && Date.now() - lastAction < 10_000) {
          console.log(`[Sentinel] Suppressed alert on tab ${sourceTabId} — change caused by agent activity ${Date.now() - lastAction}ms ago.`);
          sendResponse({ received: true, suppressed: 'agent_activity_cooldown' });
          return true;
        }
      }

      // Per-watch rate limiting and cooldown (Finding 6)
      const rateLimitKey = `${sourceTabId ?? 0}:${message.target}`;
      const now = Date.now();
      let rateState = watchRateLimits.get(rateLimitKey);
      if (!rateState) {
        rateState = { lastTriggerTimestamp: 0, triggerTimestampsHour: [] };
        watchRateLimits.set(rateLimitKey, rateState);
      }

      rateState.triggerTimestampsHour = rateState.triggerTimestampsHour.filter((t) => now - t < 3_600_000);
      const inCooldown = now - rateState.lastTriggerTimestamp < 30_000;
      const hourlyExceeded = rateState.triggerTimestampsHour.length >= 10;

      if (message.actionOnDetect === 'auto_act' && message.autonomousInstruction) {
        if (inCooldown || hourlyExceeded) {
          console.warn(`[Sentinel] Rate limit reached on "${message.target}" (cooldown=${inCooldown}, hourly=${hourlyExceeded}). Autonomous trigger suppressed.`);
          broadcast({
            type: 'TASK_STATUS',
            taskId: `sentinel-rate-limit-${now}`,
            status: 'error',
            detail: `Sentinel autonomous action rate-limited on "${message.target}". Next check allowed after cooldown.`,
          });
        } else {
          rateState.lastTriggerTimestamp = now;
          rateState.triggerTimestampsHour.push(now);

          const taskId = `sentinel-auto-${now}`;
          let autoInstruction = message.autonomousInstruction;
          if (message.summary) {
            const demarcated = wrapUntrustedContent(message.summary, 'sentinel:change_summary');
            autoInstruction = `${message.autonomousInstruction}\n\nContext regarding detected page change:\n${demarcated}`;
          }

          // Do not abort running task for sentinel trigger (Finding 6)
          if (activeEngine) {
            console.log(`[Sentinel] Existing task running; queueing autonomous trigger for tab ${sourceTabId}.`);
            queuedSentinelTasks.push({
              taskId,
              instruction: autoInstruction,
              pinnedTabId: sourceTabId,
              summary: message.summary,
              timestamp: now,
            });
            broadcast({
              type: 'TASK_STATUS',
              taskId,
              status: 'hitl_waiting',
              detail: `Change detected on "${message.target}". Autonomous task queued behind running task.`,
            });
          } else {
            // Check daily budget for autonomous runs (Finding 6)
            void (async () => {
              const settings = (await chrome.storage.local.get(['costLimits'])) as {
                costLimits?: import('../lib/agent/cost-guard').CostLimits;
              };
              const budgetCheck = await checkBudget(1000, 2.0, settings.costLimits);
              if (!budgetCheck.allowed) {
                console.warn('[Sentinel] Autonomous run blocked by budget:', budgetCheck.reason);
                broadcast({
                  type: 'TASK_STATUS',
                  taskId,
                  status: 'error',
                  detail: `Autonomous trigger blocked: ${budgetCheck.reason}`,
                });
                return;
              }
              // Pin the watched tab! (Finding 5)
              void handleAgentStart(taskId, autoInstruction, undefined, false, undefined, undefined, sourceTabId, true);
            })();
          }
        }
      }

      broadcast(message);
      const safeSummary = message.summary
        ? (message.summary.length > 80 ? `${message.summary.slice(0, 80)}...` : message.summary)
        : 'Activity detected';

      const notifId = `sentinel-alert-${sourceTabId ?? 0}-${Date.now()}`;
      if (sourceTabId) {
        notificationTabMap.set(notifId, sourceTabId);
        void saveUnseenAlert({
          alertId: notifId,
          tabId: sourceTabId,
          target: message.target,
          summary: safeSummary,
          timestamp: message.timestamp || Date.now(),
          url: message.url || '',
        });
        void updateExtensionBadge();
      }

      if (chrome.notifications?.create) {
        try {
          chrome.notifications.create(notifId, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon.png'),
            title: 'NIM Sentinel: Change Detected',
            message: safeSummary,
            priority: 2,
            requireInteraction: true,
          });
        } catch { /* notifications permission or platform limitation */ }
      }
      sendResponse({ received: true });
      return true;
    }

    if (message.type === 'SENTINEL_TRIGGER_ACTION') {
      if (!isExtensionOrigin(sender)) {
        console.warn('[Security] Rejecting SENTINEL_TRIGGER_ACTION from unauthorized origin:', sender.url || sender.tab?.id);
        sendResponse({ status: 'rejected', error: 'Unauthorized sender origin' });
        return true;
      }
      const taskId = `sentinel-action-${Date.now()}`;
      let finalInstruction = message.instruction;
      if (message.changeSummary) {
        const demarcated = wrapUntrustedContent(message.changeSummary, 'sentinel:change_summary');
        finalInstruction = `${message.instruction}\n\nContext regarding detected page change:\n${demarcated}`;
      }
      void handleAgentStart(taskId, finalInstruction, undefined, false, undefined, undefined, message.tabId);
      sendResponse({ status: 'triggered', taskId });
      return true;
    }

    return false;
  });
});

async function handleAgentResume(taskId: string): Promise<void> {
  const cp = await loadCheckpoint(taskId);
  if (!cp) {
    broadcast({
      type: 'TASK_STATUS',
      taskId,
      status: 'error',
      detail: `No saved checkpoint found for task ${taskId}`,
    });
    return;
  }

  broadcast({
    type: 'TASK_RESUMING',
    taskId,
    fromStep: cp.currentStepIndex,
  });

  await handleAgentStart(cp.taskId, cp.originalIntent, undefined, false, cp);
}

async function handleAgentStart(
  taskId: string,
  instruction: string,
  modelId?: string,
  visionOptIn = false,
  initialCheckpoint?: AgentCheckpoint,
  conversationHistory?: import('../lib/messaging/protocol').ConversationTurn[],
  pinnedTabId?: number,
  isAutonomous = false,
): Promise<void> {
  // Gracefully abort prior activeEngine and await its completion before starting the new one (Finding 9)
  if (activeEngine) {
    activeEngine.abort();
    if (activeRunPromise) {
      try {
        await activeRunPromise;
      } catch { /* ignore */ }
    }
  }

  // Reset per-task token counter only for user-initiated tasks, not autonomous triggers (Finding 6)
  if (!initialCheckpoint && !isAutonomous) {
    await resetTaskCounters();
  }

  const taskCreatedAt = initialCheckpoint ? initialCheckpoint.timestamp : Date.now();
  await saveTask({
    taskId,
    instruction,
    status: 'running',
    createdAt: taskCreatedAt,
    updatedAt: Date.now(),
  });

  const settings = (await chrome.storage.local.get([
    'activeProviderId',
    'customBaseUrl',
    'selectedModelId',
    'selectedModel',
    'searchProvider',
    'costLimits',
  ])) as {
    activeProviderId?: string;
    customBaseUrl?: string;
    selectedModelId?: string;
    selectedModel?: DiscoveredModel;
    searchProvider?: 'brave' | 'serper';
    costLimits?: import('../lib/agent/cost-guard').CostLimits;
  };

  const providerId = settings.activeProviderId || 'nim-cloud';
  const keys = await loadProviderKeys(providerId);

  if (!keys?.llmApiKey) {
    const errorMsg = 'No API Key found in session. Please go to Settings (gear icon) and enter your API key.';
    await saveTask({
      taskId,
      instruction,
      status: 'error',
      createdAt: taskCreatedAt,
      updatedAt: Date.now(),
      result: errorMsg,
    });
    broadcast({
      type: 'TASK_STATUS',
      taskId,
      status: 'error',
      detail: errorMsg,
    });
    return;
  }

  const preset = getPreset(providerId);
  const providerConfig: ProviderConfig = {
    id: providerId,
    label: preset?.label ?? 'Provider',
    baseUrl: (providerId === 'custom' && settings.customBaseUrl) ? settings.customBaseUrl : (preset?.baseUrl || 'https://integrate.api.nvidia.com/v1'),
    apiKey: keys.llmApiKey,
  };

  let chosenModelId = modelId || settings.selectedModelId;

  // Provider-aware default model: each provider has a sane default
  const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
    'nim-cloud':  'meta/llama-3.2-11b-vision-instruct',
    'nim-local':  'meta/llama-3.2-11b-vision-instruct',
    'gemini':     'gemini-2.0-flash',
    'openai':     'gpt-4o-mini',
    'groq':       'llama-3.3-70b-versatile',
    'ollama':     'llama3.2',
    'kira':       'llama-3.3-70b-versatile',
    'custom':     'gpt-4o-mini',
  };

  if (!chosenModelId || !isChatModel(chosenModelId) || chosenModelId === 'meta/llama-3.3-70b-instruct') {
    chosenModelId = PROVIDER_DEFAULT_MODELS[providerId] ?? 'meta/llama-3.2-11b-vision-instruct';
  }

  const modelSupportsVision = inferVisionSupport(chosenModelId);
  const model: DiscoveredModel =
    settings.selectedModel &&
    isChatModel(settings.selectedModel.id) &&
    settings.selectedModel.id === chosenModelId
      ? { ...settings.selectedModel, supportsVision: modelSupportsVision }
      : {
          id: chosenModelId,
          contextLength: chosenModelId.includes('gemini') ? 1_000_000 : 128_000,
          supportsTools: true,
          supportsVision: modelSupportsVision,
          isAgentTuned: true,
          providerLabel: providerConfig.label,
        };

  const workerConfig = await loadWorkerConfig();
  const workerPreset = workerConfig?.providerId ? getPreset(workerConfig.providerId) : undefined;
  const workerProviderConfig: ProviderConfig | undefined = workerConfig?.apiKey ? {
    id: workerConfig.providerId || 'nim-cloud',
    label: workerPreset?.label ?? 'Worker',
    baseUrl: (workerConfig.providerId === 'custom' && workerConfig.baseUrl) ? workerConfig.baseUrl : (workerPreset?.baseUrl || 'https://integrate.api.nvidia.com/v1'),
    apiKey: workerConfig.apiKey,
  } : undefined;

  const workerModel: DiscoveredModel | undefined = workerConfig?.modelId ? {
    id: workerConfig.modelId,
    contextLength: 128_000,
    supportsTools: true,
    supportsVision: inferVisionSupport(workerConfig.modelId),
    isAgentTuned: true,
    providerLabel: workerProviderConfig?.label ?? 'Worker',
  } : undefined;

  // Models without vision support must never receive visionOptIn
  const effectiveVisionOptIn = model.supportsVision ? visionOptIn : false;

  const engine = new AgentEngine(
    taskId,
    instruction,
    {
      providerConfig,
      workerProviderConfig,
      workerModel,
      searchConfig: keys.searchApiKey
        ? {
            provider: keys.searchProvider || settings.searchProvider || 'brave',
            apiKey: keys.searchApiKey,
          }
        : undefined,
      model,
      visionOptIn: effectiveVisionOptIn,
      costLimits: settings.costLimits,
      conversationHistory: conversationHistory ? sliceRecentPrompts(conversationHistory, 2) : undefined,
      triadMode: true,
      pinnedTabId,
      isAutonomous,
    },
    {
      onStep: (stepNumber, reasoning, tool, result) => {
        // Record agent action timestamp for loop prevention (Finding 8)
        if (pinnedTabId) {
          lastAgentActionTimestamps.set(pinnedTabId, Date.now());
        } else {
          chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
            if (activeTab?.id) {
              lastAgentActionTimestamps.set(activeTab.id, Date.now());
            }
          }).catch(() => {});
        }

        // Broadcast structured step for animated UI cards and Trace panel
        broadcast({
          type: 'AGENT_STEP',
          taskId,
          stepNumber,
          tool: tool?.tool,
          args: tool ? (({ tool: _t, ...rest }) => rest)(tool as Record<string, unknown>) as Record<string, unknown> : undefined,
          reasoning: reasoning?.trim() || undefined,
          status: result ? 'done' : 'running',
          result,
        });

        // Update in-page floating status pill on active tab
        chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
          if (activeTab?.id) {
            void fxUpdatePill(activeTab.id, {
              stepNumber,
              tool: tool?.tool || 'reasoning',
              status: result ? 'done' : 'running',
              detail: result ? result.slice(0, 40) : undefined,
              taskId,
            });
          }
        }).catch(() => {});
      },
      onStatusChange: (status, detail) => {
        broadcast({
          type: 'TASK_STATUS',
          taskId,
          status,
          detail,
        });

        if (status === 'done' || status === 'error' || status === 'paused') {
          chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
            if (activeTab?.id) {
              void fxRemovePill(activeTab.id);
            }
          }).catch(() => {});
        }
      },
      onHITLRequired: async (tool, reason) => {
        return new Promise<boolean>((resolve) => {
          let resolved = false;
          const cleanupFns: Array<() => void> = [];

          const finish = (approved: boolean) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutTimer);
              cleanupFns.forEach((fn) => {
                try { fn(); } catch { /* ignore */ }
              });
              resolve(approved);
            }
          };

          // 2-minute safety timeout to prevent deadlock if sidepanel is closed
          const timeoutTimer = setTimeout(() => {
            finish(false);
          }, 120_000);

          broadcast({
            type: 'TASK_STATUS',
            taskId,
            status: 'hitl_waiting',
            detail: `${reason} (${tool.tool})`,
          });

          for (const port of connectedPorts) {
            const msgListener = (msg: unknown) => {
              const m = msg as { type?: string; taskId?: string; approved?: boolean };
              if (m.type === 'HITL_RESPONSE' && m.taskId === taskId) {
                finish(!!m.approved);
              }
            };
            port.onMessage.addListener(msgListener);
            cleanupFns.push(() => {
              try { port.onMessage.removeListener(msgListener); } catch { /* ignore */ }
            });
          }

          // Fallback listener on runtime messages
          const runtimeListener = (message: unknown) => {
            const m = message as { type?: string; taskId?: string; approved?: boolean };
            if (m?.type === 'HITL_RESPONSE' && m?.taskId === taskId) {
              finish(!!m.approved);
            }
          };
          chrome.runtime.onMessage.addListener(runtimeListener);
          cleanupFns.push(() => {
            try { chrome.runtime.onMessage.removeListener(runtimeListener); } catch { /* ignore */ }
          });
        });
      },
    },
  );

  activeEngine = engine;

  const currentRun = (async () => {
    try {
      const finalResult = await engine.run(initialCheckpoint);
      // Finding 9: Do not save done or broadcast STREAM_DONE for an aborted task
      if (engine.isAborted) {
        console.log(`[Background] Task ${taskId} terminated in aborted state.`);
        await saveTask({
          taskId,
          instruction,
          status: 'error',
          createdAt: taskCreatedAt,
          updatedAt: Date.now(),
          result: 'Task was cancelled.',
        });
        broadcast({
          type: 'TASK_STATUS',
          taskId,
          status: 'error',
          detail: 'Task was cancelled.',
        });
        return;
      }

      await saveTask({
        taskId,
        instruction,
        status: 'done',
        createdAt: taskCreatedAt,
        updatedAt: Date.now(),
        result: finalResult?.trim() || undefined,
      });
      void recordTaskCompletion(taskId, instruction, finalResult?.trim() || '');
      broadcast({
        type: 'STREAM_DONE',
        taskId,
        finalResult: finalResult?.trim() || undefined,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await saveTask({
        taskId,
        instruction,
        status: 'error',
        createdAt: taskCreatedAt,
        updatedAt: Date.now(),
        result: msg,
      });
      broadcast({
        type: 'TASK_STATUS',
        taskId,
        status: 'error',
        detail: msg,
      });
    } finally {
      // Finding 9: Fix race condition
      if (activeEngine === engine) {
        activeEngine = null;
        activeRunPromise = null;
      }

      // Finding 6: Process queued sentinel task if one was waiting
      if (queuedSentinelTasks.length > 0 && !activeEngine) {
        const nextTask = queuedSentinelTasks.shift();
        if (nextTask) {
          console.log(`[Sentinel] Processing queued sentinel task: ${nextTask.taskId}`);
          void handleAgentStart(
            nextTask.taskId,
            nextTask.instruction,
            undefined,
            false,
            undefined,
            undefined,
            nextTask.pinnedTabId,
            true,
          );
        }
      }
    }
  })();

  activeRunPromise = currentRun;
  await currentRun;
}

async function recoverInterruptedTasks(): Promise<void> {
  const interrupted = await findInterruptedTasks();
  for (const cp of interrupted) {
    console.log('[Background] Found interrupted task checkpoint:', cp.taskId, 'at step', cp.currentStepIndex);
    await saveCheckpoint({ ...cp, status: 'paused' });
  }
}
