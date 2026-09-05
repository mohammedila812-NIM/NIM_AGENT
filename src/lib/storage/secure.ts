/**
 * API Key Storage — LOCAL PERSISTENCE MODEL
 *
 * Keys are stored in chrome.storage.local, which is:
 *  - Persisted across browser restarts (no need to re-enter after closing Chrome)
 *  - Sandboxed to this extension's process — other extensions/sites cannot read it
 *  - NOT encrypted — protection is Chrome's extension storage sandbox, not cryptography
 *
 * Do not describe this as "encrypted" in any user-facing copy.
 */

export interface ProviderKeys {
  llmApiKey: string;
  searchApiKey?: string;
  searchProvider?: 'brave' | 'serper';
}

/**
 * Save API keys for a provider to local storage.
 * Keys persist until explicitly cleared by the user or extension is removed.
 */
export async function saveProviderKeys(providerId: string, keys: ProviderKeys): Promise<void> {
  await chrome.storage.local.set({ [`keys:${providerId}`]: keys });
}

/**
 * Load API keys from local storage. Returns null if not set.
 */
export async function loadProviderKeys(providerId: string): Promise<ProviderKeys | null> {
  const result = await chrome.storage.local.get(`keys:${providerId}`);
  return (result[`keys:${providerId}`] as ProviderKeys | undefined) ?? null;
}

/** Remove keys for a provider (e.g. on sign-out / reset). */
export async function clearProviderKeys(providerId: string): Promise<void> {
  await chrome.storage.local.remove(`keys:${providerId}`);
}

/** Returns true if there are saved keys for this provider. */
export async function hasSessionKeys(providerId: string): Promise<boolean> {
  const keys = await loadProviderKeys(providerId);
  return keys !== null && keys.llmApiKey.trim().length > 0;
}

export interface WorkerConfig {
  providerId: string; // defaults to 'nim-cloud'
  apiKey: string;
  baseUrl?: string;
  modelId?: string;
}

/** Save worker/sub-agent configuration */
export async function saveWorkerConfig(config: WorkerConfig): Promise<void> {
  await chrome.storage.local.set({ workerConfig: config });
}

/** Load worker/sub-agent configuration */
export async function loadWorkerConfig(): Promise<WorkerConfig | null> {
  const result = await chrome.storage.local.get('workerConfig');
  return (result.workerConfig as WorkerConfig | undefined) ?? null;
}

export interface VoiceConfig {
  voiceApiKey?: string;
  provider?: 'gemini' | 'groq' | 'openai' | 'desktop' | 'auto';
}

/** Save dedicated voice transcription configuration */
export async function saveVoiceConfig(config: VoiceConfig): Promise<void> {
  await chrome.storage.local.set({ voiceConfig: config });
}

/** Load dedicated voice transcription configuration */
export async function loadVoiceConfig(): Promise<VoiceConfig | null> {
  const result = await chrome.storage.local.get('voiceConfig');
  return (result.voiceConfig as VoiceConfig | undefined) ?? null;
}

