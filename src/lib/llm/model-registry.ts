import type { ProviderConfig } from './types';
import { chatCompletion } from './client';

export interface DiscoveredModel {
  id: string;
  contextLength: number;
  supportsTools: boolean;
  supportsVision: boolean;
  isAgentTuned: boolean;
  providerLabel: string;
}

interface ModelsApiModel {
  id: string;
  context_window?: number;
  capabilities?: {
    vision?: boolean;
    function_calling?: boolean;
  };
}

/** Filter out non-chat models (embeddings, rerankers, vision-only encoders, etc.) */
export function isChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (
    lower.includes('embed') ||
    lower.includes('rerank') ||
    lower.includes('clip') ||
    lower.includes('reward') ||
    lower.includes('guardrail') ||
    lower.includes('whisper') ||
    lower.includes('tts') ||
    lower.includes('sdxl') ||
    lower.includes('stable-diffusion')
  ) {
    return false;
  }
  return true;
}

/**
 * Fetch available models from provider's /v1/models endpoint.
 * Zero hardcoded model IDs. Filters out non-chat models automatically.
 */
export async function discoverModels(config: ProviderConfig): Promise<DiscoveredModel[]> {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const res = await fetch(`${config.baseUrl}/models`, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch models (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as { data?: ModelsApiModel[] } | ModelsApiModel[];
  const rawList = Array.isArray(json) ? json : json.data ?? [];

  // Filter out non-chat models (embeddings, rerankers, etc.)
  const chatList = rawList.filter((m) => isChatModel(m.id));

  return chatList.map((m) => ({
    id: m.id,
    contextLength: m.context_window ?? inferContextLength(m.id),
    supportsTools: m.capabilities?.function_calling ?? inferToolSupport(m.id),
    supportsVision: m.capabilities?.vision ?? inferVisionSupport(m.id),
    isAgentTuned: inferAgentTuned(m.id),
    providerLabel: config.label,
  }));
}

/**
 * Live capability probe — sends a minimal tool-call request.
 */
export async function probeToolCapability(
  modelId: string,
  config: ProviderConfig,
): Promise<boolean> {
  if (!isChatModel(modelId)) return false;
  try {
    const res = await chatCompletion(config, {
      model: modelId,
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'calculate',
            description: 'Return numeric answer',
            parameters: {
              type: 'object',
              properties: { result: { type: 'number' } },
              required: ['result'],
            },
          },
        },
      ],
      tool_choice: 'auto',
      max_tokens: 50,
      temperature: 0,
    });
    return (res.choices[0]?.message?.tool_calls?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function inferContextLength(id: string): number {
  const lower = id.toLowerCase();
  if (lower.includes('2m') || lower.includes('gemini-1.5-pro')) return 2_000_000;
  if (lower.includes('1m') || lower.includes('1000k') || lower.includes('gemini') || lower.includes('glm-5') || lower.includes('nemotron-3')) return 1_000_000;
  if (lower.includes('200k') || lower.includes('claude-3-5') || lower.includes('claude-3-7') || lower.includes('claude-3')) return 200_000;
  if (lower.includes('128k') || lower.includes('llama-3') || lower.includes('llama3') || lower.includes('qwen2.5') || lower.includes('deepseek-r1') || lower.includes('deepseek-v3') || lower.includes('mistral-large')) return 128_000;
  if (lower.includes('64k') || lower.includes('deepseek')) return 64_000;
  if (lower.includes('32k') || lower.includes('mistral') || lower.includes('mixtral') || lower.includes('phi-4')) return 32_768;
  return 32_768;
}

function inferToolSupport(id: string): boolean {
  return /instruct|chat|tool|agent|nemotron|function|glm|qwen|gemini|claude|gpt/i.test(id);
}

function inferVisionSupport(id: string): boolean {
  return /vision|vl|visual|llava|pixtral|qwen.*vl|gemini|claude|gpt-4o/i.test(id);
}

function inferAgentTuned(id: string): boolean {
  return /instruct|agent|nemotron|tool|glm|chat|gemini|claude|deepseek/i.test(id);
}

/** Sort models for display: agent-tuned first, then by context length desc. */
export function sortModelsForDisplay(models: DiscoveredModel[]): DiscoveredModel[] {
  return [...models].sort((a, b) => {
    // Prioritize popular flagship models at top
    const aIsFlagship = /gemini-2\.0-flash|gemini-1\.5-flash|llama-3\.3|llama-3\.1-70b|nemotron-4-340b|mixtral|qwen2\.5-72b/i.test(a.id);
    const bIsFlagship = /gemini-2\.0-flash|gemini-1\.5-flash|llama-3\.3|llama-3\.1-70b|nemotron-4-340b|mixtral|qwen2\.5-72b/i.test(b.id);
    if (aIsFlagship !== bIsFlagship) return aIsFlagship ? -1 : 1;

    if (a.isAgentTuned !== b.isAgentTuned) return a.isAgentTuned ? -1 : 1;
    return b.contextLength - a.contextLength;
  });
}
