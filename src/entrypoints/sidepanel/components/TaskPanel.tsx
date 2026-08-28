import React, { useState, useEffect } from 'react';
import { Play, Trash2, Bookmark, CheckCircle2, AlertCircle, Clock, RotateCcw, Zap, Loader2 } from 'lucide-react';
import { listTasks, listMacros, deleteTask, deleteMacro, type StoredTask, type Macro } from '../../../lib/storage/tasks';
import { executeMacro, type MacroStepResult } from '../../../lib/agent/macro-executor';

interface TaskPanelProps {
  onRunMacro: (instruction: string) => void;
}

export const TaskPanel: React.FC<TaskPanelProps> = ({ onRunMacro }) => {
  const [tasks, setTasks] = useState<StoredTask[]>([]);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [replayStatus, setReplayStatus] = useState<{
    macroId: string;
    step: number;
    total: number;
    message: string;
    success?: boolean;
  } | null>(null);

  const loadData = async () => {
    const [t, m] = await Promise.all([listTasks(), listMacros()]);
    setTasks(t);
    setMacros(m);
  };

  useEffect(() => {
    void loadData();

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local') {
        const hasTaskOrMacroChange = Object.keys(changes).some(
          (k) => k.startsWith('task:') || k.startsWith('macro:')
        );
        if (hasTaskOrMacroChange) {
          void loadData();
        }
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const handleDeleteTask = async (id: string) => {
    await deleteTask(id);
    void loadData();
  };

  const handleDeleteMacro = async (id: string) => {
    await deleteMacro(id);
    void loadData();
  };

  const handleReplayMacro = async (macro: Macro) => {
    if (!macro.actionSequence || macro.actionSequence.length === 0) {
      onRunMacro(macro.instruction);
      return;
    }

    setReplayingId(macro.macroId);
    setReplayStatus({
      macroId: macro.macroId,
      step: 0,
      total: macro.actionSequence.length,
      message: 'Initializing deterministic replay...',
    });

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const targetTabId = tabs[0]?.id;
      if (!targetTabId) {
        throw new Error('No active browser tab found to replay macro.');
      }

      const result = await executeMacro(macro, targetTabId, {
        onStepStart: (step, total, action) => {
          setReplayStatus({
            macroId: macro.macroId,
            step,
            total,
            message: `Step ${step}/${total}: ${action.tool} ${action.targetLabel ? `("${action.targetLabel}")` : ''}`,
          });
        },
        onStepComplete: (step, total, stepResult) => {
          setReplayStatus({
            macroId: macro.macroId,
            step,
            total,
            message: stepResult.success
              ? `Step ${step}/${total} complete${stepResult.healed ? ' (Self-Healed)' : ''}`
              : `Step ${step}/${total} failed: ${stepResult.error || 'Unknown error'}`,
            success: stepResult.success,
          });
        },
      });

      setReplayStatus({
        macroId: macro.macroId,
        step: result.stepsCompleted,
        total: result.totalSteps,
        message: result.success
          ? `✓ Replayed ${result.stepsCompleted}/${result.totalSteps} steps in 0ms! (${result.tokensUsed} tokens)`
          : `Replay stopped at step ${result.stepsCompleted + 1}: ${result.error || 'Failed'}`,
        success: result.success,
      });

      await loadData();
    } catch (err: unknown) {
      setReplayStatus({
        macroId: macro.macroId,
        step: 0,
        total: macro.actionSequence.length,
        message: err instanceof Error ? err.message : 'Replay execution failed',
        success: false,
      });
    } finally {
      setReplayingId(null);
      setTimeout(() => {
        setReplayStatus(null);
      }, 6000);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-900 text-slate-100">
      {/* Reusable Macros */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand-400">
          <Bookmark className="w-4 h-4" />
          <span>Saved Macros (Deterministic Replay)</span>
        </div>

        {macros.length === 0 ? (
          <p className="text-xs text-slate-500 italic bg-slate-800/40 p-3 rounded-lg border border-slate-800">
            No saved macros yet. Save successful task runs from the Trace tab to replay them directly with 0 token cost.
          </p>
        ) : (
          <div className="space-y-2">
            {macros.map((macro) => {
              const isRunningThis = replayingId === macro.macroId;
              const hasStatus = replayStatus?.macroId === macro.macroId;

              return (
                <div
                  key={macro.macroId}
                  className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3 flex flex-col gap-2 hover:border-slate-600 transition"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-sm font-medium text-slate-200">{macro.name}</h4>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-300 font-mono border border-indigo-500/20">
                          {macro.actionSequence?.length || 0} steps
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{macro.instruction}</p>
                      <span className="text-[10px] text-slate-500 mt-0.5 inline-block">
                        Executed {macro.runCount} times · 0 tokens
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => void handleReplayMacro(macro)}
                        disabled={isRunningThis}
                        className="p-1.5 bg-brand-600/20 text-brand-400 hover:bg-brand-600 hover:text-white rounded-lg transition flex items-center gap-1 text-xs font-semibold px-2"
                        title="Replay deterministically"
                      >
                        {isRunningThis ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                        )}
                        <span>Replay</span>
                      </button>
                      <button
                        onClick={() => handleDeleteMacro(macro.macroId)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 transition"
                        title="Delete Macro"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Replay Status Banner */}
                  {hasStatus && (
                    <div
                      className={`text-[11px] p-2 rounded-lg border flex items-center gap-2 ${
                        replayStatus.success === true
                          ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                          : replayStatus.success === false
                          ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                          : 'bg-slate-950/80 text-indigo-300 border-indigo-500/30'
                      }`}
                    >
                      {isRunningThis && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
                      <span className="truncate">{replayStatus.message}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Task Execution History */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Clock className="w-4 h-4" />
          <span>Recent Tasks</span>
        </div>

        {tasks.length === 0 ? (
          <p className="text-xs text-slate-500 italic bg-slate-800/40 p-3 rounded-lg border border-slate-800">
            No past tasks recorded.
          </p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.taskId}
                className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-3 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium text-slate-200 line-clamp-2">
                    {task.instruction}
                  </span>
                  <button
                    onClick={() => handleDeleteTask(task.taskId)}
                    className="text-slate-500 hover:text-rose-400 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className="flex items-center gap-1">
                    {task.status === 'done' && <CheckCircle2 className="w-3 h-3 text-brand-400" />}
                    {task.status === 'error' && <AlertCircle className="w-3 h-3 text-rose-400" />}
                    {task.status === 'paused' && <RotateCcw className="w-3 h-3 text-amber-400" />}
                    <span className={`capitalize ${task.status === 'paused' ? 'text-amber-400 font-medium' : ''}`}>
                      {task.status}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    {task.status === 'paused' && (
                      <button
                        onClick={() => {
                          chrome.runtime.sendMessage({
                            type: 'AGENT_RESUME',
                            taskId: task.taskId,
                          }).catch(() => {});
                        }}
                        className="px-2 py-0.5 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 rounded flex items-center gap-1 font-medium transition"
                        title="Resume Interrupted Task"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>Resume</span>
                      </button>
                    )}
                    <span>{new Date(task.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
