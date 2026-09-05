import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Mic, Check, AlertCircle } from 'lucide-react';
import { FirstRunDisclosure } from './FirstRunDisclosure';
import { SettingsPanel } from '../sidepanel/components/SettingsPanel';
import '../../style.css';

function OptionsPage() {
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
  const [isRequestingMic, setIsRequestingMic] = useState(false);
  const isMicFocus = typeof window !== 'undefined' && window.location.hash.includes('mic');

  useEffect(() => {
    void chrome.storage.local.get('disclosureAcknowledged').then((r) => {
      setAcknowledged(!!r['disclosureAcknowledged']);
    });

    // Check current mic permission state
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' as PermissionName }).then((res) => {
        setMicGranted(res.state === 'granted');
        res.onchange = () => {
          setMicGranted(res.state === 'granted');
        };
      }).catch(() => {});
    }
  }, []);

  const handleAcknowledge = async () => {
    await chrome.storage.local.set({ disclosureAcknowledged: true });
    setAcknowledged(true);
  };

  const handleRequestMic = async () => {
    setIsRequestingMic(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicGranted(true);
    } catch {
      setMicGranted(false);
    } finally {
      setIsRequestingMic(false);
    }
  };

  if (acknowledged === null) return null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 flex items-center justify-center">
      {!acknowledged ? (
        <FirstRunDisclosure onAcknowledge={handleAcknowledge} />
      ) : (
        <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-slate-100">NIM Agent Configuration</h1>
              <p className="text-xs text-slate-400">Configure your LLM provider, search APIs, voice input, and tokens.</p>
            </div>
          </div>

          {/* Microphone Permission Quick Action Card */}
          <div
            className={`p-4 rounded-xl border transition ${
              micGranted === true
                ? 'bg-emerald-950/40 border-emerald-600/40'
                : isMicFocus
                ? 'bg-brand-950/80 border-brand-500 ring-2 ring-brand-500/40'
                : 'bg-slate-950/60 border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg mt-0.5 ${micGranted === true ? 'bg-emerald-500/20 text-emerald-400' : 'bg-brand-500/20 text-brand-400'}`}>
                  <Mic className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-xs text-slate-100">Microphone Permission for Voice Commands</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    {micGranted === true
                      ? '✅ Microphone access is granted! You can now speak voice commands in the side panel.'
                      : 'Click the button to allow microphone access for the extension origin in this browser.'}
                  </p>
                </div>
              </div>

              <div className="shrink-0">
                {micGranted === true ? (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold px-3 py-1.5 bg-emerald-950/60 border border-emerald-600/40 rounded-xl">
                    <Check className="w-3.5 h-3.5" /> Granted
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleRequestMic}
                    disabled={isRequestingMic}
                    className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-md shadow-brand-900/30"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>{isRequestingMic ? 'Prompting...' : 'Allow Microphone'}</span>
                  </button>
                )}
              </div>
            </div>
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
