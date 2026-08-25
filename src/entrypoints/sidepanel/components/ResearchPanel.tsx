import React, { useState, useEffect } from 'react';
import { BookOpen, Copy, Check, Download, Trash2, ExternalLink } from 'lucide-react';
import { listResearchNotes, clearResearchNotes, type ResearchNote } from '../../../lib/storage/tasks';

export const ResearchPanel: React.FC = () => {
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [copied, setCopied] = useState(false);

  const loadNotes = async () => {
    const stored = await listResearchNotes();
    setNotes(stored);
  };

  useEffect(() => {
    void loadNotes();

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes['researchNotes']) {
        setNotes((changes['researchNotes'].newValue as ResearchNote[] | undefined) ?? []);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const handleCopyAll = () => {
    const text = notes
      .map((n) => `## ${n.sourceTitle}\nSource: ${n.sourceUrl}\n\n${n.summary}`)
      .join('\n\n---\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = async () => {
    await clearResearchNotes();
    setNotes([]);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand-400">
          <BookOpen className="w-4 h-4" />
          <span>Synthesized Research Notes</span>
        </div>
        {notes.length > 0 && (
          <div className="flex gap-1.5">
            <button
              onClick={handleCopyAll}
              className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 flex items-center gap-1 transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-brand-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Export'}
            </button>
            <button
              onClick={handleClear}
              className="p-1 text-slate-500 hover:text-rose-400 transition"
              title="Clear Notes"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {notes.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-6 text-center space-y-2">
          <BookOpen className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-medium text-slate-300">No Research Notes Yet</p>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            When you ask the agent to research topics across multiple tabs and search engines, key findings and citations are accumulated here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <div
              key={note.id}
              className="bg-slate-800/70 border border-slate-700/80 rounded-xl p-3.5 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-xs font-semibold text-slate-200">{note.sourceTitle || 'Web Source'}</h4>
                {note.sourceUrl && (
                  <a
                    href={note.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-400 hover:text-brand-400 p-0.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
              <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
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
  );
};
