import { z } from 'zod';

export const ClickSchema = z.object({
  tool: z.literal('click_element'),
  target: z.string().min(1, 'target must not be empty'),
  description: z.string().optional(),
  coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const TypeSchema = z.object({
  tool: z.literal('type_text'),
  target: z.string().min(1, 'target must not be empty'),
  value: z.string(),
  submitWithEnter: z.boolean().optional(),
  mode: z.enum(['replace', 'append', 'prepend']).optional(),
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
  annotateWithMarks: z.boolean().optional(),
});

export const VisualInspectSchema = z.object({
  tool: z.literal('visual_inspect'),
  query: z.string().min(1, 'query describing what visual information to inspect'),
  targetElement: z.string().optional(),
});

export const AutoAdvanceMediaSchema = z.object({
  tool: z.literal('auto_advance_media'),
  action: z.enum(['start', 'stop', 'status']).default('start'),
  maxReels: z.number().int().min(1).max(200).optional(),
  scrollKey: z.enum(['ArrowDown', 'PageDown', 'scroll']).optional(),
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
  // intervalSeconds is the preferred field (use when user says "every 20 seconds").
  // intervalMinutes is a legacy fallback (use when user says "every 5 minutes").
  // If both are provided, intervalSeconds takes precedence.
  intervalSeconds: z.number().positive().max(86400).optional(),
  intervalMinutes: z.number().positive().max(1440).optional(),
});

export const ListWatchesSchema = z.object({
  tool: z.literal('list_watches'),
});

export const DeleteWatchSchema = z.object({
  tool: z.literal('delete_watch'),
  watchId: z.string().min(1),
});

export const WorkspaceCreateFileSchema = z.object({
  tool: z.literal('workspace_create_file'),
  path: z.string().min(1, 'path is required'),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  overwrite: z.boolean().optional(),
});

export const WorkspaceAppendFileSchema = z.object({
  tool: z.literal('workspace_append_file'),
  path: z.string().min(1, 'path is required'),
  text: z.string(),
});

export const WorkspaceReadFileSchema = z.object({
  tool: z.literal('workspace_read_file'),
  path: z.string().min(1, 'path is required'),
});

export const WorkspaceListFilesSchema = z.object({
  tool: z.literal('workspace_list_files'),
  directory: z.string().optional(),
  recursive: z.boolean().optional(),
});

export const WorkspaceDeleteFileSchema = z.object({
  tool: z.literal('workspace_delete_file'),
  path: z.string().min(1, 'path is required'),
  permanent: z.boolean().optional(),
});

export const WorkspaceSearchSchema = z.object({
  tool: z.literal('workspace_search'),
  query: z.string().min(1, 'query is required'),
});

export const ObservePageSchema = z.object({
  tool: z.literal('observe_page'),
  maxAffordances: z.number().int().min(1).max(150).optional(),
});

export const ActOnElementSchema = z.object({
  tool: z.literal('act_on_element'),
  action: z.enum(['click', 'type', 'select', 'press_key', 'scroll']),
  target: z.string().min(1, 'Target ID or selector is required'),
  value: z.string().optional(),
  option: z.string().optional(),
  key: z.string().optional(),
  direction: z.enum(['up', 'down', 'to_element']).optional(),
  submitWithEnter: z.boolean().optional(),
  coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const ExtractDataSchema = z.object({
  tool: z.literal('extract_data'),
  fields: z.array(z.string().min(1)).min(1, 'At least one field name is required'),
  containerSelector: z.string().optional(),
  maxItems: z.number().int().min(1).max(100).optional(),
});

export const KnowledgeGraphQuerySchema = z.object({
  tool: z.literal('knowledge_graph_query'),
  keyword: z.string().min(1, 'keyword must not be empty'),
  maxNodes: z.number().int().min(1).max(20).optional(),
});

export const KnowledgeGraphAddSchema = z.object({
  tool: z.literal('knowledge_graph_add'),
  label: z.string().min(1, 'label must not be empty'),
  type: z.enum(['product', 'person', 'organization', 'location', 'concept', 'price', 'date', 'stat', 'source', 'file', 'unknown']).optional(),
  attributes: z.record(z.string()).optional(),
  sourceUrl: z.string().optional(),
});

export const KnowledgeGraphRelateSchema = z.object({
  tool: z.literal('knowledge_graph_relate'),
  fromLabel: z.string().min(1),
  fromType: z.enum(['product', 'person', 'organization', 'location', 'concept', 'price', 'date', 'stat', 'source', 'file', 'unknown']).optional(),
  relation: z.string().min(1, 'relation must not be empty'),
  toLabel: z.string().min(1),
  toType: z.enum(['product', 'person', 'organization', 'location', 'concept', 'price', 'date', 'stat', 'source', 'file', 'unknown']).optional(),
});

export const SwarmResearchSchema = z.object({
  tool: z.literal('swarm_research'),
  topic: z.string().min(3, 'topic must describe what to research'),
  maxWorkers: z.number().int().min(1).max(4).optional(),
});

export const BypassAnnoyancesSchema = z.object({
  tool: z.literal('bypass_annoyances'),
});

export const ClonePageMarkdownSchema = z.object({
  tool: z.literal('clone_page_markdown'),
  includeLinks: z.boolean().optional(),
  saveToWorkspace: z.boolean().optional(),
});

export const WatchPageChangesSchema = z.object({
  tool: z.literal('watch_page_changes'),
  action: z.enum(['start', 'stop', 'status']).optional(),
  target: z.string().optional(),
  changeType: z.enum(['any', 'text', 'mutation', 'attribute', 'count']).optional(),
  condition: z.string().optional(),
  actionOnDetect: z.enum(['ask', 'auto_act', 'notify']).optional(),
  autonomousInstruction: z.string().optional(),
  allowSending: z.boolean().optional(),
  stopAfterChange: z.boolean().optional(),
  timeoutSeconds: z.number().int().min(5).max(86400).optional(),
});

export const InspectElementSchema = z.object({
  tool: z.literal('inspect_element'),
  selector: z.string().optional(),
  nodeId: z.number().int().optional(),
});

export const ReadConsoleSchema = z.object({
  tool: z.literal('read_console'),
  level: z.enum(['error', 'warning', 'log', 'all']).optional(),
});

export const ReadNetworkSchema = z.object({
  tool: z.literal('read_network'),
  includeResponseBody: z.boolean().optional(),
  filter: z.string().optional(),
});

export const ReadStorageSchema = z.object({
  tool: z.literal('read_storage'),
  type: z.enum(['localStorage', 'sessionStorage', 'cookies']),
});

export const GetAxTreeSchema = z.object({
  tool: z.literal('get_ax_tree'),
  maxDepth: z.number().int().min(1).max(10).optional(),
});

export const EditElementSchema = z.object({
  tool: z.literal('edit_element'),
  selector: z.string(),
  outerHTML: z.string().optional(),
  attributeName: z.string().optional(),
  attributeValue: z.string().optional(),
});

export const EditStylesSchema = z.object({
  tool: z.literal('edit_styles'),
  selector: z.string(),
  cssText: z.string(),
});

export const LiveEditScriptSchema = z.object({
  tool: z.literal('live_edit_script'),
  scriptId: z.string(),
  newSource: z.string(),
});

export const MockRequestSchema = z.object({
  tool: z.literal('mock_request'),
  urlPattern: z.string(),
  responseCode: z.number().int().optional(),
  responseBody: z.string().optional(),
});

export const RunInPageSchema = z.object({
  tool: z.literal('run_in_page'),
  expression: z.string(),
});

export const TrustedClickSchema = z.object({
  tool: z.literal('trusted_click'),
  x: z.number(),
  y: z.number(),
  clickLabel: z.string().optional(),
});

export const TrustedTypeSchema = z.object({
  tool: z.literal('trusted_type'),
  text: z.string(),
  fieldName: z.string().optional(),
});

export const UndoDevToolsEditSchema = z.object({
  tool: z.literal('undo_devtools_edit'),
});

export const DevToolsStatusSchema = z.object({
  tool: z.literal('devtools_status'),
});

export const DevToolsDetachSchema = z.object({
  tool: z.literal('devtools_detach'),
});

export const DelegateToSpecialistSchema = z.object({
  tool: z.literal('delegate_to_specialist'),
  role: z.enum(['coder', 'debugger', 'analyst']),
  goal: z.string(),
  context: z.string().optional(),
  maxTier: z.enum(['T0', 'T1', 'T2', 'T3']),
  maxSteps: z.number().int().min(1).max(20).optional(),
  mode: z.enum(['async', 'sync']).optional(),
});

export const CheckSpecialistSchema = z.object({
  tool: z.literal('check_specialist'),
  jobId: z.string(),
});

export const AwaitSpecialistSchema = z.object({
  tool: z.literal('await_specialist'),
  jobId: z.string(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
});

export const CancelSpecialistSchema = z.object({
  tool: z.literal('cancel_specialist'),
  jobId: z.string(),
});

export const RollbackSpecialistEditsSchema = z.object({
  tool: z.literal('rollback_specialist_edits'),
  jobId: z.string(),
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
  VisualInspectSchema,
  AutoAdvanceMediaSchema,
  BypassAnnoyancesSchema,
  ClonePageMarkdownSchema,
  WatchPageChangesSchema,
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
  WorkspaceCreateFileSchema,
  WorkspaceAppendFileSchema,
  WorkspaceReadFileSchema,
  WorkspaceListFilesSchema,
  WorkspaceDeleteFileSchema,
  WorkspaceSearchSchema,
  ObservePageSchema,
  ActOnElementSchema,
  ExtractDataSchema,
  KnowledgeGraphQuerySchema,
  KnowledgeGraphAddSchema,
  KnowledgeGraphRelateSchema,
  SwarmResearchSchema,
  InspectElementSchema,
  ReadConsoleSchema,
  ReadNetworkSchema,
  ReadStorageSchema,
  GetAxTreeSchema,
  EditElementSchema,
  EditStylesSchema,
  LiveEditScriptSchema,
  MockRequestSchema,
  RunInPageSchema,
  TrustedClickSchema,
  TrustedTypeSchema,
  UndoDevToolsEditSchema,
  DevToolsStatusSchema,
  DevToolsDetachSchema,
  DelegateToSpecialistSchema,
  CheckSpecialistSchema,
  AwaitSpecialistSchema,
  CancelSpecialistSchema,
  RollbackSpecialistEditsSchema,
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
