import { chatCompletion } from '../../llm/client';
import type { ProviderConfig } from '../../llm/types';

export async function summarizeContent(
  content: string,
  focus: string | undefined,
  config: ProviderConfig,
  modelId: string,
): Promise<string> {
  const prompt = focus
    ? `Summarize the following content, focusing specifically on: ${focus}.\nPreserve key data, findings, and facts.\n\n${content}`
    : `Summarize the following content concisely, preserving all key facts, findings, and findings.\n\n${content}`;

  const res = await chatCompletion(config, {
    model: modelId,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 1000,
  });

  return res.choices[0]?.message?.content ?? '';
}
