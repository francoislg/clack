import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { Config } from "../config.js";
import type { ChangeSession } from "../changes/types.js";

// ============================================================================
// Tool Context
// ============================================================================

export interface ToolContext {
  /** Slack user ID */
  userId: string;
  /** Resolved user role */
  role: UserRole;
  /** Current Q&A session */
  session: SessionContext;
  /** Full app configuration */
  config: Config;
  /** Whether the changes workflow is enabled for this trigger */
  changesWorkflowEnabled: boolean;
  /** Active change session in the current thread (if any) */
  changeSession?: ChangeSession;
}

// ============================================================================
// Staged Intents
// ============================================================================

export type StagedIntentType =
  | "change"
  | "config_update"
  | "review"
  | "merge"
  | "update"
  | "close";

export interface StagedChangeIntent {
  type: "change";
  branch: string;
  description: string;
  repo: string;
  existingWorktree?: {
    status: string;
    lastActivity: string;
  };
}

export interface StagedConfigUpdateIntent {
  type: "config_update";
  file: string;
  content: string;
}

export interface StagedReviewIntent {
  type: "review";
  sessionId: string;
  prUrl: string;
}

export interface StagedMergeIntent {
  type: "merge";
  sessionId: string;
  prUrl: string;
}

export interface StagedUpdateIntent {
  type: "update";
  sessionId: string;
  instructions: string;
}

export interface StagedCloseIntent {
  type: "close";
  sessionId: string;
  prUrl: string;
}

export type StagedIntent =
  | StagedChangeIntent
  | StagedConfigUpdateIntent
  | StagedReviewIntent
  | StagedMergeIntent
  | StagedUpdateIntent
  | StagedCloseIntent;

// ============================================================================
// submit_response Payload
// ============================================================================

export interface ResponseSection {
  title?: string;
  body: string;
}

// Terminal actions
export interface AcceptAction {
  type: "accept";
  label?: string;
}

export interface RejectAction {
  type: "reject";
  label?: string;
}

export interface EditAction {
  type: "edit";
  label?: string;
}

// Continuation actions
export interface RefineAction {
  type: "refine";
  label?: string;
  hint?: string;
}

export interface FollowupAction {
  type: "followup";
  label: string;
  prompt: string;
}

export interface ChoiceAction {
  type: "choice";
  label: string;
  value: string;
  description?: string;
}

// Ref-based actions (reference staged intents)
export interface ChangeAction {
  type: "change";
  ref: string;
  label?: string;
  auto?: boolean;
}

export interface ConfigUpdateAction {
  type: "config_update";
  ref: string;
  label?: string;
}

export interface ReviewAction {
  type: "review";
  ref: string;
  label?: string;
  auto?: boolean;
}

export interface MergeAction {
  type: "merge";
  ref: string;
  label?: string;
  auto?: boolean;
}

export interface UpdateAction {
  type: "update";
  ref: string;
  label?: string;
  auto?: boolean;
}

export interface CloseAction {
  type: "close";
  ref: string;
  label?: string;
  auto?: boolean;
}

export type Action =
  | AcceptAction
  | RejectAction
  | EditAction
  | RefineAction
  | FollowupAction
  | ChoiceAction
  | ChangeAction
  | ConfigUpdateAction
  | ReviewAction
  | MergeAction
  | UpdateAction
  | CloseAction;

export type ActionType = Action["type"];

export interface SubmitResponsePayload {
  sections: ResponseSection[];
  actions: Action[];
}

// ============================================================================
// Tool Call Record (for session persistence)
// ============================================================================

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  timestamp: number;
}

export interface ContinuationRecord {
  actionType: "choice" | "followup" | "refine";
  userInput: string;
  timestamp: number;
}

// ============================================================================
// Tool Server Result
// ============================================================================

export interface ClackToolsResult {
  mcpServer: unknown; // McpSdkServerConfigWithInstance - avoid importing SDK types
  toolNames: string[];
  getResult: () => SubmitResponsePayload | null;
  getRenderedBlocks: () => Record<string, unknown>[] | null;
  getStagedIntents: () => Map<string, StagedIntent>;
  getToolCallHistory: () => ToolCallRecord[];
}
