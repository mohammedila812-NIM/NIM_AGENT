import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, ListTodo, BookOpen, Activity, ShieldCheck, Settings, Bell, HardDrive, Code, Wrench, Power } from 'lucide-react';
import { ChatPanel, type ChatMessageItem, type AgentStep } from './components/ChatPanel';
import { TaskPanel } from './components/TaskPanel';
import { ResearchPanel } from './components/ResearchPanel';
import { TracePanel } from './components/TracePanel';
import { SecurityLog } from './components/SecurityLog';
import { SettingsPanel } from './components/SettingsPanel';
import { WatchPanel } from './components/WatchPanel';
import { WorkspacePanel } from './components/WorkspacePanel';
import { CodingSpacePanel } from './components/CodingSpacePanel';
import { getCurrentCostState } from '../../lib/agent/cost-guard';
import { sliceRecentPrompts } from '../../lib/agent/session-memory';

type Tab = 'chat' | 'trace' | 'workspace' | 'code' | 'tasks' | 'monitors' | 'research' | 'security' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [currentInstruction, setCurrentInstruction] = useState('');
  const [taskStatus, setTaskStatus] = useState('idle');
  const [hitlDetail, setHitlDetail] = useState<string | null>(null);
  const [traceSteps, setTraceSteps] = useState<
    Array<{
      stepNumber: number;
      reasoning: string;
      toolName?: string;
      toolArgs?: Record<string, unknown>;
      result?: string;
    }>
  >([]);
  const [costState, setCostState] = useState({ taskTokens: 0, todayTokens: 0, todayCostUsd: 0 });

  const [messages, setMessages] = useState<ChatMessageItem[]>([
    {
      id: 'welcome',
      sender: 'agent',
      text: 'Hello! I am your NIM AI agent. I can research the web, automate interactions, extract data, and fill forms safely. What should we accomplish?',
      timestamp: Date.now(),
    },
  ]);

  // Per-task animated step cards
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [devtoolsActive, setDevtoolsActive] = useState(false);

  useEffect(() => {
    const checkDevTools = async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTabId = tabs[0]?.id;
        if (currentTabId) {
          const r = await chrome.storage.session.get(`devtools_tier_${currentTabId}`);
          setDevtoolsActive(!!r[`devtools_tier_${currentTabId}`]);
        }
      } catch { /* ignore */ }
    };
    void checkDevTools();
    const interval = setInterval(checkDevTools, 2500);
    return () => clearInterval(interval);
  }, []);

  const portRef = useRef<chrome.runtime.Port | null>(null);

  // Setup streaming port to background service worker with keepalive heartbeat
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    const finalizedTaskIds = new Set<string>();

    try {
      port = chrome.runtime.connect({ name: 'sidepanel-stream' });
      portRef.current = port;

      const handleMsg = (msg: unknown) => {
        const m = msg as {
          type?: string;
          taskId?: string;
          chunk?: string;
          status?: string;
          detail?: string;
          finalResult?: string;
          stepNumber?: number;
          tool?: string;
          args?: Record<string, unknown>;
          reasoning?: string;
          result?: string;
          target?: string;
          summary?: string;
          autonomousInstruction?: string;
        };

        if (m.type === 'AGENT_STEP') {
          // Update or insert the animated step card
          setAgentSteps(prev => {
            const idx = prev.findIndex(s => s.stepNumber === m.stepNumber);
            const updated: AgentStep = {
              stepNumber: m.stepNumber ?? 0,
              tool: m.tool,
              args: m.args,
              reasoning: m.reasoning,
              status: (m.status as AgentStep['status']) ?? 'running',
              result: m.result,
            };
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = {
                ...copy[idx],
                ...updated,
                reasoning: updated.reasoning || copy[idx].reasoning,
                result: updated.result || copy[idx].result,
              };
              return copy;
            }
            return [...prev, updated];
          });

          // Also populate Reasoning Trace telemetry
          setTraceSteps(prev => {
            const idx = prev.findIndex(s => s.stepNumber === m.stepNumber);
            const updatedTrace = {
              stepNumber: m.stepNumber ?? 0,
              reasoning: m.reasoning ?? '',
              toolName: m.tool,
              toolArgs: m.args,
              result: m.result,
              isUndoable: false,
            };
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = {
                ...copy[idx],
                ...updatedTrace,
                reasoning: updatedTrace.reasoning || copy[idx].reasoning,
                result: updatedTrace.result || copy[idx].result,
                toolName: updatedTrace.toolName || copy[idx].toolName,
                toolArgs: updatedTrace.toolArgs || copy[idx].toolArgs,
              };
              return copy;
            }
            return [...prev, updatedTrace];
          });
        } else if (m.type === 'STREAM_DONE') {
          if (m.taskId && finalizedTaskIds.has(m.taskId)) return;
          if (m.taskId) finalizedTaskIds.add(m.taskId);

          setTaskStatus('done');
          setActiveTaskId(null);

          // Mark all running steps as done
          setAgentSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'done' } : s));

          const responseText = m.finalResult;
          if (responseText && responseText.trim().length > 0) {
            setMessages(prev => [
              ...prev,
              {
                id: crypto.randomUUID(),
                sender: 'agent',
                text: responseText.trim(),
                timestamp: Date.now(),
              },
            ]);
          }
        } else if (m.type === 'TASK_STATUS' && m.status) {
          setTaskStatus(m.status);
          if (m.status === 'hitl_waiting') {
            setHitlDetail(m.detail ?? null);
          } else {
            setHitlDetail(null);
          }
          if (m.status === 'error') {
            if (m.taskId && finalizedTaskIds.has(m.taskId)) return;
            if (m.taskId) finalizedTaskIds.add(m.taskId);

            setActiveTaskId(null);
            setAgentSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
            setMessages(prev => [
              ...prev,
              {
                id: crypto.randomUUID(),
                sender: 'error',
                text: m.detail || 'An unexpected error occurred during execution.',
                timestamp: Date.now(),
              },
            ]);
          } else if (m.status === 'done') {
            setActiveTaskId(null);
          }
        } else if (m.type === 'PAGE_CHANGE_DETECTED') {
          const detail = m.autonomousInstruction
            ? `\n\n*Autonomously Executing:* "${m.autonomousInstruction}"`
            : '\n\n*What would you like me to do?*';
          setMessages(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              sender: 'agent',
              text: `🚨 **Sentinel Change Detected on page:**\n\n${m.summary}\n\n*Target:* \`${m.target || 'page'}\`${detail}`,
              timestamp: Date.now(),
            },
          ]);
        }
      };

      port.onMessage.addListener(handleMsg);
    } catch {
      // Fallback
    }

    // Heartbeat every 10s
    const interval = setInterval(() => {
      if (portRef.current) {
        try {
          portRef.current.postMessage({ type: 'HEARTBEAT' });
        } catch {
          // Disconnected
        }
      }
      void getCurrentCostState().then(setCostState);
    }, 10_000);

    return () => {
      clearInterval(interval);
      port?.disconnect();
    };
  }, []);

  const handleStartTask = (instruction: string, visionOptIn: boolean) => {
    const id = crypto.randomUUID();
    setActiveTaskId(id);
    setCurrentInstruction(instruction);
    setAgentSteps([]);   // clear step cards for new task
    setTraceSteps([]);
    setTaskStatus('running');

    setMessages(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        sender: 'user',
        text: instruction,
        timestamp: Date.now(),
      },
    ]);

    // Send ONLY the last 2 user prompts (and their assistant responses) to prevent quadratic context latency
    const rawHistory = messages
      .filter((m) => m.id !== 'welcome' && m.sender !== 'error' && m.text.trim().length > 0)
      .map((m) => ({
        role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.text,
      }));

    const history = sliceRecentPrompts(rawHistory, 2);

    chrome.runtime.sendMessage({
      type: 'AGENT_START',
      taskId: id,
      instruction,
      visionOptIn,
      conversationHistory: history,
    });
  };

  const handleStopTask = () => {
    if (activeTaskId) {
      chrome.runtime.sendMessage({ type: 'AGENT_STOP', taskId: activeTaskId });
      setActiveTaskId(null);
      setTaskStatus('paused');
      setAgentSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' } : s));
    }
  };

  const handleHITLResponse = (approved: boolean) => {
    if (portRef.current && activeTaskId) {
      portRef.current.postMessage({
        type: 'HITL_RESPONSE',
        taskId: activeTaskId,
        approved,
      });
      setHitlDetail(null);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-900 text-slate-100 overflow-hidden font-sans">
      {/* Top Header */}
      <header className="h-12 border-b border-slate-800 bg-slate-950 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <img
            src="/logo.jpg"
            alt="NIM Agent"
            className="w-6 h-6 rounded-lg object-cover shadow-md shadow-brand-500/20 border border-brand-500/40"
          />
          <div>
            <h1 className="text-xs font-bold tracking-tight text-slate-100">NIM Agent</h1>
            <p className="text-[10px] text-slate-400 font-mono">Any Model · Your Data</p>
          </div>
        </div>

        {devtoolsActive && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-950/80 border border-sky-700/60 text-[10px] text-sky-300 font-mono animate-pulse">
            <Wrench className="w-3 h-3 text-sky-400" />
            <span>DevTools Active</span>
            <button
              onClick={async () => {
                await chrome.runtime.sendMessage({ type: 'DEVTOOLS_KILL_SWITCH' });
                setDevtoolsActive(false);
              }}
              title="Kill all active DevTools sessions"
              className="ml-1 p-0.5 hover:bg-red-900/60 text-red-400 rounded transition"
            >
              <Power className="w-2.5 h-2.5" />
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <nav className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveTab('chat')}
            className={`p-1.5 rounded-md transition ${activeTab === 'chat' ? 'bg-slate-800 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            title="Chat & Control"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('trace')}
            className={`p-1.5 rounded-md transition ${activeTab === 'trace' ? 'bg-slate-800 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            title="Reasoning Trace"
          >
            <Activity className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('workspace')}
            className={`p-1.5 rounded-md transition ${activeTab === 'workspace' ? 'bg-slate-800 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            title="NIM Workspace (Virtual Files & Notes)"
          >
            <HardDrive className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`p-1.5 rounded-md transition ${activeTab === 'code' ? 'bg-slate-800 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            title="Coding Space (Editor & Sandbox)"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            className={`p-1.5 rounded-md transition ${activeTab === 'tasks' ? 'bg-slate-800 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            title="Tasks & Macros"
          >
            <ListTodo className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('monitors')}
            className={`p-1.5 rounded-md transition ${activeTab === 'monitors' ? 'bg-slate-800 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            title="Scheduled Monitors"
          >
            <Bell className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('research')}
            className={`p-1.5 rounded-md transition ${activeTab === 'research' ? 'bg-slate-800 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            title="Research Notes"
          >
            <BookOpen className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`p-1.5 rounded-md transition ${activeTab === 'security' ? 'bg-slate-800 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            title="Security Log"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`p-1.5 rounded-md transition ${activeTab === 'settings' ? 'bg-slate-800 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </nav>
      </header>

      {/* Main View Area */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'chat' && (
          <ChatPanel
            activeTaskId={activeTaskId}
            onStartTask={handleStartTask}
            onStopTask={handleStopTask}
            messages={messages}
            agentSteps={agentSteps}
            taskStatus={taskStatus}
            hitlDetail={hitlDetail}
            onHITLResponse={handleHITLResponse}
            costState={costState}
            onOpenSettings={() => setActiveTab('settings')}
          />
        )}
        {activeTab === 'trace' && (
          <TracePanel
            activeTaskId={activeTaskId}
            instruction={currentInstruction}
            traceSteps={traceSteps}
          />
        )}
        {activeTab === 'workspace' && <WorkspacePanel />}
        {activeTab === 'code' && <CodingSpacePanel />}
        {activeTab === 'tasks' && <TaskPanel onRunMacro={(m) => handleStartTask(m, false)} />}
        {activeTab === 'monitors' && <WatchPanel />}
        {activeTab === 'research' && <ResearchPanel onOpenWorkspacePath={() => setActiveTab('workspace')} />}
        {activeTab === 'security' && <SecurityLog />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}
