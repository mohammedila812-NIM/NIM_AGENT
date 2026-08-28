import React, { useState, useEffect } from 'react';
import {
  Bell, Play, Pause, Trash2, RefreshCw, Plus, ExternalLink,
  AlertCircle, CheckCircle2, Clock, Globe, ShieldAlert, X, Zap,
} from 'lucide-react';
import {
  listWatches,
  saveWatch,
  deleteWatch,
  toggleWatchStatus,
  type WatchTarget,
  type WatchType,
} from '../../../lib/storage/watch';
import { listMacros, type Macro } from '../../../lib/storage/tasks';
import { executeWatchCheck } from '../../../lib/agent/watch-engine';

export const WatchPanel: React.FC = () => {
  const [watches, setWatches] = useState<WatchTarget[]>([]);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<{ id: string; message: string; success: boolean } | null>(null);

  // New Watch Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<WatchType>('price');
  const [selector, setSelector] = useState('');
  const [conditionPrompt, setConditionPrompt] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [selectedMacroId, setSelectedMacroId] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [items, macroList] = await Promise.all([listWatches(), listMacros()]);
      setWatches(items);
      setMacros(macroList);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // Refresh list every 10 seconds to update timestamps
    const timer = setInterval(() => {
      void loadAll();
    }, 10_000);
    return () => clearInterval(timer);
  }, []);

  const handleToggle = async (watchId: string) => {
    await toggleWatchStatus(watchId);
    await loadAll();
  };

  const handleDelete = async (watchId: string) => {
    await deleteWatch(watchId);
    await loadAll();
  };

  const handleCheckNow = async (watchId: string) => {
    setCheckingId(watchId);
    try {
      const res = await executeWatchCheck(watchId, true);
      setStatusToast({
        id: watchId,
        message: res.summary || (res.changed ? 'Change detected!' : 'Check complete: No changes.'),
        success: res.success,
      });
      await loadAll();
    } catch (err: unknown) {
      setStatusToast({
        id: watchId,
        message: err instanceof Error ? err.message : 'Check failed',
        success: false,
      });
    } finally {
      setCheckingId(null);
      setTimeout(() => setStatusToast(null), 5000);
    }
  };

  const handleCreateWatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) return;

    const newTarget: WatchTarget = {
      watchId: crypto.randomUUID(),
      name: name.trim(),
      url: url.trim(),
      type,
      selector: selector.trim() || undefined,
      conditionPrompt: conditionPrompt.trim() || undefined,
      macroId: selectedMacroId || undefined,
      intervalMinutes: Math.max(1, Number(intervalMinutes) || 30),
      status: 'active',
      alertCount: 0,
      notificationOnMatch: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveWatch(newTarget);
    setIsModalOpen(false);
    setName('');
    setUrl('');
    setSelector('');
    setConditionPrompt('');
    setSelectedMacroId('');
    setIntervalMinutes(30);
    await loadAll();
  };

  const handleOpenUrl = (targetUrl: string) => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: targetUrl });
    } else {
      window.open(targetUrl, '_blank');
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/80 bg-slate-900/60 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">Scheduled Monitors</h2>
            <p className="text-[10px] text-slate-400">Background page polling & alerts</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadAll()}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition"
            title="Refresh monitors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Watch</span>
          </button>
        </div>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {watches.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-48 text-center px-4 text-slate-500">
            <Bell className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs font-medium text-slate-400">No scheduled monitors yet</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-xs">
              Add a monitor or ask the agent in chat: <span className="text-indigo-400">"Watch this Amazon item for price drops"</span>
            </p>
          </div>
        )}

        {watches.map((w) => {
          const isChecking = checkingId === w.watchId;
          const lastChecked = w.lastCheckedAt ? new Date(w.lastCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never';
          const isActive = w.status === 'active';

          return (
            <div
              key={w.watchId}
              className={`p-3 rounded-xl border transition-all ${
                isActive
                  ? 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  : 'bg-slate-900/20 border-slate-800/40 opacity-70'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                    <h3 className="text-xs font-bold text-slate-200 truncate">{w.name}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono border border-indigo-500/20">
                      Every {w.intervalMinutes}m
                    </span>
                  </div>
                  <button
                    onClick={() => handleOpenUrl(w.url)}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-300 transition mt-1 truncate max-w-full text-left"
                  >
                    <Globe className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{w.url}</span>
                    <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
                  </button>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => void handleCheckNow(w.watchId)}
                    disabled={isChecking}
                    className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition"
                    title="Check now in background"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-indigo-400' : ''}`} />
                  </button>
                  <button
                    onClick={() => void handleToggle(w.watchId)}
                    className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-md transition"
                    title={isActive ? 'Pause monitoring' : 'Resume monitoring'}
                  >
                    {isActive ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
                  </button>
                  <button
                    onClick={() => void handleDelete(w.watchId)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition"
                    title="Delete monitor"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Condition or Selector Info */}
              {(w.conditionPrompt || w.selector) && (
                <div className="mt-2 text-[10px] text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 flex flex-col gap-1">
                  {w.conditionPrompt && (
                    <div>
                      <span className="font-semibold text-indigo-300">Condition:</span> {w.conditionPrompt}
                    </div>
                  )}
                  {w.selector && (
                    <div>
                      <span className="font-semibold text-slate-400">Selector:</span> <code className="text-slate-300">{w.selector}</code>
                    </div>
                  )}
                </div>
              )}

              {/* Attached Macro Info */}
              {w.macroId && (
                <div className="mt-2 text-[10px] text-amber-300 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20 flex items-center gap-1.5 w-fit">
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span>
                    Trigger Macro: <strong className="text-amber-200">{macros.find((m) => m.macroId === w.macroId)?.name || 'Attached Macro'}</strong>
                  </span>
                </div>
              )}

              {/* Snapshot Info */}
              {w.lastSnapshot && (
                <div className="mt-2 text-[10px] text-slate-400 bg-slate-950/40 px-2 py-1.5 rounded border border-slate-800/40">
                  <span className="text-slate-500">Last Snapshot:</span>{' '}
                  <span className="text-slate-300 italic">"{w.lastSnapshot.slice(0, 80)}{w.lastSnapshot.length > 80 ? '...' : ''}"</span>
                </div>
              )}

              {/* Footer Meta */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/40 text-[10px] text-slate-500">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  <span>Checked: {lastChecked}</span>
                </div>
                <div>
                  <span>Alerts fired: <strong className="text-slate-300">{w.alertCount}</strong></span>
                </div>
              </div>

              {/* Status Toast / Inline Alert */}
              {statusToast && statusToast.id === w.watchId && (
                <div className={`mt-2 text-[10px] p-2 rounded flex items-center gap-1.5 ${statusToast.success ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'}`}>
                  {statusToast.success ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                  <span>{statusToast.message}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New Watch Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/40">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-indigo-400" />
                <span>Create Scheduled Monitor</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWatch} className="p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Monitor Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acer Laptop Price Watch"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Target Webpage URL *</label>
                <input
                  type="url"
                  required
                  placeholder="https://..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Monitor Type</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as WatchType)}
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="price">Price Watch</option>
                    <option value="element_text">Element Text</option>
                    <option value="llm_condition">Semantic Prompt</option>
                    <option value="dom_selector">DOM Selector</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">Interval (Minutes)</label>
                  <select
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value={5}>Every 5 mins</option>
                    <option value={15}>Every 15 mins</option>
                    <option value={30}>Every 30 mins</option>
                    <option value={60}>Every 1 hour</option>
                    <option value={360}>Every 6 hours</option>
                    <option value={1440}>Every 24 hours</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">CSS Selector (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. .price, #stock-status, h1"
                  value={selector}
                  onChange={(e) => setSelector(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">Condition Prompt (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Alert if price drops below $650 or in stock"
                  value={conditionPrompt}
                  onChange={(e) => setConditionPrompt(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span>Trigger Saved Macro on Match (Optional)</span>
                </label>
                <select
                  value={selectedMacroId}
                  onChange={(e) => setSelectedMacroId(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">None (Desktop notification only)</option>
                  {macros.map((m) => (
                    <option key={m.macroId} value={m.macroId}>
                      ⚡ {m.name} ({m.actionSequence?.length || 0} steps)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                >
                  Save & Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
