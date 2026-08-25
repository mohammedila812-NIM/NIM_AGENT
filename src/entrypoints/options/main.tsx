import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { FirstRunDisclosure } from './FirstRunDisclosure';
import { SettingsPanel } from '../sidepanel/components/SettingsPanel';
import '../../style.css';

function OptionsPage() {
  const [acknowledged, setAcknowledged] = useState<boolean | null>(null);

  useEffect(() => {
    void chrome.storage.local.get('disclosureAcknowledged').then((r) => {
      setAcknowledged(!!r['disclosureAcknowledged']);
    });
  }, []);

  const handleAcknowledge = async () => {
    await chrome.storage.local.set({ disclosureAcknowledged: true });
    setAcknowledged(true);
  };

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
