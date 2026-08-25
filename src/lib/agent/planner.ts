import { chatCompletion } from '../llm/client';
import type { ProviderConfig } from '../llm/types';

export interface PlanStep {
  stepNumber: number;
  description: string;
  expectedTool: string;
}

export interface TaskPlan {
  taskId: string;
  goal: string;
  steps: PlanStep[];
  estimatedScopeDomains: string[];
}

const PLANNER_SYSTEM = `You are a high-level task planning agent for browser automation and research.
Given a user goal, break it down into 3-7 clear, logical steps.
Return ONLY valid JSON matching this schema:
{
  "goal": string,
  "estimatedScopeDomains": string[],
  "steps": [
    { "stepNumber": number, "description": string, "expectedTool": "web_search" | "navigate_to" | "read_page" | "click_element" | "type_text" | "summarize" }
  ]
}`;

export async function generatePlanPreview(
  taskId: string,
  instruction: string,
  config: ProviderConfig,
  modelId: string,
): Promise<TaskPlan> {
  const res = await chatCompletion(config, {
    model: modelId,
    messages: [
      { role: 'system', content: PLANNER_SYSTEM },
      { role: 'user', content: `Create a browser execution plan for:\n"${instruction}"` },
    ],
    temperature: 0.1,
    max_tokens: 1000,
  });

  const text = res.choices[0]?.message?.content ?? '{}';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
    return {
      taskId,
      goal: parsed.goal ?? instruction,
      steps: parsed.steps ?? [{ stepNumber: 1, description: instruction, expectedTool: 'navigate_to' }],
      estimatedScopeDomains: parsed.estimatedScopeDomains ?? [],
    };
  } catch {
    return {
      taskId,
      goal: instruction,
      steps: [{ stepNumber: 1, description: instruction, expectedTool: 'navigate_to' }],
      estimatedScopeDomains: [],
    };
  }
}
