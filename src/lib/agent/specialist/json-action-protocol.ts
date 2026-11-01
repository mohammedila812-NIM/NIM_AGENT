/**
 * Strict JSON Action Protocol & Reasoning Tag Stripper
 *
 * For non-tool-calling models (or models without reliable native function calling),
 * parses actions formatted as {"tool": "...", "args": {...}} or final report {"final": {...}}.
 * Strips <think>...</think> blocks from DeepSeek R1 and reasoning models before processing.
 */

import { z } from 'zod';
import { SpecialistReportSchema, validateSpecialistReport, type SpecialistReport } from './types';

// ── Stripping Reasoning Blocks ───────────────────────────────────────────────

/**
 * Strips <think>...</think> or other reasoning scratchpad blocks from model output.
 * Ensures internal chain-of-thought is never stored, logged, or returned to the main LLM.
 */
export function stripThinkingBlocks(content: string): string {
  if (!content) return '';
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '')
    .trim();
}

// ── JSON Action Protocol Schema ──────────────────────────────────────────────

export const JsonToolActionSchema = z.object({
  tool: z.string(),
  args: z.record(z.unknown()).default({}),
});
export type JsonToolAction = z.infer<typeof JsonToolActionSchema>;

export const JsonFinalActionSchema = z.object({
  final: SpecialistReportSchema,
});
export type JsonFinalAction = z.infer<typeof JsonFinalActionSchema>;

export type ParsedSpecialistAction =
  | { type: 'tool'; action: JsonToolAction }
  | { type: 'final'; report: SpecialistReport }
  | { type: 'invalid'; raw: string; error: string };

/**
 * Extracts the first valid JSON block from raw text.
 */
function extractJsonBlock(text: string): string | null {
  const trimmed = text.trim();
  // Markdown code block ```json ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }

  // Raw outermost { ... }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

/**
 * Parses model output according to the strict JSON action protocol.
 */
export function parseSpecialistAction(rawContent: string): ParsedSpecialistAction {
  const cleaned = stripThinkingBlocks(rawContent);
  const jsonStr = extractJsonBlock(cleaned);

  if (!jsonStr) {
    const trimmed = cleaned.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('{')) {
      return {
        type: 'final',
        report: validateSpecialistReport({ summary: trimmed }),
      };
    }
    return {
      type: 'invalid',
      raw: rawContent,
      error: 'No valid JSON block detected. Output must be {"tool": "...", "args": {...}} or {"final": {...}}',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    return {
      type: 'invalid',
      raw: rawContent,
      error: `JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const rawObj = parsed as Record<string, unknown>;
    if (!rawObj.tool && (rawObj.action || rawObj.name)) {
      rawObj.tool = rawObj.action || rawObj.name;
      rawObj.args = rawObj.args || rawObj.parameters || {};
    }
  }

  // 1. Check if it's a tool action
  const toolParse = JsonToolActionSchema.safeParse(parsed);
  if (toolParse.success && toolParse.data.tool !== 'final') {
    return { type: 'tool', action: toolParse.data };
  }

  // 2. Check if wrapped in {"final": ...}
  const finalWrapParse = JsonFinalActionSchema.safeParse(parsed);
  if (finalWrapParse.success) {
    return { type: 'final', report: finalWrapParse.data.final };
  }

  // 3. Check if root object contains summary or is a SpecialistReport
  if (typeof parsed === 'object' && parsed !== null && 'summary' in (parsed as Record<string, unknown>)) {
    return { type: 'final', report: validateSpecialistReport(parsed) };
  }

  return {
    type: 'invalid',
    raw: rawContent,
    error: 'JSON structure matches neither {"tool": "...", "args": {...}} nor {"final": {...}}',
  };
}
