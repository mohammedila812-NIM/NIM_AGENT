import React from 'react';
import { ShieldCheck, Lock, Eye, Server, Check } from 'lucide-react';

interface FirstRunDisclosureProps {
  onAcknowledge: () => void;
}

export const FirstRunDisclosure: React.FC<FirstRunDisclosureProps> = ({ onAcknowledge }) => {
  return (
    <div className="max-w-2xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6 text-slate-200">
      <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
        <div className="w-10 h-10 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center font-bold text-lg border border-brand-500/30">
          N
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-100">NIM Agent — Data Privacy & Architecture Disclosure</h2>
          <p className="text-xs text-slate-400">Please review how your data is processed before configuring your API keys.</p>
        </div>
      </div>

      <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
        <div className="flex items-start gap-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800/80">
          <Server className="w-5 h-5 text-brand-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-slate-100">Zero Extension Developer Servers</h4>
            <p className="text-slate-400 mt-0.5">
              NIM Agent has no developer backend. All API requests travel directly from your browser to the AI provider endpoint you configure (e.g. NVIDIA NIM cloud, OpenAI, Groq, or your own local self-hosted NIM container).
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800/80">
          <Lock className="w-5 h-5 text-brand-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-slate-100">Session-Only Key Storage</h4>
            <p className="text-slate-400 mt-0.5">
              Your API keys are stored in Chrome’s volatile session storage and cleared whenever the browser closes. Protection is provided by Chrome’s process sandboxing.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800/80">
          <Eye className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-slate-100">On-Demand DOM & Vision Processing</h4>
            <p className="text-slate-400 mt-0.5">
              Page text is read on-demand only when a task requires it. Multimodal screenshots are opt-in per task and never taken in the background without active user initiation.
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={onAcknowledge}
        className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-brand-900/30 text-sm"
      >
        <Check className="w-4 h-4" />
        <span>I Understand and Agree — Proceed to Settings</span>
      </button>
    </div>
  );
};
