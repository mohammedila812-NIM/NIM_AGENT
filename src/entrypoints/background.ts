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

// ── Desktop Bridge (WebSocket to NIM JARVIS Desktop) ──────────────────────────
let bridgeWs: WebSocket | null = null;
type BridgeState = 'disconnected' | 'connecting' | 'connected' | 'error';
let bridgeState: BridgeState = 'disconnected';
let bridgeReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let bridgeUrl = 'ws://127.0.0.1:7432';
let bridgeToken = '';

function broadcastBridgeState(state: BridgeState) {
  bridgeState = state;
  void chrome.storage.local.set({ bridgeConnectionState: state });
  broadcast({ type: 'BRIDGE_STATE_CHANGED', state });
}

function startBridge(url: string, authToken: string) {
  if (bridgeReconnectTimer) { clearTimeout(bridgeReconnectTimer); bridgeReconnectTimer = null; }
  if (bridgeWs && (bridgeWs.readyState === WebSocket.OPEN || bridgeWs.readyState === WebSocket.CONNECTING)) {
    bridgeWs.close();
  }

  bridgeUrl = url;
  bridgeToken = authToken;
  broadcastBridgeState('connecting');

  try {
    bridgeWs = new WebSocket(url);

    bridgeWs.onopen = () => {
      console.log('[Bridge] WebSocket connected, sending auth...');
      bridgeWs?.send(JSON.stringify({
        type: 'auth_request',
        payload: { client: 'nim-agent-browser-extension', version: '1.0.0' },
        auth_token: authToken,
      }));
    };

    bridgeWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        const msgType = msg.type as string;

        if (msgType === 'auth_response') {
          console.log('[Bridge] Authenticated with NIM JARVIS Desktop.');
          broadcastBridgeState('connected');
          return;
        }
        if (msgType === 'error') {
          console.warn('[Bridge] Server error:', (msg.payload as Record<string,unknown>)?.message);
          broadcastBridgeState('error');
          return;
        }
        if (msgType === 'browser_task') {
          const payload = (msg.payload || {}) as Record<string, unknown>;
          const taskId = (payload.task_id as string) || `btask_${Date.now()}`;
          const goal = (payload.goal as string) || '';
          console.log(`[Bridge] Received browser task: "${goal}" (${taskId})`);
          void handleAgentStart(taskId, goal, undefined, false);
        }
      } catch (e) {
        console.error('[Bridge] Message parse error:', e);
      }
    };

    bridgeWs.onclose = () => {
      console.log('[Bridge] Disconnected from Desktop.');
      broadcastBridgeState('disconnected');
      // Auto-reconnect in 5s if we had an auth token configured
      if (bridgeToken) {
        bridgeReconnectTimer = setTimeout(() => startBridge(bridgeUrl, bridgeToken), 5000);
      }
    };

    bridgeWs.onerror = (err) => {
      console.warn('[Bridge] WebSocket error:', err);
      broadcastBridgeState('error');
    };
  } catch (e) {
    console.error('[Bridge] Failed to create WebSocket:', e);
    broadcastBridgeState('error');
  }
}

function stopBridge() {
  if (bridgeReconnectTimer) { clearTimeout(bridgeReconnectTimer); bridgeReconnectTimer = null; }
  bridgeToken = ''; // clear so auto-reconnect stops
  if (bridgeWs) {
    bridgeWs.close();
    bridgeWs = null;
  }
  broadcastBridgeState('disconnected');
}
// ──────────────────────────────────────────────────────────────────────────────

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

  // Restore bridge connection from saved config on service-worker wake
  void chrome.storage.local.get(['desktopBridgeConfig']).then((data) => {
    const cfg = data.desktopBridgeConfig as { enabled?: boolean; serverUrl?: string; authToken?: string; autoConnect?: boolean } | undefined;
    if (cfg?.enabled && cfg.autoConnect && cfg.authToken) {
      console.log('[Bridge] Auto-restoring bridge from saved config...');
      startBridge(cfg.serverUrl || 'ws://127.0.0.1:7432', cfg.authToken);
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

  // Main agent + bridge communication listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // SECURITY: Reject foreign senders
    if (sender.id !== chrome.runtime.id) {
      console.warn('[Security] Rejecting message from foreign extension:', sender.id);
      return false;
    }

    // Bridge control messages (bypass isValidMessage for these)
    if (message?.type === 'BRIDGE_CONNECT') {
      const { url, authToken } = (message.payload || {}) as { url: string; authToken: string };
      startBridge(url, authToken);
      sendResponse({ status: 'connecting' });
      return true;
    }

    if (message?.type === 'BRIDGE_DISCONNECT') {
      stopBridge();
      sendResponse({ status: 'disconnected' });
      return true;
    }

    if (message?.type === 'BRIDGE_GET_STATE') {
      sendResponse({ state: bridgeState });
      return true;
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

    // Send result back to Desktop Bridge if connected
    if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
      bridgeWs.send(JSON.stringify({
        type: 'browser_result',
        payload: {
          task_id: taskId,
          success: true,
          summary: finalResult?.trim() || 'Task completed successfully in browser.',
        },
      }));
    }
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

    // Send error back to Desktop Bridge if connected
    if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
      bridgeWs.send(JSON.stringify({
        type: 'browser_result',
        payload: {
          task_id: taskId,
          success: false,
          summary: `Browser task error: ${msg}`,
          error: msg,
        },
      }));
    }
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
