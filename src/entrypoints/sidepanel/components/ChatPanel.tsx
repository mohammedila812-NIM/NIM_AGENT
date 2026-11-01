import React, { useState, useEffect, useRef } from 'react';
import {
  Send, Square, AlertCircle, ShieldAlert, Check, X,
  Globe, Search, FileText, MousePointer, Keyboard,
  ArrowUpDown, Camera, Loader2, ChevronDown, ChevronRight,
  Zap, Layers, Table, ExternalLink, Sparkles, List, Clock, History, CheckSquare,
  Download, Code2, Bookmark, Bell, Eye, PlayCircle, Database, FolderPlus, FileCode,
  Brain, Network, Share2, PlusCircle, Settings, AlertTriangle, Cpu, BellRing,
  Mic, MicOff, Volume2, VolumeX, Bot, RotateCcw,
} from 'lucide-react';
import { MarkdownMessage } from './MarkdownMessage';
import { inferVisionSupport } from '../../../lib/llm/model-registry';
import { VoiceDictation, AudioBriefing, VoiceRecorder, transcribeAudio } from '../../../lib/voice/speech';
import { cancelSpecialist, rollbackSpecialistEdits } from '../../../lib/agent/specialist/tools';

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
  onOpenSettings?: () => void;
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
  visual_inspect:    { icon: Eye,           label: 'Visual Inspect', color: 'text-rose-400' },
  auto_advance_media:{ icon: PlayCircle,    label: 'Auto-Advance Reels', color: 'text-emerald-400' },
  bypass_annoyances: { icon: ShieldAlert,   label: 'Bypass Annoyances',  color: 'text-rose-400' },
  clone_page_markdown:{ icon: FileCode,     label: 'Clone Markdown',     color: 'text-teal-400' },
  watch_page_changes: { icon: BellRing,     label: 'Sentinel Watch',     color: 'text-sky-400' },
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
  observe_page:           { icon: Eye,           label: 'Observe Page',  color: 'text-amber-300' },
  act_on_element:         { icon: PlayCircle,    label: 'Act On Element', color: 'text-emerald-400' },
  extract_data:           { icon: Database,      label: 'Extract Data',  color: 'text-cyan-400' },
  workspace_create_file:  { icon: FolderPlus,    label: 'Create File',   color: 'text-amber-400' },
  workspace_append_file:  { icon: FileText,      label: 'Append File',   color: 'text-amber-300' },
  workspace_read_file:    { icon: FileText,      label: 'Read File',     color: 'text-blue-400' },
  workspace_list_files:   { icon: Layers,        label: 'List Files',    color: 'text-slate-400' },
  workspace_delete_file:  { icon: X,             label: 'Delete File',   color: 'text-rose-400' },
  workspace_search:       { icon: Search,        label: 'Search Files',  color: 'text-indigo-400' },
  knowledge_graph_query:  { icon: Brain,         label: 'Recall Brain',  color: 'text-purple-400' },
  knowledge_graph_add:    { icon: PlusCircle,    label: 'Save to Brain', color: 'text-emerald-400' },
  knowledge_graph_relate: { icon: Share2,        label: 'Link Entities', color: 'text-cyan-400' },
  swarm_research:         { icon: Network,       label: 'Swarm Research', color: 'text-amber-400' },
  delegate_to_specialist: { icon: Bot,           label: 'Delegate Specialist', color: 'text-purple-400' },
  check_specialist:       { icon: Eye,           label: 'Check Specialist', color: 'text-purple-300' },
  await_specialist:       { icon: Clock,         label: 'Await Specialist', color: 'text-purple-400' },
  cancel_specialist:      { icon: X,             label: 'Cancel Specialist', color: 'text-rose-400' },
  rollback_specialist_edits: { icon: RotateCcw,  label: 'Rollback Edits', color: 'text-amber-400' },
};

// ── Step summary: first meaningful arg value ───────────────────────────────────

function stepSummary(tool: string, args?: Record<string, unknown>): string {
  if (!args) return '';
  if (tool === 'parallel_research' && Array.isArray(args.tasks)) return `${args.tasks.length} parallel background tabs`;
  if (tool === 'recall_session_history') return args.query ? `query: "${String(args.query)}"` : `last ${String(args.last_n ?? 5)} turns`;
  if (tool === 'knowledge_graph_query' && args.keyword) return `query: "${String(args.keyword)}"`;
  if (tool === 'knowledge_graph_add' && args.label) return `entity: "${String(args.label)}" [${String(args.type ?? 'concept')}]`;
  if (tool === 'knowledge_graph_relate' && args.fromLabel && args.toLabel) return `"${String(args.fromLabel)}" →[${String(args.relation ?? 'rel')}]→ "${String(args.toLabel)}"`;
  if (tool === 'swarm_research' && args.topic) return `topic: "${String(args.topic)}" (${String(args.maxWorkers ?? 3)} tabs)`;
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
  if (tool === 'observe_page') return 'scanning affordances (shadow DOM pierced)';
  if (tool === 'act_on_element' && args.action && args.target) return `${String(args.action)} on "${String(args.target)}"`;
  if (tool === 'extract_data' && Array.isArray(args.fields)) return `fields: [${args.fields.join(', ')}]`;
  if (tool === 'workspace_create_file' && args.path) return `file: ${String(args.path)}`;
  if (tool === 'workspace_append_file' && args.path) return `append: ${String(args.path)}`;
  if (tool === 'workspace_read_file' && args.path) return `read: ${String(args.path)}`;
  if (tool === 'workspace_search' && args.query) return `search: "${String(args.query)}"`;
  if (tool === 'clone_page_markdown') return 'extracting markdown to workspace';
  if (tool === 'watch_page_changes') return args.target ? `watching: "${String(args.target)}"` : 'monitoring active page';
  if (tool === 'delegate_to_specialist' && args.role) return `${String(args.role)}: "${String(args.goal ?? '').slice(0, 35)}..." [${String(args.maxTier ?? 'T1')}]`;
  if (tool === 'check_specialist' && args.jobId) return `job: ${String(args.jobId)}`;
  if (tool === 'await_specialist' && args.jobId) return `job: ${String(args.jobId)}`;
  if (tool === 'cancel_specialist' && args.jobId) return `job: ${String(args.jobId)}`;
  if (tool === 'rollback_specialist_edits' && args.jobId) return `job: ${String(args.jobId)}`;
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

// ── Quick-Action Prompt Templates ─────────────────────────────────────────────

interface PromptTemplate {
  icon: React.FC<{ className?: string }>;
  color: string;
  title: string;
  prompt: string;
  badge: string;
}

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    icon: PlayCircle,
    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/60',
    title: 'Auto-Advance Reels',
    prompt: 'Automatically advance short-form video reels or shorts as soon as each video finishes playing',
    badge: 'Autopilot',
  },
  {
    icon: Table,
    color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30 hover:border-cyan-500/60',
    title: 'Extract Table to CSV',
    prompt: 'Extract all rows and columns from the primary data table on this page and save to Virtual Workspace as CSV',
    badge: 'Workspace',
  },
  {
    icon: Sparkles,
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/30 hover:border-amber-500/60',
    title: 'Price Comparison Matrix',
    prompt: 'Search and compare prices, specifications, and availability across 3 major online stores into a markdown matrix',
    badge: 'Research',
  },
  {
    icon: Code2,
    color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30 hover:border-indigo-500/60',
    title: 'Generate Playwright Spec',
    prompt: 'Analyze this webpage and generate a production-ready Playwright end-to-end test spec for the main flow',
    badge: 'DevTools',
  },
  {
    icon: Network,
    color: 'text-purple-400 bg-purple-500/10 border-purple-500/30 hover:border-purple-500/60',
    title: 'Timed Deep Web Research',
    prompt: 'Start an autonomous deep research cycle across multiple tabs on the current topic and compile a comprehensive report',
    badge: 'Swarm',
  },
  {
    icon: ShieldAlert,
    color: 'text-rose-400 bg-rose-500/10 border-rose-500/30 hover:border-rose-500/60',
    title: 'Bypass Popups & Annoyances',
    prompt: 'Dismiss cookie consent dialogs, GDPR banners, and restore locked page scrolling',
    badge: 'Utility',
  },
  {
    icon: FileCode,
    color: 'text-teal-400 bg-teal-500/10 border-teal-500/30 hover:border-teal-500/60',
    title: 'Clip Page to Markdown',
    prompt: 'Clean and convert the main content of this webpage into Markdown and save to Virtual Workspace',
    badge: 'Clipper',
  },
  {
    icon: BellRing,
    color: 'text-sky-400 bg-sky-500/10 border-sky-500/30 hover:border-sky-500/60',
    title: 'Sentinel Change Detector',
    prompt: 'Monitor this page in real-time for any new messages, price shifts, or item changes and alert me immediately',
    badge: 'Sentinel',
  },
];

// ── Specialist Live Monitor ───────────────────────────────────────────────────

interface SpecialistJobUI {
  id: string;
  taskId: string;
  role: string;
  modelId: string;
  tabId: number;
  status: string;
  stepCount: number;
  maxSteps: number;
  effectiveTier: string;
  createdAt: number;
  edits?: Array<{ type: string; summary: string }>;
  report?: {
    summary: string;
    filesModified: string[];
    findings: string[];
    testsRun: string[];
  };
}

const SpecialistLiveMonitor: React.FC<{ activeTaskId: string | null }> = ({ activeTaskId }) => {
  const [jobs, setJobs] = useState<SpecialistJobUI[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const refreshJobs = async () => {
    try {
      if (!chrome.storage?.session) return;
      const res = await chrome.storage.session.get('specialist_jobs');
      const allJobs = (res.specialist_jobs || {}) as Record<string, SpecialistJobUI>;
      const jobList = Object.values(allJobs).filter(
        (j) => !activeTaskId || j.taskId === activeTaskId,
      );
      setJobs(jobList);
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    void refreshJobs();
    const interval = setInterval(refreshJobs, 1500);
    return () => clearInterval(interval);
  }, [activeTaskId]);

  const handleCancel = async (jobId: string) => {
    try {
      const res = await cancelSpecialist({ jobId });
      setActionNotice(res);
      void refreshJobs();
      setTimeout(() => setActionNotice(null), 3000);
    } catch (err) {
      setActionNotice(String(err));
    }
  };

  const handleRollback = async (jobId: string) => {
    try {
      const resStr = await rollbackSpecialistEdits({ jobId });
      const parsed = JSON.parse(resStr) as { revertedEditsCount: number; failedEditsCount: number };
      setActionNotice(`Reverted ${parsed.revertedEditsCount} edits on tab.`);
      void refreshJobs();
      setTimeout(() => setActionNotice(null), 4000);
    } catch (err) {
      setActionNotice(String(err));
    }
  };

  if (jobs.length === 0) return null;

  return (
    <div className="space-y-2 mb-3">
      {actionNotice && (
        <div className="p-2 bg-purple-950/80 border border-purple-700/60 rounded-lg text-purple-200 text-xs font-mono">
          {actionNotice}
        </div>
      )}
      {jobs.map((job) => {
        const isRunning = job.status === 'running' || job.status === 'pending';
        const elapsedSec = Math.round((Date.now() - job.createdAt) / 1000);
        const domEdits = job.edits?.filter((e) => e.type === 'dom').length ?? 0;
        const cssEdits = job.edits?.filter((e) => e.type === 'css').length ?? 0;
        const totalEdits = job.edits?.length ?? 0;

        return (
          <div
            key={job.id}
            className={`p-3 rounded-xl border text-xs ${
              isRunning
                ? 'bg-purple-950/40 border-purple-800/60'
                : 'bg-slate-900/60 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-purple-300">
                <Bot className="w-3.5 h-3.5 text-purple-400" />
                <span className="capitalize">{job.role} Specialist</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-900/60 text-purple-200 border border-purple-700/40">
                  {job.effectiveTier}
                </span>
                {isRunning && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800/60 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                    Tab #{job.tabId}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-mono">
                {isRunning ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                    <span>Step {job.stepCount}/{job.maxSteps}</span>
                    <span>({elapsedSec}s)</span>
                  </>
                ) : (
                  <span className={job.status === 'done' ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {job.status}
                  </span>
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-300 font-mono truncate mb-1">
              Model: <span className="text-slate-200">{job.modelId}</span>
            </p>

            {job.report && (
              <p className="text-[11px] text-slate-400 line-clamp-2 mb-1">
                {job.report.summary}
              </p>
            )}

            {totalEdits > 0 && (
              <div className="text-[11px] text-amber-300/90 font-mono py-0.5">
                {domEdits} DOM modifications, {cssEdits} style changes (runtime-only)
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1.5 mt-1 border-t border-slate-800/80">
              {isRunning && (
                <button
                  type="button"
                  onClick={() => void handleCancel(job.id)}
                  className="px-2 py-0.5 bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800/80 rounded text-[11px] flex items-center gap-1 transition"
                >
                  <X className="w-3 h-3" /> Cancel Specialist
                </button>
              )}
              {totalEdits > 0 && (
                <button
                  type="button"
                  onClick={() => void handleRollback(job.id)}
                  className="px-2 py-0.5 bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-800/80 rounded text-[11px] flex items-center gap-1 transition"
                >
                  <RotateCcw className="w-3 h-3" /> Rollback Edits
                </button>
              )}
            </div>
          </div>
        );
      })}
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
  onOpenSettings,
}) => {
  const [input, setInput] = useState('');
  const [visionOptIn, setVisionOptIn] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string>('nim-cloud');
  const [activeModel, setActiveModel] = useState<string>('meta/llama-3.2-11b-vision-instruct');
  const [hasKey, setHasKey] = useState<boolean>(true);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const [interimText, setInterimText] = useState<string>('');
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const dictationRef = useRef<VoiceDictation>(new VoiceDictation());
  const recorderRef = useRef<VoiceRecorder>(new VoiceRecorder());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const openMicPermissionTab = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({
        url: chrome.runtime.getURL('options.html?grantMic=1'),
      });
    }
  };

  const toggleListening = async () => {
    if (isListening) {
      setIsListening(false);
      dictationRef.current.stop();
      setIsTranscribing(true);
      setMicStatus('Transcribing voice with AI Whisper...');

      try {
        const audioBlob = await recorderRef.current.stop();
        if (audioBlob && audioBlob.size > 1000) {
          const keyData = await chrome.storage.local.get([`keys:${activeProvider}`, 'customBaseUrl']);
          const k = keyData[`keys:${activeProvider}`] as { llmApiKey?: string } | undefined;
          const apiKey = k?.llmApiKey || '';
          const customBaseUrl = keyData.customBaseUrl as string | undefined;

          const text = await transcribeAudio(audioBlob, activeProvider, apiKey, customBaseUrl);
          if (text) {
            setInput((prev) => (prev ? `${prev} ${text}` : text));
          }
        }
      } catch (err) {
        setMicStatus(err instanceof Error ? err.message : String(err));
        setTimeout(() => setMicStatus(null), 5000);
      } finally {
        setIsTranscribing(false);
        setMicStatus(null);
        setInterimText('');
      }
    } else {
      setMicStatus('Checking microphone access...');
      // 1. Prime / test microphone stream first
      const hasAccess = await VoiceDictation.primeMicrophone();
      if (!hasAccess) {
        setIsListening(false);
        setMicStatus('Microphone permission required.');
        openMicPermissionTab();
        return;
      }

      setMicStatus(null);
      try {
        await recorderRef.current.start();
        setIsListening(true);
        setMicStatus('🎙️ Recording voice... Click Mic again or Enter when finished.');

        // Live preview via webkitSpeechRecognition if available (ignore network drops)
        dictationRef.current.start({
          onResult: (transcript, isFinal) => {
            if (isFinal) {
              setInterimText('');
            } else {
              setInterimText(transcript);
            }
          },
          onError: (err) => {
            // Google's speech API throws 'network' in chrome-extension:// origins;
            // Whisper VoiceRecorder handles transcription reliably upon stop.
            if (err === 'network') {
              return;
            }
          },
          onEnd: () => {
            // keep recording active until user clicks mic again
          },
        });
      } catch (err) {
        setIsListening(false);
        setMicStatus(`Microphone error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const toggleSpeaking = (msgId: string, text: string) => {
    if (speakingMsgId === msgId) {
      AudioBriefing.stop();
      setSpeakingMsgId(null);
    } else {
      setSpeakingMsgId(msgId);
      AudioBriefing.speak(text, {
        onEnd: () => setSpeakingMsgId(null),
        onError: () => setSpeakingMsgId(null),
      });
    }
  };

  useEffect(() => {
    const updateActiveInfo = async () => {
      const data = await chrome.storage.local.get(['activeProviderId', 'selectedModelId']);
      const pId = (data.activeProviderId as string) || 'nim-cloud';
      const mId = (data.selectedModelId as string) || 'meta/llama-3.3-70b-instruct';
      setActiveProvider(pId);
      setActiveModel(mId);

      const keyData = await chrome.storage.local.get(`keys:${pId}`);
      const k = keyData[`keys:${pId}`] as { llmApiKey?: string } | undefined;
      setHasKey(!!(k?.llmApiKey && k.llmApiKey.trim().length > 0) || pId === 'ollama');
    };
    void updateActiveInfo();

    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local') {
        void updateActiveInfo();
        if (changes['micPermissionGranted']?.newValue) {
          setMicStatus('✅ Microphone access enabled! Click the mic to speak.');
          setTimeout(() => setMicStatus(null), 4000);
        }
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentSteps, taskStatus]);

  const modelSupportsVision = inferVisionSupport(activeModel);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || activeTaskId) return;
    const userMsg = input.trim();
    setInput('');
    onStartTask(userMsg, modelSupportsVision ? visionOptIn : false);
  };

  const isRunning = taskStatus === 'running' || taskStatus === 'hitl_waiting' || taskStatus === 'plan_preview';

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100">
      {/* Running Cost Bar & Active Provider Pill */}
      <div className="bg-slate-800/80 border-b border-slate-700/60 px-3 py-1.5 text-xs flex items-center justify-between font-mono text-slate-400">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${isRunning ? 'bg-brand-500 animate-pulse' : 'bg-slate-500'}`}></span>
            <span>{costState.taskTokens.toLocaleString()} tok</span>
          </div>

          {/* Clickable Active Provider Pill */}
          <button
            type="button"
            onClick={onOpenSettings}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans transition border ${
              hasKey
                ? 'bg-slate-900/90 text-slate-300 border-slate-700 hover:border-brand-500'
                : 'bg-rose-950/80 text-rose-300 border-rose-600 animate-pulse hover:bg-rose-900'
            }`}
            title="Active LLM Provider — click to change in Settings"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${hasKey ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            <span className="font-medium text-slate-200">{activeProvider}</span>
            <span className="opacity-40">/</span>
            <span className="truncate max-w-[90px]">{activeModel.split('/').pop()}</span>
            <Settings className="w-2.5 h-2.5 ml-0.5 opacity-60" />
          </button>
        </div>

        <div>
          <span>${costState.todayCostUsd.toFixed(3)}</span>
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
        {/* Live Specialist sub-agent status cards */}
        <SpecialistLiveMonitor activeTaskId={activeTaskId} />

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
                  <div className="flex items-center justify-between gap-1.5 text-xs font-semibold text-rose-400 mb-1">
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Execution Notice</span>
                    </div>
                    {/401|invalid api key|no api key|unauthorized/i.test(m.text) && onOpenSettings && (
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[11px] font-medium flex items-center gap-1 transition shadow shrink-0"
                      >
                        <Settings className="w-3 h-3" />
                        <span>Fix in Settings</span>
                      </button>
                    )}
                  </div>
                )}
                {m.sender === 'agent' && (
                  <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-700/50">
                    <span className="text-[10px] font-semibold text-brand-400 uppercase tracking-wider">NIM Agent</span>
                    <button
                      type="button"
                      onClick={() => toggleSpeaking(m.id, m.text)}
                      className={`px-1.5 py-0.5 rounded-md text-xs transition flex items-center gap-1 ${
                        speakingMsgId === m.id
                          ? 'bg-brand-500/20 text-brand-300 animate-pulse'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                      }`}
                      title={speakingMsgId === m.id ? 'Stop audio' : 'Listen to executive briefing'}
                    >
                      {speakingMsgId === m.id ? <VolumeX className="w-3 h-3 text-rose-400" /> : <Volume2 className="w-3 h-3 text-brand-400" />}
                      <span className="text-[10px]">{speakingMsgId === m.id ? 'Stop' : 'Listen'}</span>
                    </button>
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

        {/* Quick-Action Prompt Gallery (When idle / first run) */}
        {!isRunning && messages.length <= 1 && (
          <div className="pt-2 animate-in fade-in duration-300">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5 px-0.5">
              <Sparkles className="w-3.5 h-3.5 text-brand-400" />
              <span>One-Click Action Templates</span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {PROMPT_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.title}
                  type="button"
                  onClick={() => setInput(tmpl.prompt)}
                  className={`p-2.5 rounded-xl border text-left transition flex items-start gap-2.5 group cursor-pointer ${tmpl.color}`}
                >
                  <tmpl.icon className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="text-xs font-semibold text-slate-200 group-hover:text-white transition truncate">
                        {tmpl.title}
                      </span>
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-850/80 text-slate-400 shrink-0">
                        {tmpl.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed group-hover:text-slate-300">
                      {tmpl.prompt}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

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
        {!hasKey && (
          <div className="bg-amber-950/80 border border-amber-600/70 p-2.5 rounded-xl text-xs text-amber-200 flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>No API key set for <strong>{activeProvider}</strong>.</span>
            </div>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition shrink-0 ml-2"
              >
                <Settings className="w-3 h-3" />
                <span>Configure Key</span>
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between text-xs px-1 text-slate-400">
          <label className={`flex items-center gap-1.5 ${modelSupportsVision ? 'cursor-pointer hover:text-slate-200' : 'cursor-not-allowed opacity-50'} transition`}>
            <input
              type="checkbox"
              checked={modelSupportsVision && visionOptIn}
              disabled={!modelSupportsVision}
              onChange={(e) => setVisionOptIn(e.target.checked)}
              className="rounded bg-slate-700 border-slate-600 text-brand-500 focus:ring-brand-500 disabled:opacity-40"
            />
            <span>Enable Vision {modelSupportsVision ? '(multimodal screenshots)' : '(unsupported by current model)'}</span>
          </label>
          <span className="text-[10px] text-slate-500">DOM-first policy active</span>
        </div>

        {micStatus && (
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-300 text-xs shadow-sm">
            <span>{micStatus}</span>
            {micStatus.includes('permission') || micStatus.includes('blocked') ? (
              <button
                type="button"
                onClick={openMicPermissionTab}
                className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-medium text-[11px] border border-amber-400/40 transition ml-2"
              >
                Enable Mic
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMicStatus(null)}
                className="text-amber-400 hover:text-amber-200 ml-2"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {isListening && interimText && (
          <div className="px-2.5 py-1 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs truncate font-mono animate-pulse">
            🎙️ Hearing: <span className="italic">{interimText}</span>
          </div>
        )}

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
            placeholder={
              isTranscribing
                ? 'Transcribing voice with AI Whisper...'
                : isListening
                ? '🎙️ Recording voice... (Click Mic or Enter when finished)'
                : isRunning
                ? 'Agent is working...'
                : 'Describe research or browser task (Enter to send)...'
            }
            disabled={isRunning || isTranscribing}
            rows={2}
            className={`flex-1 bg-slate-950 border ${
              isListening ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-slate-700'
            } rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 resize-none disabled:opacity-50 transition`}
          />

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={toggleListening}
              disabled={isRunning || isTranscribing}
              className={`p-2 rounded-xl border flex items-center justify-center transition ${
                isTranscribing
                  ? 'bg-brand-600/30 border-brand-500 text-brand-300'
                  : isListening
                  ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300 animate-pulse'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              } disabled:opacity-40`}
              title={
                isTranscribing
                  ? 'Transcribing audio with Whisper...'
                  : isListening
                  ? 'Stop recording and transcribe'
                  : 'Voice dictation (Speak instruction)'
              }
            >
              {isTranscribing ? (
                <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
              ) : isListening ? (
                <MicOff className="w-4 h-4 text-rose-400" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>

            {isRunning ? (
              <button
                type="button"
                onClick={onStopTask}
                className="p-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl flex items-center justify-center transition shadow-lg shadow-rose-900/30"
                title="Stop Agent"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="p-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition shadow-lg shadow-brand-900/30"
                title="Send Prompt"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
