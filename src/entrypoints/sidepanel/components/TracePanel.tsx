import React, { useState, useEffect } from 'react';
import { Activity, Undo2, Save, Terminal, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { saveMacro } from '../../../lib/storage/tasks';

interface TraceStep {
  stepNumber: number;
  reasoning: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: string;
  isUndoable?: boolean;
  workerName?: string;
}

interface TracePanelProps {
  activeTaskId: string | null;
  instruction: string;
  traceSteps: TraceStep[];
  onUndoAction?: (actionIndex: number) => void;
}

export const TracePanel: React.FC<TracePanelProps> = ({
  activeTaskId,
  instruction,
  traceSteps,
  onUndoAction,
}) => {
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({});
  const [macroName, setMacroName] = useState('');
  const [savedMacro, setSavedMacro] = useState(false);

  const toggleStep = (stepNum: number) => {
    setExpandedSteps((prev) => ({ ...prev, [stepNum]: !prev[stepNum] }));
  };

  const handleSaveAsMacro = async () => {
    if (!macroName.trim() || traceSteps.length === 0) return;
    await saveMacro({
      macroId: crypto.randomUUID(),
      name: macroName.trim(),
      instruction,
      actionSequence: traceSteps
        .filter((s) => s.toolName)
        .map((s) => ({
          tool: s.toolName!,
          args: s.toolArgs,
          targetLabel: (s.toolArgs?.target as string) || (s.reasoning ? s.reasoning.slice(0, 100) : undefined),
          reasoning: s.reasoning,
        })),
      createdAt: Date.now(),
      runCount: 0,
    });
    setSavedMacro(true);
    setMacroName('');
    setTimeout(() => setSavedMacro(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-900 text-slate-100">
      {/* Header & Save as Macro */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand-400">
          <Activity className="w-4 h-4" />
          <span>Execution Trace (Reason → Act → Observe)</span>
        </div>
      </div>

      {traceSteps.length > 0 && (
        <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3 flex gap-2">
          <input
            type="text"
            value={macroName}
            onChange={(e) => setMacroName(e.target.value)}
            placeholder="Save this run as reusable Macro name..."
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-brand-500"
          />
          <button
            onClick={handleSaveAsMacro}
            disabled={!macroName.trim()}
            className="px-3 py-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white rounded-lg text-xs flex items-center gap-1 transition"
          >
            {savedMacro ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {savedMacro ? 'Saved' : 'Save Macro'}
          </button>
        </div>
      )}

      {traceSteps.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-6 text-center space-y-2">
          <Terminal className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-medium text-slate-300">No Active Trace</p>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Start a task in the Chat tab to see the live step-by-step reasoning, tool dispatch, and observation telemetry.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {traceSteps.map((step, idx) => (
            <div
              key={step.stepNumber}
              className="bg-slate-800/80 border border-slate-700/80 rounded-xl overflow-hidden shadow-sm"
            >
              {/* Step Header */}
              <button
                onClick={() => toggleStep(step.stepNumber)}
                className="w-full px-3.5 py-2.5 flex items-center justify-between hover:bg-slate-750 text-left transition"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {expandedSteps[step.stepNumber] ? (
                    <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <span className="text-xs font-semibold text-brand-400 font-mono">
                    Step {step.stepNumber}
                  </span>
                  {step.workerName && (
                    <span className="px-1.5 py-0.5 bg-purple-900/60 border border-purple-700/60 rounded text-[10px] font-mono text-purple-300">
                      Sub-Agent: {step.workerName}
                    </span>
                  )}
                  {step.toolName && (
                    <span className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-[11px] font-mono text-slate-300">
                      {step.toolName}
                    </span>
                  )}
                </div>

                {step.isUndoable && onUndoAction && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUndoAction(idx);
                    }}
                    className="p-1 text-slate-400 hover:text-amber-400 rounded transition"
                    title="Undo Action"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </button>

              {/* Step Detail */}
              {expandedSteps[step.stepNumber] && (
                <div className="px-3.5 pb-3.5 pt-1 space-y-2 border-t border-slate-700/50 text-xs">
                  {/* Reasoning */}
                  {step.reasoning && (
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Reasoning
                      </span>
                      <p className="mt-0.5 text-slate-200 whitespace-pre-wrap">{step.reasoning}</p>
                    </div>
                  )}

                  {/* Tool Arguments */}
                  {step.toolArgs && (
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Arguments
                      </span>
                      <pre className="mt-0.5 bg-slate-950 p-2 rounded text-[11px] font-mono text-slate-300 overflow-x-auto border border-slate-800">
                        {JSON.stringify(step.toolArgs, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Observation Result */}
                  {step.result && (
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Observation
                      </span>
                      <pre className="mt-0.5 bg-slate-950 p-2 rounded text-[11px] font-mono text-slate-300 overflow-x-auto border border-slate-800 whitespace-pre-wrap">
                        {step.result}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
