/**
 * AgentEngine Façade (Phase 3 Modular Architecture)
 *
 * Refactored into specialized controller modules:
 * - ReActLoopController: Manages step iteration, context compression, cost limits, and UI streaming.
 * - ToolDispatcher: Routes and executes validated tools with security guards.
 * - TriadCoordinator: Handles milestone planning, CAPTCHA mitigation, and self-healing validation.
 *
 * Preserves 100% backward-compatible public interface for background workers and UI panels.
 */

import type { ProviderConfig } from '../llm/types';
import type { DiscoveredModel } from '../llm/model-registry';
import type { ValidatedToolCall } from './tools';
import type { CostLimits } from './cost-guard';
import type { AgentCheckpoint } from './checkpoint';
import type { SearchConfig } from './tools/web-search';
import type { HistoryTurn } from './session-memory';
import type { MilestoneChecklist } from './triad/planner';
import { ReActLoopController } from './core/react-loop';

export interface AgentRunCallbacks {
  onStep?: (stepNumber: number, reasoning: string, toolCall?: ValidatedToolCall, result?: string) => void;
  onChunk?: (chunk: string) => void;
  onStatusChange?: (status: AgentCheckpoint['status'], detail?: string) => void;
  onHITLRequired?: (action: ValidatedToolCall, reason: string) => Promise<boolean>;
  /** Fired whenever the milestone checklist is created or updated */
  onPlanUpdate?: (checklist: MilestoneChecklist) => void;
}

export interface AgentEngineConfig {
  providerConfig: ProviderConfig;
  workerProviderConfig?: ProviderConfig;
  workerModel?: DiscoveredModel;
  searchConfig?: SearchConfig;
  model: DiscoveredModel;
  quarantineModelId?: string;
  maxIterations?: number;
  costLimits?: CostLimits;
  visionOptIn?: boolean;
  pinnedTabId?: number; // if set, all tool handlers target this tab
  isAutonomous?: boolean; // autonomous sentinel execution
  allowSending?: boolean; // allow outbound actions without HITL during autonomous execution
  initialHostname?: string; // if set, domain lock is enforced for navigate_to
  toolAllowlist?: string[]; // restrict which AGENT_TOOLS this engine may call
  conversationHistory?: HistoryTurn[]; // rolling cross-turn session history
  /** Enable Planner-Actor-Validator triad mode (Phase 2) */
  triadMode?: boolean;
}

export class AgentEngine {
  private loopController: ReActLoopController;

  constructor(
    taskId: string,
    instruction: string,
    config: AgentEngineConfig,
    callbacks: AgentRunCallbacks = {},
  ) {
    this.loopController = new ReActLoopController(taskId, instruction, config, callbacks);
  }

  public abort(): void {
    this.loopController.abort();
  }

  public get isAborted(): boolean {
    return this.loopController.getIsAborted();
  }

  public async run(initialCheckpoint?: AgentCheckpoint): Promise<string> {
    return this.loopController.run(initialCheckpoint);
  }
}
