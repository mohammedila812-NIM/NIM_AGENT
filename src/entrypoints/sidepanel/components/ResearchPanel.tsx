import React, { useState, useEffect, useRef } from 'react';
import {
  BookOpen,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Play,
  Square,
  Clock,
  Globe,
  Sparkles,
  FileText,
  CheckCircle2,
  AlertCircle,
  FileCode,
  HardDrive,
  Flame,
} from 'lucide-react';
import {
  listResearchNotes,
  clearResearchNotes,
  type ResearchNote,
} from '../../../lib/storage/tasks';
import {
  TimedDeepResearchSession,
  type DeepResearchProgress,
} from '../../../lib/agent/deep-research';
import { getPreset } from '../../../lib/llm/providers';
import type { ProviderConfig } from '../../../lib/llm/types';
import type { DiscoveredModel } from '../../../lib/llm/model-registry';
import { loadProviderKeys } from '../../../lib/storage/secure';
import { vfs, type VFSFile } from '../../../lib/workspace/vfs';
import { MarkdownMessage } from './MarkdownMessage';

interface ResearchPanelProps {
  onOpenWorkspacePath?: (path: string) => void;
}

export const ResearchPanel: React.FC<ResearchPanelProps> = ({ onOpenWorkspacePath }) => {
  // Deep Research State
  const [topic, setTopic] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(2);
  const [progress, setProgress] = useState<DeepResearchProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const sessionRef = useRef<TimedDeepResearchSession | null>(null);
  const [liveNotesContent, setLiveNotesContent] = useState<string>('');

  // Workspace Saved Dossiers
  const [savedReports, setSavedReports] = useState<VFSFile[]>([]);

  // Classic quick notes
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [copied, setCopied] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'deep_research' | 'workspace_dossiers' | 'quick_notes'>('deep_research');

  const loadInitialData = async () => {
    // 1. Classic quick notes
    const stored = await listResearchNotes();
    setNotes(stored);

    // 2. Workspace reports
    await vfs.init();
    const allFiles = await vfs.listFiles('/research', true);
    const reports = allFiles.filter((f) => f.name.includes('REPORT') || f.name.includes('notes'));
    setSavedReports(reports);
  };

  useEffect(() => {
    void loadInitialData();

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes['researchNotes']) {
        setNotes((changes['researchNotes'].newValue as ResearchNote[] | undefined) ?? []);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const handleStartDeepResearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isRunning) return;

    // Load active provider & model
    const local = (await chrome.storage.local.get([
      'activeProviderId',
      'customBaseUrl',
      'selectedModelId',
      'searchProvider',
    ])) as {
      activeProviderId?: string;
      customBaseUrl?: string;
      selectedModelId?: string;
      searchProvider?: 'brave' | 'serper';
    };

    const pId = local.activeProviderId || 'nim-cloud';
    const preset = getPreset(pId) || getPreset('nim-cloud')!;
    const keys = await loadProviderKeys(pId);
    const apiKey = keys?.llmApiKey || '';

    const providerConfig: ProviderConfig = {
      id: preset.id,
      label: preset.label,
      baseUrl: local.customBaseUrl || preset.baseUrl,
      apiKey,
    };

    const model: DiscoveredModel = {
      id: local.selectedModelId || 'meta/llama-3.3-70b-instruct',
      contextLength: 128000,
      supportsTools: true,
      supportsVision: false,
      isAgentTuned: true,
      providerLabel: preset.label,
    };

    const searchConfig = keys?.searchApiKey
      ? {
          provider: (keys.searchProvider || local.searchProvider || 'brave') as 'brave' | 'serper',
          apiKey: keys.searchApiKey,
        }
      : undefined;

    const session = new TimedDeepResearchSession(
      {
        topic: topic.trim(),
        durationMinutes,
        providerConfig,
        model,
        searchConfig,
      },
      (p) => {
        setProgress(p);
        if (p.status === 'completed' || p.status === 'stopped' || p.status === 'error') {
          setIsRunning(false);
          void loadInitialData();
        }
        // Read live notes content if active
        if (p.activeFilePath) {
          void vfs.readFile(p.activeFilePath).then((file) => {
            if (file) setLiveNotesContent(file.content);
          });
        }
      }
    );

    sessionRef.current = session;
    setIsRunning(true);
    setLiveNotesContent('');

    try {
      await session.start();
    } catch {
      setIsRunning(false);
    }
  };

  const handleStopResearch = () => {
    if (sessionRef.current) {
      sessionRef.current.stop();
      setIsRunning(false);
    }
  };

  const formatTimer = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopyAll = () => {
    const text = notes
      .map((n) => `## ${n.sourceTitle}\nSource: ${n.sourceUrl}\n\n${n.summary}`)
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClearQuickNotes = async () => {
    await clearResearchNotes();
    setNotes([]);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 overflow-hidden text-xs">
      {/* Sub-tab Navigation */}
      <div className="p-2 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveSubTab('deep_research')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center gap-1.5 ${
              activeSubTab === 'deep_research'
                ? 'bg-brand-600/30 text-brand-300 border border-brand-500/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-brand-400" />
            <span>Timed Deep Research</span>
          </button>
          <button
            onClick={() => setActiveSubTab('workspace_dossiers')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center gap-1.5 ${
              activeSubTab === 'workspace_dossiers'
                ? 'bg-brand-600/30 text-brand-300 border border-brand-500/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 text-sky-400" />
            <span>Workspace Dossiers ({savedReports.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('quick_notes')}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition flex items-center gap-1.5 ${
              activeSubTab === 'quick_notes'
                ? 'bg-brand-600/30 text-brand-300 border border-brand-500/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
            <span>Quick Notes ({notes.length})</span>
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeSubTab === 'deep_research' && (
          <div className="space-y-4">
            {/* Research Launcher Card */}
            {!isRunning && (
              <form
                onSubmit={handleStartDeepResearch}
                className="bg-slate-800/60 border border-slate-700/80 rounded-xl p-3.5 space-y-3 shadow-lg"
              >
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-amber-400" />
                  <span className="font-semibold text-slate-200 text-xs">
                    Autonomous Timed Deep Research
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  The agent crawls the web across multiple domains, gathers verified facts, and
                  streams simultaneous notes directly into your Virtual Workspace. 
                  <strong className="text-slate-200"> It will not stop until your timer runs out.</strong>
                </p>

                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase tracking-wider">Research Objective</label>
                  <input
                    type="text"
                    placeholder="e.g. Solid state battery breakthroughs 2025-2026 or Quantum computing hardware leaders"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-200 text-xs placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span>Continuous Research Duration</span>
                  </label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[
                      { mins: 1, label: '⚡ 1 min (Test)' },
                      { mins: 2, label: '⏱️ 2 mins' },
                      { mins: 5, label: '🔍 5 mins' },
                      { mins: 10, label: '🔬 10 mins' },
                      { mins: 20, label: '📚 20 mins' },
                    ].map((d) => (
                      <button
                        key={d.mins}
                        type="button"
                        onClick={() => setDurationMinutes(d.mins)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                          durationMinutes === d.mins
                            ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/30'
                            : 'bg-slate-900/80 text-slate-400 hover:bg-slate-700 border border-slate-800'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2 bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white font-medium rounded-lg flex items-center justify-center gap-1.5 shadow-md shadow-brand-600/30 transition text-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Launch Deep Research ({durationMinutes}m)</span>
                </button>
              </form>
            )}

            {/* Active Running HUD */}
            {isRunning && progress && (
              <div className="bg-slate-800/80 border border-brand-500/50 rounded-xl p-4 space-y-3.5 shadow-2xl relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-brand-500"></span>
                    </span>
                    <span className="font-semibold text-slate-200 text-xs">
                      Deep Research In Progress...
                    </span>
                  </div>

                  <button
                    onClick={handleStopResearch}
                    className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded flex items-center gap-1 text-[11px] transition"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>Stop</span>
                  </button>
                </div>

                {/* Big Countdown Timer Bar */}
                <div className="p-3 bg-slate-950/70 rounded-lg border border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-slate-400">TIME REMAINING</div>
                    <div className="text-xl font-mono font-bold text-brand-300">
                      {formatTimer(progress.remainingSeconds)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">PAGES CRAWLED</div>
                    <div className="text-lg font-mono font-bold text-slate-200">
                      {progress.pagesVisited}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">NOTES RECORDED</div>
                    <div className="text-lg font-mono font-bold text-emerald-400">
                      {progress.notesRecorded}
                    </div>
                  </div>
                </div>

                {/* Live Action Ticker */}
                <div className="space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">CURRENT ACTION</div>
                  <p className="text-xs text-brand-300 truncate font-mono bg-slate-900/60 p-1.5 rounded border border-slate-800">
                    {progress.currentAction || 'Exploring the web...'}
                  </p>
                </div>

                {/* Live Streaming Notes Drawer */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>LIVE STREAMING NOTES (NIM WORKSPACE)</span>
                    <span className="font-mono text-slate-500 truncate max-w-[180px]">
                      {progress.activeFilePath}
                    </span>
                  </div>
                  <div className="h-44 overflow-y-auto p-2.5 bg-slate-950/80 rounded border border-slate-800 font-mono text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {liveNotesContent || 'Waiting for first findings to be extracted...'}
                  </div>
                </div>
              </div>
            )}

            {/* Completed Progress Card */}
            {!isRunning && progress && progress.status === 'completed' && (
              <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-4 space-y-2 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                <h4 className="text-xs font-semibold text-emerald-300">Deep Research Complete!</h4>
                <p className="text-[11px] text-slate-300 max-w-sm mx-auto">
                  Crawled {progress.pagesVisited} pages and synthesized full Executive Report.
                </p>
                <div className="pt-2">
                  <button
                    onClick={() => onOpenWorkspacePath?.(progress.finalReportPath || '')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5 shadow transition"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>View Dossier in Workspace: {progress.finalReportPath}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Workspace Dossiers Sub-tab */}
        {activeSubTab === 'workspace_dossiers' && (
          <div className="space-y-3">
            <div className="text-[11px] text-slate-400">
              Saved dossiers and rolling research notes stored in <code className="text-brand-300">/research/</code>:
            </div>
            {savedReports.length === 0 ? (
              <div className="p-6 bg-slate-800/40 border border-slate-800 rounded-xl text-center space-y-2">
                <FileCode className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs font-medium text-slate-400">No dossiers yet</p>
                <p className="text-[11px] text-slate-500">
                  Launch a Timed Deep Research session to generate reports automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {savedReports.map((file) => (
                  <div
                    key={file.path}
                    className="p-3 bg-slate-800/60 border border-slate-700/80 rounded-xl flex items-start justify-between gap-2"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="font-semibold text-slate-200 text-xs truncate">{file.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono truncate">{file.path}</div>
                      <div className="text-[10px] text-slate-500">
                        {file.sizeBytes} bytes • {new Date(file.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => onOpenWorkspacePath?.(file.path)}
                      className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-[11px] shrink-0"
                    >
                      Open
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Classic Quick Notes Sub-tab */}
        {activeSubTab === 'quick_notes' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">Accumulated Quick Findings</span>
              {notes.length > 0 && (
                <div className="flex gap-1.5">
                  <button
                    onClick={handleCopyAll}
                    className="px-2 py-0.5 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 flex items-center gap-1"
                  >
                    {copied ? <Check className="w-3 h-3 text-brand-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied' : 'Export'}</span>
                  </button>
                  <button
                    onClick={() => void handleClearQuickNotes()}
                    className="p-1 text-slate-500 hover:text-rose-400"
                    title="Clear Notes"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {notes.length === 0 ? (
              <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-6 text-center space-y-2">
                <BookOpen className="w-8 h-8 text-slate-600 mx-auto" />
                <p className="text-xs font-medium text-slate-300">No Quick Notes Yet</p>
                <p className="text-[11px] text-slate-500">
                  When you ask the agent to summarize pages in chat, key findings appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="bg-slate-800/70 border border-slate-700/80 rounded-xl p-3 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-xs font-semibold text-slate-200 truncate">
                        {note.sourceTitle || 'Web Source'}
                      </h4>
                      {note.sourceUrl && (
                        <a
                          href={note.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-400 hover:text-brand-400"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {note.summary}
                    </p>
                    <div className="text-[10px] text-slate-500">
                      {new Date(note.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
