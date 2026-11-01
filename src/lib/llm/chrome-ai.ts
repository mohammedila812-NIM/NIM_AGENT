/**
 * Chrome Built-in AI (Gemini Nano) On-Device Prompt API
 * Enables zero-cost, zero-latency local execution of background intelligence tasks
 * (such as knowledge graph entity extraction and quarantine scanning).
 */

interface ChromeAICapabilities {
  available: 'readily' | 'after-download' | 'no';
  defaultTemperature?: number;
  defaultTopK?: number;
  maxTopK?: number;
}

interface ChromeAILanguageModel {
  capabilities: () => Promise<ChromeAICapabilities>;
  create: (options?: { systemPrompt?: string; temperature?: number; topK?: number }) => Promise<{
    prompt: (text: string) => Promise<string>;
    promptStreaming?: (text: string) => ReadableStream<string>;
    destroy: () => void;
  }>;
}

interface WindowWithAI extends Window {
  ai?: {
    languageModel?: ChromeAILanguageModel;
  };
  LanguageModel?: any;
}

/**
 * Checks whether Chrome's on-device Gemini Nano is readily available for local inference.
 */
export async function isChromeAIAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as WindowWithAI;

  try {
    if (win.ai?.languageModel) {
      const caps = await win.ai.languageModel.capabilities();
      return caps.available === 'readily';
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Prompts on-device Gemini Nano with an optional system prompt and user content.
 * Returns the generated string, or null if on-device AI is unavailable or fails.
 */
export async function promptChromeAI(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as WindowWithAI;

  if (!win.ai?.languageModel) return null;

  let session: any = null;
  try {
    session = await win.ai.languageModel.create({
      systemPrompt,
      temperature: 0.2,
    });
    const result = await session.prompt(userPrompt);
    return result;
  } catch {
    return null;
  } finally {
    if (session && typeof session.destroy === 'function') {
      try {
        session.destroy();
      } catch {
        // ignore
      }
    }
  }
}
