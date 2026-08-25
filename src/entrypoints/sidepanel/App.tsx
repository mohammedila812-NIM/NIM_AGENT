import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, ListTodo, BookOpen, Activity, ShieldCheck, Settings } from 'lucide-react';
import { ChatPanel, type ChatMessageItem, type AgentStep } from './components/ChatPanel';
import { TaskPanel } from './components/TaskPanel';
import { ResearchPanel } from './components/ResearchPanel';
import { TracePanel } from './components/TracePanel';
import { SecurityLog } from './components/SecurityLog';
import { SettingsPanel } from './components/SettingsPanel';
import { getCurrentCostState } from '../../lib/agent/cost-guard';

type Tab = 'chat' | 'tasks' | 'research' | 'trace' | 'security' | 'settings';

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

  const portRef = useRef<chrome.runtime.Port | null>(null);

  // Setup streaming port to background service worker with keepalive heartbeat
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    let finalizedTaskIds = new Set<string>();

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

    chrome.runtime.sendMessage({
      type: 'AGENT_START',
      taskId: id,
      instruction,
      visionOptIn,
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
            onClick={() => setActiveTab('tasks')}
            className={`p-1.5 rounded-md transition ${activeTab === 'tasks' ? 'bg-slate-800 text-brand-400' : 'text-slate-400 hover:text-slate-200'}`}
            title="Tasks & Macros"
          >
            <ListTodo className="w-3.5 h-3.5" />
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
          />
        )}
        {activeTab === 'trace' && (
          <TracePanel
            activeTaskId={activeTaskId}
            instruction={currentInstruction}
            traceSteps={traceSteps}
          />
        )}
        {activeTab === 'tasks' && <TaskPanel onRunMacro={(m) => handleStartTask(m, false)} />}
        {activeTab === 'research' && <ResearchPanel />}
        {activeTab === 'security' && <SecurityLog />}
        {activeTab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}
