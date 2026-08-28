import React, { useState, useEffect, useRef } from 'react';
import {
  Send, Square, AlertCircle, ShieldAlert, Check, X,
  Globe, Search, FileText, MousePointer, Keyboard,
  ArrowUpDown, Camera, Loader2, ChevronDown, ChevronRight,
  Zap, Layers, Table, ExternalLink, Sparkles, List, Clock, History, CheckSquare,
  Download, Code2, Bookmark, Bell,
} from 'lucide-react';
import { MarkdownMessage } from './MarkdownMessage';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessageItem {
  id: string;
  sender: 'user' | 'agent' | 'system' | 'error';
  text: string;
  timestamp: number;
}

export interface AgentStep {
  stepNumber: number;
  tool?: string;
  args?: Record<string, unknown>;
  reasoning?: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

interface ChatPanelProps {
  activeTaskId: string | null;
  onStartTask: (instruction: string, visionOptIn: boolean) => void;
  onStopTask: () => void;
  messages: ChatMessageItem[];
  agentSteps: AgentStep[];
  taskStatus: string;
  hitlDetail: string | null;
  onHITLResponse: (approved: boolean) => void;
  costState: { taskTokens: number; todayTokens: number; todayCostUsd: number };
}

// ── Tool icon + label map ─────────────────────────────────────────────────────

const TOOL_META: Record<string, { icon: React.FC<{ className?: string }>; label: string; color: string }> = {
  navigate_to:       { icon: Globe,         label: 'Navigate',      color: 'text-sky-400' },
  web_search:        { icon: Search,        label: 'Search',        color: 'text-amber-400' },
  read_page:         { icon: FileText,      label: 'Read Page',     color: 'text-violet-400' },
  click_element:     { icon: MousePointer,  label: 'Click',         color: 'text-brand-400' },
  type_text:         { icon: Keyboard,      label: 'Type',          color: 'text-emerald-400' },
  select_option:     { icon: List,          label: 'Select Option', color: 'text-fuchsia-400' },
  press_key:         { icon: Keyboard,      label: 'Press Key',     color: 'text-amber-300' },
  wait_for:          { icon: Clock,         label: 'Wait For',      color: 'text-blue-400' },
  scroll_page:       { icon: ArrowUpDown,   label: 'Scroll',        color: 'text-slate-400' },
  screenshot:        { icon: Camera,        label: 'Screenshot',    color: 'text-rose-400' },
  summarize:         { icon: FileText,      label: 'Summarize',     color: 'text-teal-400' },
  list_tabs:         { icon: Layers,        label: 'List Tabs',     color: 'text-indigo-400' },
  switch_tab:        { icon: ExternalLink,  label: 'Switch Tab',    color: 'text-cyan-400' },
  close_tab:         { icon: X,             label: 'Close Tab',     color: 'text-rose-400' },
  extract_table:          { icon: Table,         label: 'Extract Table', color: 'text-emerald-400' },
  parallel_research:      { icon: Sparkles,      label: 'Parallel Sub-Agents', color: 'text-amber-400' },
  recall_session_history: { icon: History,       label: 'Session Recall', color: 'text-purple-400' },
  fill_form:              { icon: CheckSquare,   label: 'Fill Form', color: 'text-emerald-400' },
  export_data:            { icon: Download,      label: 'Export File', color: 'text-cyan-400' },
  eval_page_script:       { icon: Code2,         label: 'Inspect State', color: 'text-indigo-400' },
  scratchpad_write:       { icon: Bookmark,      label: 'Scratchpad Write', color: 'text-yellow-400' },
  scratchpad_read:        { icon: Bookmark,      label: 'Scratchpad Read', color: 'text-yellow-300' },
  create_watch:           { icon: Bell,          label: 'Schedule Monitor', color: 'text-indigo-400' },
  list_watches:           { icon: Bell,          label: 'List Monitors', color: 'text-indigo-300' },
  delete_watch:           { icon: Bell,          label: 'Delete Monitor', color: 'text-rose-400' },
};

// ── Step summary: first meaningful arg value ───────────────────────────────────

function stepSummary(tool: string, args?: Record<string, unknown>): string {
  if (!args) return '';
  if (tool === 'parallel_research' && Array.isArray(args.tasks)) return `${args.tasks.length} parallel background tabs`;
  if (tool === 'recall_session_history') return args.query ? `query: "${String(args.query)}"` : `last ${String(args.last_n ?? 5)} turns`;
  if (tool === 'fill_form' && Array.isArray(args.fields)) return `${args.fields.length} form fields`;
  if (tool === 'export_data' && args.filename) return `${String(args.filename)} (${String(args.format ?? 'csv')})`;
  if (tool === 'eval_page_script' && args.target) return `target: ${String(args.target)}`;
  if (tool === 'scratchpad_write' && args.key) return `var: "${String(args.key)}" = "${String(args.value ?? '')}"`;
  if (tool === 'scratchpad_read') return args.key ? `var: "${String(args.key)}"` : 'all variables';
  if (tool === 'create_watch' && args.name) return `"${String(args.name)}" (${String(args.intervalMinutes ?? 30)}m)`;
  if (tool === 'delete_watch' && args.watchId) return `id: ${String(args.watchId)}`;
  if (tool === 'navigate_to' && args.url) return String(args.url);
  if (tool === 'web_search' && args.query) return `"${String(args.query)}"`;
  if (tool === 'click_element' && args.target) return String(args.target);
  if (tool === 'type_text' && args.target) return `${String(args.target)}: "${String(args.value ?? '')}"`;
  if (tool === 'select_option' && args.option) return `"${String(args.option)}" on ${String(args.target ?? '')}`;
  if (tool === 'press_key' && args.key) return `key: "${String(args.key)}"`;
  if (tool === 'wait_for' && args.selector) return `selector: "${String(args.selector)}"`;
  if (tool === 'scroll_page' && args.direction) return `direction: ${String(args.direction)}`;
  if (tool === 'switch_tab' && args.tabId) return `tab: ${String(args.tabId)}`;
  if (tool === 'extract_table' && args.selector) return `selector: ${String(args.selector)}`;
  const first = Object.values(args)[0];
  return first ? String(first).slice(0, 60) : '';
}

// ── Animated Step Card ────────────────────────────────────────────────────────

const AgentStepCard: React.FC<{ step: AgentStep; index: number }> = ({ step, index }) => {
  const [expanded, setExpanded] = useState(false);
  const meta = step.tool ? TOOL_META[step.tool] : undefined;
  const Icon = meta?.icon ?? Zap;
  const label = meta?.label ?? step.tool ?? 'Step';
  const color = meta?.color ?? 'text-slate-400';
  const summary = step.tool ? stepSummary(step.tool, step.args) : step.reasoning ?? '';

  const hasDetails = !!(step.reasoning || step.result || step.args);

  return (
    <div
      className="flex items-start gap-2 animate-in slide-in-from-bottom-2 fade-in duration-300"
      style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
    >
      {/* Timeline dot */}
      <div className="flex flex-col items-center shrink-0 mt-1">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center border ${
          step.status === 'running'
            ? 'border-brand-500/60 bg-brand-950/60'
            : step.status === 'done'
            ? 'border-emerald-500/50 bg-emerald-950/40'
            : 'border-rose-500/50 bg-rose-950/40'
        }`}>
          {step.status === 'running' ? (
            <Loader2 className="w-3 h-3 animate-spin text-brand-400" />
          ) : step.status === 'done' ? (
            <Check className="w-3 h-3 text-emerald-400" />
          ) : (
            <X className="w-3 h-3 text-rose-400" />
          )}
        </div>
        {/* Connecting line */}
        <div className="w-px flex-1 bg-slate-800 mt-1 min-h-[8px]" />
      </div>

      {/* Card body */}
      <div className={`flex-1 mb-1.5 rounded-xl border text-xs overflow-hidden ${
        step.status === 'running'
          ? 'border-brand-700/40 bg-slate-900/80'
          : step.status === 'done'
          ? 'border-emerald-800/30 bg-slate-900/60'
          : 'border-rose-800/40 bg-rose-950/20'
      }`}>
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/30 transition"
          onClick={() => hasDetails && setExpanded(e => !e)}
          disabled={!hasDetails}
        >
          <Icon className={`w-3.5 h-3.5 shrink-0 ${color} ${step.status === 'running' ? 'animate-pulse' : ''}`} />
          <span className={`font-semibold ${color} shrink-0`}>{label}</span>
          {summary && (
            <span className="text-slate-400 truncate flex-1">{summary}</span>
          )}
          <span className="ml-auto shrink-0 text-slate-600">
            {step.status === 'running' && (
              <span className="text-brand-500 font-mono text-[10px]">running</span>
            )}
            {hasDetails && step.status !== 'running' && (
              expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
            )}
          </span>
        </button>

        {/* Expandable details */}
        {expanded && hasDetails && (
          <div className="px-3 pb-2 pt-0 space-y-1.5 border-t border-slate-800/60">
            {step.reasoning && (
              <div>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide mb-0.5">Reasoning</p>
                <p className="text-slate-400 leading-relaxed">{step.reasoning}</p>
              </div>
            )}
            {step.args && Object.keys(step.args).length > 0 && (
              <div>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide mb-0.5">Arguments</p>
                <pre className="text-slate-400 font-mono text-[10px] bg-slate-950/60 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(step.args, null, 2)}
                </pre>
              </div>
            )}
            {step.result && (
              <div>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide mb-0.5">Result</p>
                <p className="text-slate-400 leading-relaxed line-clamp-3">{step.result}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── ChatPanel ─────────────────────────────────────────────────────────────────

export const ChatPanel: React.FC<ChatPanelProps> = ({
  activeTaskId,
  onStartTask,
  onStopTask,
  messages,
  agentSteps,
  taskStatus,
  hitlDetail,
  onHITLResponse,
  costState,
}) => {
  const [input, setInput] = useState('');
  const [visionOptIn, setVisionOptIn] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentSteps, taskStatus]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || activeTaskId) return;
    const userMsg = input.trim();
    setInput('');
    onStartTask(userMsg, visionOptIn);
  };

  const isRunning = taskStatus === 'running' || taskStatus === 'hitl_waiting' || taskStatus === 'plan_preview';

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100">
      {/* Running Cost Bar */}
      <div className="bg-slate-800/80 border-b border-slate-700/60 px-3 py-1.5 text-xs flex items-center justify-between font-mono text-slate-400">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${isRunning ? 'bg-brand-500 animate-pulse' : 'bg-slate-500'}`}></span>
          <span>Task: {costState.taskTokens.toLocaleString()} tok</span>
        </div>
        <div>
          <span>Today: ${costState.todayCostUsd.toFixed(3)} ({costState.todayTokens.toLocaleString()} tok)</span>
        </div>
      </div>

      {/* HITL Confirmation Banner */}
      {taskStatus === 'hitl_waiting' && hitlDetail && (
        <div className="bg-amber-950/90 border-b border-amber-600/60 p-3 text-amber-200 text-xs flex flex-col gap-2 animate-in fade-in">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-300">Action Confirmation Required:</span>
              <p className="mt-0.5 text-slate-300">{hitlDetail}</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end mt-1">
            <button
              onClick={() => onHITLResponse(false)}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 flex items-center gap-1 transition"
            >
              <X className="w-3.5 h-3.5" /> Decline
            </button>
            <button
              onClick={() => onHITLResponse(true)}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded flex items-center gap-1 transition"
            >
              <Check className="w-3.5 h-3.5" /> Approve & Execute
            </button>
          </div>
        </div>
      )}

      {/* Messages + Step Cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Chat messages */}
        {messages
          .filter(m => m.text && m.text.trim().length > 0)
          .map(m => (
            <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-1 duration-200`}>
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-brand-600 text-white rounded-br-none shadow-md shadow-brand-900/30'
                    : m.sender === 'error'
                    ? 'bg-rose-950/90 border border-rose-700/80 text-rose-200 rounded-bl-none'
                    : 'bg-slate-800 border border-slate-700/80 text-slate-200 rounded-bl-none'
                }`}
              >
                {m.sender === 'error' && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 mb-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Execution Notice</span>
                  </div>
                )}
                {m.sender === 'user' ? (
                  <p className="whitespace-pre-wrap">{m.text}</p>
                ) : (
                  <MarkdownMessage text={m.text} />
                )}
              </div>
            </div>
          ))}

        {/* Animated agent step cards — shown while running or after */}
        {agentSteps.length > 0 && (
          <div className="space-y-0 pl-1">
            {agentSteps.map((step, i) => (
              <AgentStepCard key={`${step.stepNumber}-${i}`} step={step} index={i} />
            ))}
          </div>
        )}

        {/* Idle thinking indicator (before first step arrives) */}
        {isRunning && agentSteps.length === 0 && (
          <div className="flex justify-start animate-in fade-in duration-300">
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl rounded-bl-none px-3.5 py-2 text-xs text-slate-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
              <span>Agent thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input / Control Bar */}
      <form onSubmit={handleSend} className="p-3 bg-slate-800/60 border-t border-slate-700/60 flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs px-1 text-slate-400">
          <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200 transition">
            <input
              type="checkbox"
              checked={visionOptIn}
              onChange={(e) => setVisionOptIn(e.target.checked)}
              className="rounded bg-slate-700 border-slate-600 text-brand-500 focus:ring-brand-500"
            />
            <span>Enable Vision (multimodal screenshots)</span>
          </label>
          <span className="text-[10px] text-slate-500">DOM-first policy active</span>
        </div>

        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            placeholder={isRunning ? 'Agent is working...' : 'Describe research or browser task (Enter to send)...'}
            disabled={isRunning}
            rows={2}
            className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 resize-none disabled:opacity-50"
          />

          {isRunning ? (
            <button
              type="button"
              onClick={onStopTask}
              className="px-4 bg-rose-600 hover:bg-rose-500 text-white rounded-xl flex items-center justify-center transition shadow-lg shadow-rose-900/30"
              title="Stop Agent"
            >
              <Square className="w-5 h-5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-4 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition shadow-lg shadow-brand-900/30"
              title="Send Prompt"
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
