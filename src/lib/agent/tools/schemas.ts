import { z } from 'zod';

export const ClickSchema = z.object({
  tool: z.literal('click_element'),
  target: z.string().min(1, 'target must not be empty'),
  description: z.string().optional(),
});

export const TypeSchema = z.object({
  tool: z.literal('type_text'),
  target: z.string().min(1, 'target must not be empty'),
  value: z.string(),
});

export const SelectOptionSchema = z.object({
  tool: z.literal('select_option'),
  target: z.string().min(1, 'target must not be empty'),
  option: z.string().min(1, 'option value or label must not be empty'),
});

export const PressKeySchema = z.object({
  tool: z.literal('press_key'),
  key: z.string().min(1, 'key must not be empty (e.g. Enter, Tab, Escape, ArrowDown)'),
  target: z.string().optional(),
});

export const WaitForSchema = z.object({
  tool: z.literal('wait_for'),
  selector: z.string().min(1, 'selector must not be empty'),
  state: z.enum(['visible', 'hidden']).optional(),
  timeoutMs: z.number().int().positive().max(30000).optional(),
});

export const NavigateSchema = z.object({
  tool: z.literal('navigate_to'),
  url: z.string().url('url must be a valid URL'),
  newTab: z.boolean().optional(),
});

export const WebSearchSchema = z.object({
  tool: z.literal('web_search'),
  query: z.string().min(1).max(500, 'query too long'),
  maxResults: z.number().int().min(1).max(10).optional(),
});

export const ReadPageSchema = z.object({
  tool: z.literal('read_page'),
  focusSelector: z.string().optional(),
});

export const ScreenshotSchema = z.object({
  tool: z.literal('screenshot'),
  reason: z.string().min(1, 'must explain why DOM extraction was insufficient'),
});

export const ScrollSchema = z.object({
  tool: z.literal('scroll_page'),
  direction: z.enum(['up', 'down', 'to_element']),
  pixels: z.number().positive().optional(),
  selector: z.string().optional(),
});

export const SummarizeSchema = z.object({
  tool: z.literal('summarize'),
  focus: z.string().optional(),
  markAsKeyFinding: z.boolean().optional(),
});

export const ListTabsSchema = z.object({
  tool: z.literal('list_tabs'),
});

export const SwitchTabSchema = z.object({
  tool: z.literal('switch_tab'),
  tabId: z.union([z.number(), z.string()]),
});

export const CloseTabSchema = z.object({
  tool: z.literal('close_tab'),
  tabId: z.number().optional(),
});

export const ExtractTableSchema = z.object({
  tool: z.literal('extract_table'),
  selector: z.string().optional(),
});

export const ParallelResearchSchema = z.object({
  tool: z.literal('parallel_research'),
  tasks: z.array(
    z.object({
      name: z.string().min(1, 'task name is required'),
      url: z.string().url('url must be a valid URL'),
      instruction: z.string().min(1, 'instruction is required'),
      maxSteps: z.number().int().min(1).max(15).optional(),
      mode: z.enum(['extract', 'interact']).optional(),
    }),
  ).min(1).max(5),
});

export const RecallSessionSchema = z.object({
  tool: z.literal('recall_session_history'),
  query: z.string().max(200).optional(),
  last_n: z.number().int().min(1).max(20).optional(),
});

export const FillFormSchema = z.object({
  tool: z.literal('fill_form'),
  fields: z.array(
    z.object({
      target: z.string().min(1, 'Target numeric ID, selector, or name required'),
      value: z.string(),
      type: z.enum(['text', 'select', 'checkbox', 'radio']).optional(),
    }),
  ).min(1, 'At least one field is required').max(25, 'Maximum 25 fields per batch'),
  submitAfter: z.boolean().optional(),
  submitTarget: z.string().optional(),
});

export const ExportDataSchema = z.object({
  tool: z.literal('export_data'),
  format: z.enum(['csv', 'json', 'md', 'txt']),
  filename: z.string().min(1).max(100),
  content: z.string().optional(),
  source: z.enum(['table', 'research_notes', 'raw']).optional(),
});

export const EvalPageScriptSchema = z.object({
  tool: z.literal('eval_page_script'),
  target: z.enum(['next_data', 'json_ld', 'nuxt_state', 'open_graph', 'custom']),
  customPath: z.string().max(100).optional(),
});

export const ScratchpadWriteSchema = z.object({
  tool: z.literal('scratchpad_write'),
  key: z.string().min(1).max(50),
  value: z.string().max(4000),
  notes: z.string().optional(),
});

export const ScratchpadReadSchema = z.object({
  tool: z.literal('scratchpad_read'),
  key: z.string().optional(),
});

export const CreateWatchSchema = z.object({
  tool: z.literal('create_watch'),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  type: z.enum(['element_text', 'price', 'dom_selector', 'macro', 'llm_condition']).default('price'),
  selector: z.string().optional(),
  conditionPrompt: z.string().optional(),
  intervalMinutes: z.number().int().min(1).max(1440).default(30),
});

export const ListWatchesSchema = z.object({
  tool: z.literal('list_watches'),
});

export const DeleteWatchSchema = z.object({
  tool: z.literal('delete_watch'),
  watchId: z.string().min(1),
});

export const ToolCallSchema = z.discriminatedUnion('tool', [
  ClickSchema,
  TypeSchema,
  SelectOptionSchema,
  PressKeySchema,
  WaitForSchema,
  NavigateSchema,
  WebSearchSchema,
  ReadPageSchema,
  ScreenshotSchema,
  ScrollSchema,
  SummarizeSchema,
  ListTabsSchema,
  SwitchTabSchema,
  CloseTabSchema,
  ExtractTableSchema,
  ParallelResearchSchema,
  RecallSessionSchema,
  FillFormSchema,
  ExportDataSchema,
  EvalPageScriptSchema,
  ScratchpadWriteSchema,
  ScratchpadReadSchema,
  CreateWatchSchema,
  ListWatchesSchema,
  DeleteWatchSchema,
]);

export type ValidatedToolCall = z.infer<typeof ToolCallSchema>;

export function validateToolCall(
  raw: unknown,
): { success: true; data: ValidatedToolCall } | { success: false; error: string } {
  const result = ToolCallSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  const errors = result.error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  return { success: false, error: errors };
}
