import { z } from 'zod';

export type AgentActionType =
  | 'click_element'
  | 'type_text'
  | 'select_option'
  | 'press_key'
  | 'wait_for'
  | 'navigate_to'
  | 'web_search'
  | 'read_page'
  | 'screenshot'
  | 'scroll_page'
  | 'summarize'
  | 'list_tabs'
  | 'switch_tab'
  | 'close_tab'
  | 'extract_table'
  | 'parallel_research'
  | 'recall_session_history'
  | 'fill_form'
  | 'export_data'
  | 'eval_page_script'
  | 'scratchpad_write'
  | 'scratchpad_read'
  | 'create_watch'
  | 'list_watches'
  | 'delete_watch'
  | 'workspace_create_file'
  | 'workspace_append_file'
  | 'workspace_read_file'
  | 'workspace_list_files'
  | 'workspace_delete_file'
  | 'workspace_search'
  | 'observe_page'
  | 'act_on_element'
  | 'extract_data'
  | 'knowledge_graph_query'
  | 'knowledge_graph_add'
  | 'knowledge_graph_relate'
  | 'swarm_research'
  | 'visual_inspect'
  | 'auto_advance_media'
  | 'bypass_annoyances'
  | 'clone_page_markdown'
  | 'watch_page_changes'
  | 'inspect_element'
  | 'read_console'
  | 'read_network'
  | 'read_storage'
  | 'get_ax_tree'
  | 'edit_element'
  | 'edit_styles'
  | 'live_edit_script'
  | 'mock_request'
  | 'run_in_page'
  | 'trusted_click'
  | 'trusted_type'
  | 'undo_devtools_edit'
  | 'devtools_status'
  | 'devtools_detach'
  | 'delegate_to_specialist'
  | 'check_specialist'
  | 'await_specialist'
  | 'cancel_specialist'
  | 'rollback_specialist_edits';


export interface AgentAction {
  type: AgentActionType;
  target?: string;
  value?: string;
  url?: string;
  query?: string;
  direction?: 'up' | 'down' | 'to_element';
  pixels?: number;
  reason?: string;
  focus?: string;
  markAsKeyFinding?: boolean;
  [key: string]: unknown;
}

// Schemas for extension messages
export const ConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

const AgentStartSchema = z.object({
  type: z.literal('AGENT_START'),
  taskId: z.string(),
  instruction: z.string(),
  modelId: z.string().optional(),
  visionOptIn: z.boolean().optional(),
  conversationHistory: z.array(ConversationTurnSchema).optional(),
});

const AgentStopSchema = z.object({
  type: z.literal('AGENT_STOP'),
  taskId: z.string(),
});

const HITLResponseSchema = z.object({
  type: z.literal('HITL_RESPONSE'),
  taskId: z.string(),
  approved: z.boolean(),
});

const PlanApprovalSchema = z.object({
  type: z.literal('PLAN_APPROVAL'),
  taskId: z.string(),
  approved: z.boolean(),
});

const HeartbeatSchema = z.object({
  type: z.literal('HEARTBEAT'),
});

const PingSchema = z.object({
  type: z.literal('PING'),
});

const PongSchema = z.object({
  type: z.literal('PONG'),
});

const StreamChunkSchema = z.object({
  type: z.literal('STREAM_CHUNK'),
  taskId: z.string(),
  chunk: z.string(),
});

const StreamDoneSchema = z.object({
  type: z.literal('STREAM_DONE'),
  taskId: z.string(),
  finalResult: z.string().optional(),
});

const TaskStatusSchema = z.object({
  type: z.literal('TASK_STATUS'),
  taskId: z.string(),
  status: z.enum(['running', 'paused', 'done', 'error', 'hitl_waiting', 'plan_preview']),
  detail: z.string().optional(),
});

const TaskResumingSchema = z.object({
  type: z.literal('TASK_RESUMING'),
  taskId: z.string(),
  fromStep: z.number(),
});

const AgentActionSchema = z.object({
  type: z.literal('AGENT_ACTION'),
  taskId: z.string(),
  action: z.record(z.unknown()),
});

const InjectionWarningSchema = z.object({
  type: z.literal('INJECTION_WARNING'),
  taskId: z.string(),
  url: z.string(),
  snippet: z.string(),
});

const CostUpdateSchema = z.object({
  type: z.literal('COST_UPDATE'),
  taskId: z.string(),
  taskTokens: z.number(),
  dayTokens: z.number(),
  dayUsd: z.number(),
});

const AgentStepSchema = z.object({
  type: z.literal('AGENT_STEP'),
  taskId: z.string(),
  stepNumber: z.number(),
  tool: z.string().optional(),
  args: z.record(z.unknown()).optional(),
  reasoning: z.string().optional(),
  status: z.enum(['running', 'done', 'error']),
  result: z.string().optional(),
});

const MacroSaveSchema = z.object({
  type: z.literal('MACRO_SAVE'),
  taskId: z.string(),
  name: z.string(),
});

const UndoActionSchema = z.object({
  type: z.literal('UNDO_ACTION'),
  taskId: z.string(),
  actionIndex: z.number(),
});

const KeyFinderSchema = z.object({
  type: z.literal('MARK_KEY_FINDING'),
  taskId: z.string(),
  messageIndex: z.number(),
});

const AgentResumeSchema = z.object({
  type: z.literal('AGENT_RESUME'),
  taskId: z.string(),
});

const SubagentHITLRequestSchema = z.object({
  type: z.literal('SUBAGENT_HITL_REQUEST'),
  taskId: z.string(),
  action: z.record(z.unknown()),
  reason: z.string(),
});

const SubagentHITLResponseSchema = z.object({
  type: z.literal('SUBAGENT_HITL_RESPONSE'),
  taskId: z.string(),
  approved: z.boolean(),
});

const BridgeConnectSchema = z.object({
  type: z.literal('BRIDGE_CONNECT'),
  payload: z.object({
    url: z.string(),
    authToken: z.string(),
  }),
});

const BridgeDisconnectSchema = z.object({
  type: z.literal('BRIDGE_DISCONNECT'),
});

const BridgeGetStateSchema = z.object({
  type: z.literal('BRIDGE_GET_STATE'),
});

const BridgeStateChangedSchema = z.object({
  type: z.literal('BRIDGE_STATE_CHANGED'),
  state: z.enum(['disconnected', 'connecting', 'connected', 'error']),
});

const PageChangeDetectedSchema = z.object({
  type: z.literal('PAGE_CHANGE_DETECTED'),
  target: z.string(),
  summary: z.string(),
  actionOnDetect: z.enum(['ask', 'auto_act', 'notify']).optional(),
  autonomousInstruction: z.string().optional(),
  url: z.string().optional(),
  timestamp: z.number().optional(),
  tabId: z.number().optional(),
});

const SentinelTriggerActionSchema = z.object({
  type: z.literal('SENTINEL_TRIGGER_ACTION'),
  instruction: z.string(),
  changeSummary: z.string().optional(),
  tabId: z.number().optional(),
});

const DevToolsKillSwitchSchema = z.object({
  type: z.literal('DEVTOOLS_KILL_SWITCH'),
});

export const MessageSchema = z.discriminatedUnion('type', [
  AgentStartSchema,
  AgentStopSchema,
  AgentResumeSchema,
  HITLResponseSchema,
  SubagentHITLRequestSchema,
  SubagentHITLResponseSchema,
  PlanApprovalSchema,
  HeartbeatSchema,
  PingSchema,
  PongSchema,
  DevToolsKillSwitchSchema,
  StreamChunkSchema,
  StreamDoneSchema,
  TaskStatusSchema,
  TaskResumingSchema,
  AgentActionSchema,
  InjectionWarningSchema,
  CostUpdateSchema,
  AgentStepSchema,
  MacroSaveSchema,
  UndoActionSchema,
  KeyFinderSchema,
  BridgeConnectSchema,
  BridgeDisconnectSchema,
  BridgeGetStateSchema,
  BridgeStateChangedSchema,
  PageChangeDetectedSchema,
  SentinelTriggerActionSchema,
]);

export type ExtensionMessage = z.infer<typeof MessageSchema>;

/** Returns true only if message matches a known schema. Validated before processing. */
export function isValidMessage(msg: unknown): msg is ExtensionMessage {
  return MessageSchema.safeParse(msg).success;
}
