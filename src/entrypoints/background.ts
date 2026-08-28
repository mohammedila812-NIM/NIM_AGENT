import { defineBackground } from 'wxt/utils/define-background';
import { initPortManager, onPort } from '../lib/messaging/port-manager';
import { findInterruptedTasks, saveCheckpoint, loadCheckpoint, type AgentCheckpoint } from '../lib/agent/checkpoint';
import { AgentEngine } from '../lib/agent/engine';
import { loadProviderKeys, loadWorkerConfig } from '../lib/storage/secure';
import { getPreset } from '../lib/llm/providers';
import type { ProviderConfig } from '../lib/llm/types';
import { isChatModel, type DiscoveredModel } from '../lib/llm/model-registry';
import { resetTaskCounters } from '../lib/agent/cost-guard';
import { saveTask } from '../lib/storage/tasks';
import { isValidMessage } from '../lib/messaging/protocol';
import { syncWatchAlarms, loadWatch } from '../lib/storage/watch';
import { executeWatchCheck } from '../lib/agent/watch-engine';

let activeEngine: AgentEngine | null = null;
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

  // Handle desktop alert notification clicks (opens target URL)
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
    }
  });

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
      void handleAgentStart(message.taskId, message.instruction, message.modelId, message.visionOptIn);
      sendResponse({ status: 'started' });
      return true;
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
      sendResponse({ status: 'stopped' });
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
): Promise<void> {
  // Gracefully abort prior activeEngine to prevent concurrency collisions
  if (activeEngine) {
    activeEngine.abort();
    activeEngine = null;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Reset per-task token counter at the start of each new task
  if (!initialCheckpoint) {
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
    baseUrl: settings.customBaseUrl || preset?.baseUrl || 'https://integrate.api.nvidia.com/v1',
    apiKey: keys.llmApiKey,
  };

  let chosenModelId = modelId || settings.selectedModelId;
  if (!chosenModelId || !isChatModel(chosenModelId)) {
    chosenModelId = 'meta/llama-3.3-70b-instruct';
  }

  const model: DiscoveredModel = settings.selectedModel && isChatModel(settings.selectedModel.id)
    ? settings.selectedModel
    : {
        id: chosenModelId,
        contextLength: 128_000,
        supportsTools: true,
        supportsVision: false,
        isAgentTuned: true,
        providerLabel: providerConfig.label,
      };

  const workerConfig = await loadWorkerConfig();
  const workerPreset = workerConfig?.providerId ? getPreset(workerConfig.providerId) : undefined;
  const workerProviderConfig: ProviderConfig | undefined = workerConfig?.apiKey ? {
    id: workerConfig.providerId || 'nim-cloud',
    label: workerPreset?.label ?? 'Worker',
    baseUrl: workerConfig.baseUrl || workerPreset?.baseUrl || 'https://integrate.api.nvidia.com/v1',
    apiKey: workerConfig.apiKey,
  } : undefined;

  const workerModel: DiscoveredModel | undefined = workerConfig?.modelId ? {
    id: workerConfig.modelId,
    contextLength: 128_000,
    supportsTools: true,
    supportsVision: false,
    isAgentTuned: true,
    providerLabel: workerProviderConfig?.label ?? 'Worker',
  } : undefined;

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
      visionOptIn,
      costLimits: settings.costLimits,
    },
    {
      onStep: (stepNumber, reasoning, tool, result) => {
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
      },
      onStatusChange: (status, detail) => {
        broadcast({
          type: 'TASK_STATUS',
          taskId,
          status,
          detail,
        });
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

  try {
    const finalResult = await engine.run(initialCheckpoint);
    await saveTask({
      taskId,
      instruction,
      status: 'done',
      createdAt: taskCreatedAt,
      updatedAt: Date.now(),
      result: finalResult?.trim() || undefined,
    });
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
    activeEngine = null;
  }
}

async function recoverInterruptedTasks(): Promise<void> {
  const interrupted = await findInterruptedTasks();
  for (const cp of interrupted) {
    console.log('[Background] Found interrupted task checkpoint:', cp.taskId, 'at step', cp.currentStepIndex);
    await saveCheckpoint({ ...cp, status: 'paused' });
  }
}
