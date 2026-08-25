import type { ProviderConfig } from './types';

export type ProviderPreset = Omit<ProviderConfig, 'apiKey' | 'defaultModel'>;

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'nim-cloud',
    label: 'NVIDIA NIM (cloud)',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  {
    id: 'nim-local',
    label: 'NVIDIA NIM (self-hosted — private)',
    baseUrl: 'http://localhost:8000/v1',
  },
  {
    id: 'gemini',
    label: 'Google AI Studio (Gemini API)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'groq',
    label: 'Groq (fast inference)',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  {
    id: 'ollama',
    label: 'Ollama (local — private)',
    baseUrl: 'http://localhost:11434/v1',
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    baseUrl: '',
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
