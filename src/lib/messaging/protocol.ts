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
  | 'parallel_research';

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
const AgentStartSchema = z.object({
  type: z.literal('AGENT_START'),
  taskId: z.string(),
  instruction: z.string(),
  modelId: z.string().optional(),
  visionOptIn: z.boolean().optional(),
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
]);

export type ExtensionMessage = z.infer<typeof MessageSchema>;

/** Returns true only if message matches a known schema. Validated before processing. */
export function isValidMessage(msg: unknown): msg is ExtensionMessage {
  return MessageSchema.safeParse(msg).success;
}
