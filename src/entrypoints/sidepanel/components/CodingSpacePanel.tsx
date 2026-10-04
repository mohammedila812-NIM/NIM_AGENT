import React, { useState, useEffect } from 'react';
import {
  Code,
  Play,
  Save,
  Trash2,
  Copy,
  Check,
  Sparkles,
  Terminal,
  Eye,
  FileCode,
  FolderOpen,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { vfs, type VFSFile } from '../../../lib/workspace/vfs';
import { executeInBrowserJS, type LogEntry } from '../../../lib/code-runner/runner';
import { chatCompletion } from '../../../lib/llm/client';
import { getPreset } from '../../../lib/llm/providers';
import { loadProviderKeys } from '../../../lib/storage/secure';
import type { ProviderConfig } from '../../../lib/llm/types';

export const CodingSpacePanel: React.FC = () => {
  const [codeFiles, setCodeFiles] = useState<VFSFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('/code/demo.js');
  const [code, setCode] = useState<string>(`// NIM Coding Space — Sandboxed JavaScript
console.log("Welcome to NIM Coding Space! 🚀");

const items = [
  { name: "Llama-3.3-70B", context: 128000 },
  { name: "DeepSeek-R1", context: 64000 },
  { name: "Gemini-2.0-Flash", context: 1000000 }
];

console.table ? console.log(items) : console.log("Models:", items.length);

return items.map(m => m.name.toUpperCase());
`);
  const [language, setLanguage] = useState<'javascript' | 'html' | 'python' | 'json'>('javascript');
  const [activeTab, setActiveTab] = useState<'console' | 'preview'>('console');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [runResult, setRunResult] = useState<string | undefined>();
  const [runError, setRunError] = useState<string | undefined>();
  const [execTime, setExecTime] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // AI Assistant State
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  const loadCodeFiles = async () => {
    await vfs.init();
    await vfs.ensureFolder('/code');
    const all = await vfs.listFiles('/code', true);
    setCodeFiles(all);

    // If demo.js doesn't exist, create it
    const demo = await vfs.readFile('/code/demo.js');
    if (!demo && all.length === 0) {
      await vfs.writeFile('/code/demo.js', code, {
        createdBy: 'system',
        tags: ['code', 'javascript', 'demo'],
      });
      await loadCodeFiles();
    }
  };

  useEffect(() => {
    void loadCodeFiles();
  }, []);

  const handleSelectFile = async (path: string) => {
    setSelectedFilePath(path);
    const file = await vfs.readFile(path);
    if (file) {
      setCode(file.content);
      if (file.extension === 'html') {
        setLanguage('html');
        setActiveTab('preview');
      } else if (file.extension === 'py') {
        setLanguage('python');
        setActiveTab('console');
      } else if (file.extension === 'json') {
        setLanguage('json');
        setActiveTab('console');
      } else {
        setLanguage('javascript');
        setActiveTab('console');
      }
    }
  };

  const handleRunCode = async () => {
    if (language === 'html') {
      setActiveTab('preview');
      return;
    }

    if (language !== 'javascript') {
      setRunError(`In-browser execution for ${language} is not yet implemented. Use JavaScript for sandbox runs.`);
      setActiveTab('console');
      return;
    }

    setIsRunning(true);
    setRunError(undefined);
    setRunResult(undefined);

    const res = await executeInBrowserJS(code);
    setIsRunning(false);
    setLogs(res.logs);
    setRunResult(res.result);
    setRunError(res.error);
    setExecTime(res.executionTimeMs);
    setActiveTab('console');
  };

  const handleSaveToWorkspace = async () => {
    await vfs.writeFile(selectedFilePath, code, {
      createdBy: 'user',
      tags: ['code', language],
      overwrite: true,
    });
    setSaveMessage('Saved to Workspace!');
    setTimeout(() => setSaveMessage(null), 2000);
    await loadCodeFiles();
  };

  const handleNewFile = async () => {
    const filename = prompt('Enter new script name (e.g. scraper.js, dashboard.html):');
    if (!filename) return;

    let path = filename.startsWith('/') ? filename : `/code/${filename}`;
    if (!path.startsWith('/code/')) path = `/code/${filename}`;

    const defaultContent = path.endsWith('.html')
      ? `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; }
    .card { background: #1e293b; border: 1px solid #334155; padding: 15px; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>NIM Interactive Web App</h2>
    <p>Live sandbox preview rendered directly in Chrome.</p>
  </div>
</body>
</html>`
      : `// New script: ${filename}\nconsole.log("Running ${filename}...");\n`;

    await vfs.writeFile(path, defaultContent, {
      createdBy: 'user',
      tags: ['code'],
    });

    await loadCodeFiles();
    void handleSelectFile(path);
  };

  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || isAiGenerating) return;

    setIsAiGenerating(true);
    try {
      const local = (await chrome.storage.local.get([
        'activeProviderId',
        'customBaseUrl',
        'selectedModelId',
      ])) as {
        activeProviderId?: string;
        customBaseUrl?: string;
        selectedModelId?: string;
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

      const modelId = local.selectedModelId || 'meta/llama-3.3-70b-instruct';

      const prompt = `You are an expert full-stack developer in NIM Coding Space.
Write high-quality, production-ready ${language} code for the following request:
"${aiPrompt}"

Current file code context:
\`\`\`${language}
${code.slice(0, 1000)}
\`\`\`

Guidelines:
- Return ONLY the clean code without markdown backticks, without conversational intros or conclusions.
- Make it self-contained and ready to execute or preview.`;

      const res = await chatCompletion(providerConfig, {
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      });

      let gen = res.choices[0]?.message?.content || '';
      // Strip markdown code fences if present
      if (gen.startsWith('```')) {
        gen = gen.replace(/^```[a-z]*\n/, '').replace(/\n```$/, '');
      }

      setCode(gen);
      setAiPrompt('');
    } catch (err: unknown) {
      alert(`AI Code Generation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const handleCopyCode = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Support Tab key in textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const newCode = code.substring(0, start) + '  ' + code.substring(end);
      setCode(newCode);
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      }, 0);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 overflow-hidden text-xs">
      {/* Top Header & Toolbar */}
      <div className="p-2.5 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Code className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="font-semibold text-slate-200">Coding Space</span>

          {/* File Picker */}
          <select
            value={selectedFilePath}
            onChange={(e) => void handleSelectFile(e.target.value)}
            className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-[11px] focus:outline-none focus:border-brand-500 max-w-[140px] truncate"
          >
            {codeFiles.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => void handleNewFile()}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded"
            title="Create New Script"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => void handleRunCode()}
            disabled={isRunning}
            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-medium rounded flex items-center gap-1 text-[11px] transition shadow-sm shadow-emerald-600/30"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>{isRunning ? 'Running...' : 'Run'}</span>
          </button>

          <button
            onClick={() => void handleSaveToWorkspace()}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded flex items-center gap-1 text-[11px] border border-slate-700 transition"
          >
            <Save className="w-3 h-3" />
            <span>{saveMessage || 'Save'}</span>
          </button>

          <button
            onClick={handleCopyCode}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded border border-slate-800"
            title="Copy Code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* AI Assistant Bar */}
      <form
        onSubmit={handleAiGenerate}
        className="p-2 border-b border-slate-800/80 bg-slate-900/60 flex items-center gap-1.5"
      >
        <Sparkles className="w-3.5 h-3.5 text-brand-400 shrink-0" />
        <input
          type="text"
          placeholder="Ask NIM to write, modify, or debug code..."
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          className="flex-1 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded text-slate-200 text-[11px] placeholder-slate-500 focus:outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={isAiGenerating || !aiPrompt.trim()}
          className="px-2.5 py-1 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-800 text-white rounded text-[11px] font-medium transition shrink-0"
        >
          {isAiGenerating ? 'Generating...' : 'Generate'}
        </button>
      </form>

      {/* Code Editor Area */}
      <div className="flex-1 flex flex-col min-h-0 bg-slate-950/80 relative">
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="w-full h-full p-3 font-mono text-[11px] text-slate-200 bg-transparent resize-none focus:outline-none leading-relaxed tracking-wide"
          placeholder="// Type your code here..."
        />
      </div>

      {/* Lower Drawer: Console & Preview Tabs */}
      <div className="h-44 border-t border-slate-800 flex flex-col bg-slate-950/90">
        {/* Drawer Tabs */}
        <div className="px-3 py-1.5 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('console')}
              className={`flex items-center gap-1 text-[11px] font-medium transition ${
                activeTab === 'console' ? 'text-brand-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3 h-3" />
              <span>Console</span>
              {execTime !== null && (
                <span className="text-[9px] text-slate-500 font-mono">({execTime}ms)</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1 text-[11px] font-medium transition ${
                activeTab === 'preview' ? 'text-brand-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>Web Sandbox Preview</span>
            </button>
          </div>

          {activeTab === 'console' && logs.length > 0 && (
            <button
              onClick={() => {
                setLogs([]);
                setRunResult(undefined);
                setRunError(undefined);
              }}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-2.5 font-mono text-[10px]">
          {activeTab === 'console' && (
            <div className="space-y-1">
              {logs.length === 0 && !runResult && !runError ? (
                <div className="text-slate-600 text-center py-4">Click "Run" to execute in sandbox</div>
              ) : (
                <>
                  {logs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 leading-relaxed">
                      <span
                        className={`px-1 py-0.2 rounded text-[8px] uppercase tracking-wider ${
                          log.type === 'error'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800/50'
                            : log.type === 'warn'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800/50'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {log.type}
                      </span>
                      <span
                        className={
                          log.type === 'error'
                            ? 'text-rose-300'
                            : log.type === 'warn'
                            ? 'text-amber-300'
                            : 'text-slate-300'
                        }
                      >
                        {log.text}
                      </span>
                    </div>
                  ))}

                  {runResult !== undefined && (
                    <div className="p-1.5 bg-emerald-950/40 border border-emerald-800/40 rounded text-emerald-300 mt-1">
                      <span className="text-[9px] text-emerald-500 uppercase font-semibold">RETURN: </span>
                      {runResult}
                    </div>
                  )}

                  {runError && (
                    <div className="p-1.5 bg-rose-950/40 border border-rose-800/40 rounded text-rose-300 mt-1">
                      <span className="text-[9px] text-rose-500 uppercase font-semibold">ERROR: </span>
                      {runError}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'preview' && (
            <iframe
              srcDoc={code}
              sandbox="allow-scripts"
              className="w-full h-full bg-white rounded border border-slate-700"
              title="Web Sandbox Preview"
            />
          )}
        </div>
      </div>
    </div>
  );
};
