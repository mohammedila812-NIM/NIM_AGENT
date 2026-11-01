import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { FirstRunDisclosure } from './FirstRunDisclosure';
import { SettingsPanel } from '../sidepanel/components/SettingsPanel';
import '../../style.css';

function MicPermissionPrompt() {
  const [status, setStatus] = useState<'idle' | 'requesting' | 'granted' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const requestMic = async () => {
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setStatus('granted');
      await chrome.storage.local.set({ micPermissionGranted: true });
      setTimeout(() => {
        window.close();
      }, 1500);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="w-full max-w-md bg-slate-900 border border-brand-500/50 rounded-2xl p-6 shadow-2xl text-center space-y-4">
      <div className="w-14 h-14 rounded-full bg-brand-500/20 text-brand-400 flex items-center justify-center mx-auto text-2xl">
        🎙️
      </div>
      <div>
        <h2 className="text-base font-bold text-slate-100">Microphone Access for NIM Agent</h2>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          To use hands-free speech-to-text dictation in the Side Panel, Chrome requires you to grant microphone permission in this browser tab.
        </p>
      </div>

      {status === 'granted' ? (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs">
          ✅ <strong>Microphone access granted!</strong> Closing tab and returning to NIM Side Panel...
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={requestMic}
            disabled={status === 'requesting'}
            className="w-full py-2.5 bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-500 hover:to-indigo-500 text-white font-medium rounded-xl text-xs shadow-lg transition"
          >
            {status === 'requesting' ? 'Requesting Permission...' : 'Allow Microphone Access'}
          </button>
          {status === 'error' && (
            <p className="text-[11px] text-rose-400 bg-rose-950/40 p-2.5 rounded border border-rose-800 text-left">
              Could not access microphone: {errorMsg}. Please ensure your microphone is plugged in and allowed in Chrome settings.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function OptionsPage() {
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
  const isGrantMic = typeof window !== 'undefined' && window.location.search.includes('grantMic');

  useEffect(() => {
    void chrome.storage.local.get('disclosureAcknowledged').then((r) => {
      setAcknowledged(!!r['disclosureAcknowledged']);
    });
  }, []);

  const handleAcknowledge = async () => {
    await chrome.storage.local.set({ disclosureAcknowledged: true });
    setAcknowledged(true);
  };

  if (isGrantMic) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8 flex items-center justify-center">
        <MicPermissionPrompt />
      </div>
    );
  }

  if (acknowledged === null) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 flex items-center justify-center">
      {!acknowledged ? (
        <FirstRunDisclosure onAcknowledge={handleAcknowledge} />
      ) : (
        <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h1 className="text-lg font-bold text-slate-100">NIM Agent Configuration</h1>
            <p className="text-xs text-slate-400">Configure your LLM provider, search APIs, and token limits.</p>
          </div>
          <SettingsPanel />
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsPage />
  </React.StrictMode>,
);
