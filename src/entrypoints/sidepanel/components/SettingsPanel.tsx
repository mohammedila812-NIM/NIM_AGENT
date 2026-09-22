import React, { useState, useEffect } from 'react';
import { Settings, Key, Globe, Cpu, DollarSign, Save, Check, RefreshCw, Shield, AlertTriangle, Sparkles, Monitor } from 'lucide-react';
import { PROVIDER_PRESETS } from '../../../lib/llm/providers';
import { saveProviderKeys, loadProviderKeys, saveWorkerConfig, loadWorkerConfig } from '../../../lib/storage/secure';
import { discoverModels, sortModelsForDisplay, isChatModel, type DiscoveredModel } from '../../../lib/llm/model-registry';
import { DEFAULT_LIMITS, resetDailyCounters, type CostLimits } from '../../../lib/agent/cost-guard';
import { desktopBridge, DEFAULT_BRIDGE_CONFIG, type DesktopBridgeConfig, type BridgeConnectionState } from '../../../lib/bridge/desktop-bridge';

export const SettingsPanel: React.FC = () => {
  const [providerId, setProviderId] = useState('nim-cloud');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [searchApiKey, setSearchApiKey] = useState('');
  const [searchProvider, setSearchProvider] = useState<'brave' | 'serper'>('brave');
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('meta/llama-3.3-70b-instruct');
  const [costLimits, setCostLimits] = useState<CostLimits>(DEFAULT_LIMITS);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Desktop Bridge configuration
  const [bridgeConfig, setBridgeConfig] = useState<DesktopBridgeConfig>(DEFAULT_BRIDGE_CONFIG);
  const [bridgeState, setBridgeState] = useState<BridgeConnectionState>(desktopBridge.getState());

  // Worker / Sub-agent configuration
  const [workerProviderId, setWorkerProviderId] = useState('nim-cloud');
  const [workerApiKey, setWorkerApiKey] = useState('');
  const [workerModelId, setWorkerModelId] = useState('meta/llama-3.1-8b-instruct');

  useEffect(() => {
    void loadSettings();
    const unsub = desktopBridge.onStateChange(setBridgeState);
    return () => unsub();
  }, []);

  const loadSettings = async () => {
    const local = (await chrome.storage.local.get([
      'activeProviderId',
      'customBaseUrl',
      'selectedModelId',
      'searchProvider',
      'costLimits',
      'desktopBridgeConfig',
    ])) as {
      activeProviderId?: string;
      customBaseUrl?: string;
      selectedModelId?: string;
      searchProvider?: 'brave' | 'serper';
      costLimits?: CostLimits;
      desktopBridgeConfig?: DesktopBridgeConfig;
    };

    const pId = local.activeProviderId || 'nim-cloud';
    setProviderId(pId);
    setCustomBaseUrl(local.customBaseUrl || '');
    setSearchProvider(local.searchProvider || 'brave');
    if (local.costLimits) setCostLimits(local.costLimits);
    if (local.desktopBridgeConfig) setBridgeConfig(local.desktopBridgeConfig);

    const keys = await loadProviderKeys(pId);
    if (keys) {
      setApiKey(keys.llmApiKey);
      if (keys.searchApiKey) setSearchApiKey(keys.searchApiKey);
      if (keys.searchProvider) setSearchProvider(keys.searchProvider);
    }

    if (local.selectedModelId && isChatModel(local.selectedModelId)) {
      setSelectedModelId(local.selectedModelId);
    } else {
      setSelectedModelId('meta/llama-3.3-70b-instruct');
    }

    // Load worker sub-agent settings
    const workerConfig = await loadWorkerConfig();
    if (workerConfig) {
      if (workerConfig.providerId) setWorkerProviderId(workerConfig.providerId);
      if (workerConfig.apiKey) setWorkerApiKey(workerConfig.apiKey);
      if (workerConfig.modelId) setWorkerModelId(workerConfig.modelId);
    }
  };

  const handleFetchModels = async () => {
    if (!apiKey) {
      alert('Please enter your API Key first.');
      return;
    }
    setIsLoadingModels(true);
    try {
      const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
      const baseUrl = providerId === 'custom' ? customBaseUrl : preset?.baseUrl || 'https://integrate.api.nvidia.com/v1';

      const list = await discoverModels({
        id: providerId,
        label: preset?.label || 'Custom',
        baseUrl,
        apiKey,
      });

      const sorted = sortModelsForDisplay(list);
      setModels(sorted);

      if (sorted.length > 0) {
        // Find flagship or first chat model
        const currentValid = sorted.find((m) => m.id === selectedModelId);
        if (!currentValid) {
          setSelectedModelId(sorted[0].id);
        }
      }
    } catch (err: unknown) {
      alert(`Could not discover models: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveProviderKeys(providerId, {
      llmApiKey: apiKey,
      searchApiKey: searchApiKey || undefined,
      searchProvider,
    });

    await saveWorkerConfig({
      providerId: workerProviderId,
      apiKey: workerApiKey,
      modelId: workerModelId,
    });

    const chosenModel = models.find((m) => m.id === selectedModelId) || {
      id: selectedModelId,
      contextLength: 128_000,
      supportsTools: true,
      supportsVision: false,
      isAgentTuned: true,
      providerLabel: providerId,
    };

    await chrome.storage.local.set({
      activeProviderId: providerId,
      customBaseUrl,
      selectedModelId,
      selectedModel: chosenModel,
      searchProvider,
      costLimits,
      desktopBridgeConfig: bridgeConfig,
    });

    if (bridgeConfig.enabled && bridgeConfig.authToken) {
      desktopBridge.connect(bridgeConfig.serverUrl, bridgeConfig.authToken);
    } else {
      desktopBridge.disconnect();
    }

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  return (
    <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-900 text-slate-100 text-xs">
      {/* Session Storage Honesty Banner */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-3.5 space-y-1 text-slate-300">
        <div className="flex items-center gap-1.5 font-semibold text-brand-400">
          <Shield className="w-4 h-4" />
          <span>Local Storage Security Model</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Your API keys are saved locally in Chrome's extension storage and persist across browser restarts. They are sandboxed to this extension — no other site or extension can read them. Clear them anytime with the Reset button.
        </p>
      </div>

      {/* Provider Selector */}
      <div className="space-y-2">
        <label className="font-semibold text-slate-200 flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-brand-400" />
          <span>LLM Provider</span>
        </label>
        <select
          value={providerId}
          onChange={(e) => {
            setProviderId(e.target.value);
            setModels([]);
          }}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {providerId === 'custom' && (
        <div className="space-y-1.5">
          <label className="font-semibold text-slate-200">Custom Base URL</label>
          <input
            type="url"
            value={customBaseUrl}
            onChange={(e) => setCustomBaseUrl(e.target.value)}
            placeholder="http://localhost:8000/v1"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
          />
        </div>
      )}

      {/* LLM API Key */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="font-semibold text-slate-200 flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5 text-brand-400" />
            <span>LLM API Key ({providerId === 'gemini' ? 'AIzaSy...' : providerId === 'ollama' ? 'Optional for local' : 'nvapi-... / sk-...'})</span>
          </label>
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            providerId === 'gemini'
              ? 'AIzaSy...'
              : providerId === 'ollama'
              ? 'Not required for local Ollama'
              : 'nvapi-... / sk-...'
          }
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-brand-500"
        />
      </div>

      {/* Model Selector & Discovery */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="font-semibold text-slate-200">Active Conversational Model</label>
          <button
            type="button"
            onClick={handleFetchModels}
            disabled={!apiKey || isLoadingModels}
            className="text-brand-400 hover:text-brand-300 disabled:opacity-40 flex items-center gap-1 font-medium"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
            <span>{isLoadingModels ? 'Discovering...' : 'Query Live Chat Models'}</span>
          </button>
        </div>

        {models.length > 0 ? (
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-brand-500"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} ({Math.round(m.contextLength / 1000)}k ctx{m.supportsTools ? ' · tool-capable' : ''})
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            placeholder="meta/llama-3.3-70b-instruct"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-brand-500"
          />
        )}
        <p className="text-[10px] text-slate-400">
          Selected model must be a chat/instruct model (e.g. meta/llama-3.3-70b-instruct or mistralai/mixtral-8x7b-instruct-v0.1).
        </p>
      </div>

      {/* Web Search Configuration */}
      <div className="border-t border-slate-800 pt-4 space-y-3">
        <div className="font-semibold text-slate-200 flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5 text-brand-400" />
          <span>Live Web Search API (Optional)</span>
        </div>

        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="searchProvider"
              value="brave"
              checked={searchProvider === 'brave'}
              onChange={() => setSearchProvider('brave')}
              className="text-brand-500 bg-slate-800"
            />
            <span>Brave Search API</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="searchProvider"
              value="serper"
              checked={searchProvider === 'serper'}
              onChange={() => setSearchProvider('serper')}
              className="text-brand-500 bg-slate-800"
            />
            <span>Serper (Google Search)</span>
          </label>
        </div>

        <input
          type="password"
          value={searchApiKey}
          onChange={(e) => setSearchApiKey(e.target.value)}
          placeholder={`Enter ${searchProvider === 'brave' ? 'Brave Search API Key' : 'Serper API Key'}`}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-brand-500"
        />
      </div>

      {/* Worker & Sub-Agent Configuration */}
      <div className="border-t border-slate-800 pt-4 space-y-3">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>⚡ Worker & Sub-Agent Model (Secondary API Key)</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Worker sub-agents execute parallel background tab research concurrently (e.g. multi-site price scraping). By default, this uses NVIDIA NIM with a 2nd API key, or you can switch to Groq, OpenRouter, Gemini, or Cerebras for high-speed inference.
        </p>

        <div className="space-y-2">
          <label className="text-[11px] text-slate-400">Worker Provider</label>
          <select
            value={workerProviderId}
            onChange={(e) => setWorkerProviderId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-medium focus:outline-none focus:border-brand-500"
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] text-slate-400">Worker API Key (Optional — defaults to Primary Key if empty)</label>
          <input
            type="password"
            value={workerApiKey}
            onChange={(e) => setWorkerApiKey(e.target.value)}
            placeholder="Enter 2nd API key (e.g. 2nd NVIDIA NIM key, Groq key, etc.)"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] text-slate-400">Worker Model ID</label>
          <input
            type="text"
            value={workerModelId}
            onChange={(e) => setWorkerModelId(e.target.value)}
            placeholder="e.g. meta/llama-3.1-8b-instruct or meta/llama-3.3-70b-instruct"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Cost Ceilings */}
      <div className="border-t border-slate-800 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-slate-200 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-brand-400" />
            <span>Hard Token & Cost Ceilings</span>
          </div>
          <button
            type="button"
            onClick={async () => {
              await resetDailyCounters();
              alert("Today's token and cost counters have been reset to zero.");
            }}
            className="text-[11px] text-brand-400 hover:text-brand-300 underline font-mono"
          >
            Reset Today's Usage
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div>
            <label className="text-[10px] text-slate-400">Per-Task Tokens</label>
            <input
              type="number"
              value={costLimits.perTaskTokens}
              onChange={(e) => setCostLimits({ ...costLimits, perTaskTokens: Number(e.target.value) })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 font-mono text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-400">Daily Tokens</label>
            <input
              type="number"
              value={costLimits.perDayTokens}
              onChange={(e) => setCostLimits({ ...costLimits, perDayTokens: Number(e.target.value) })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 font-mono text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-400">Daily USD ($)</label>
            <input
              type="number"
              step="0.5"
              value={costLimits.perDayUsd}
              onChange={(e) => setCostLimits({ ...costLimits, perDayUsd: Number(e.target.value) })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 font-mono text-xs"
            />
          </div>
        </div>
      </div>

      {/* Desktop Bridge (NIM JARVIS Partner) */}
      <div className="border-t border-slate-800 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-slate-200 flex items-center gap-1.5">
            <Monitor className="w-3.5 h-3.5 text-brand-400" />
            <span>NIM JARVIS Desktop Bridge</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-mono">
            <span className={`w-2 h-2 rounded-full ${bridgeState === 'connected' ? 'bg-emerald-400 animate-pulse' : bridgeState === 'connecting' ? 'bg-amber-400' : 'bg-slate-600'}`} />
            <span className={bridgeState === 'connected' ? 'text-emerald-400 font-semibold' : bridgeState === 'connecting' ? 'text-amber-400' : 'text-slate-400'}>
              {bridgeState === 'connected' ? 'Connected' : bridgeState === 'connecting' ? 'Connecting...' : 'Disconnected'}
            </span>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Connect with the local <strong>NIM JARVIS Desktop</strong> agent to collaborate on native OS workflows, file transformations, and delegated research.
        </p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-slate-400">Enable Desktop Bridge</label>
            <input
              type="checkbox"
              checked={bridgeConfig.enabled}
              onChange={(e) => setBridgeConfig({ ...bridgeConfig, enabled: e.target.checked })}
              className="rounded bg-slate-950 border-slate-700 text-brand-500 focus:ring-0"
            />
          </div>

          {bridgeConfig.enabled && (
            <div className="space-y-2 pt-1">
              <div>
                <label className="text-[10px] text-slate-400">Desktop WebSocket URL</label>
                <input
                  type="text"
                  value={bridgeConfig.serverUrl}
                  onChange={(e) => setBridgeConfig({ ...bridgeConfig, serverUrl: e.target.value })}
                  placeholder="ws://127.0.0.1:7432"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:border-brand-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400">Pairing Auth Token (from <code>/bridge</code> in Desktop CLI)</label>
                <input
                  type="password"
                  value={bridgeConfig.authToken}
                  onChange={(e) => setBridgeConfig({ ...bridgeConfig, authToken: e.target.value })}
                  placeholder="nim_pair_..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:border-brand-500"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    void chrome.storage.local.set({ desktopBridgeConfig: bridgeConfig });
                    desktopBridge.connect(bridgeConfig.serverUrl, bridgeConfig.authToken);
                  }}
                  className="flex-1 py-1.5 bg-brand-700 hover:bg-brand-600 text-white rounded-lg text-xs font-medium transition"
                >
                  {bridgeState === 'connected' ? 'Reconnect Bridge' : 'Connect to Desktop'}
                </button>
                {bridgeState === 'connected' && (
                  <button
                    type="button"
                    onClick={() => desktopBridge.disconnect()}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save Button */}
      <button
        type="submit"
        className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-xl flex items-center justify-center gap-1.5 transition shadow-lg shadow-brand-900/30 text-sm"
      >
        {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saveSuccess ? 'Settings Saved Successfully' : 'Save Configuration'}
      </button>
    </form>
  );
};
