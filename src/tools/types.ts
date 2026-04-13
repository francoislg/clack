import type { App } from "@slack/bolt";
import type { Block, KnownBlock } from "@slack/types";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { Config } from "../config.js";
import type { SlackImageFile, SlackFile } from "../slack/slackFileBase.js";

// ============================================================================
// Delivery
// ============================================================================

/** Callback for delivering a response to Slack (via streamer or fallback). */
export type DeliverFn = (opts: {
  markdownText: string;
  blocks?: (KnownBlock | Block)[];
  reactions?: string[];
}) => Promise<{ ok: true; ts?: string } | { ok: false; error: string }>;

// ============================================================================
// Tool Context (discriminated union)
// ============================================================================

/** Query context — used by askClaude() for Q&A and intent-based tools */
export interface QueryToolContext {
  mode: "query";
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
  /** Whether scheduled messages feature is enabled */
  allowScheduledMessages: boolean;
  /** Slack WebClient for API calls (absent in test/verify contexts) */
  slackClient?: App["client"];
  /** Delivery callback — when provided, submit_response delivers to Slack directly */
  deliver?: DeliverFn;
  /** Available Slack images (from triggering message + thread) keyed by file ID */
  availableImages?: Map<string, SlackImageFile>;
  /** Available Slack files (non-image: PDFs, text, etc.) keyed by file ID */
  availableFiles?: Map<string, SlackFile>;
}

/** Worker context — used by change execution and follow-up flows */
export interface WorkerToolContext {
  mode: "worker";
  /** Worktree directory path */
  worktreePath: string;
  /** Git branch name */
  branchName: string;
  /** Repository name */
  repoName: string;
  /** Repository URL (for auth) */
  repoUrl: string;
  /** Slack channel ID (for report_status) */
  channelId: string;
  /** Slack thread timestamp (for report_status) */
  threadTs: string;
  /** Change session ID (for state updates) */
  sessionId: string;
  /** Full app configuration */
  config: Config;
}

/** Discriminated union — the tool server accepts either context */
export type ToolBuildContext = QueryToolContext | WorkerToolContext;

// ============================================================================
// Staged Intents
// ============================================================================

export type StagedIntentType = "change" | "config_update" | "update" | "review" | "merge" | "close";

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

export interface StagedUpdateIntent {
  type: "update";
  sessionId: string;
  instructions: string;
}

export interface StagedReviewIntent {
  type: "review";
  sessionId: string;
  instructions: string;
}

export interface StagedMergeIntent {
  type: "merge";
  sessionId: string;
  instructions: string;
}

export interface StagedCloseIntent {
  type: "close";
  sessionId: string;
  instructions: string;
}

export type StagedIntent =
  | StagedChangeIntent
  | StagedConfigUpdateIntent
  | StagedUpdateIntent
  | StagedReviewIntent
  | StagedMergeIntent
  | StagedCloseIntent;

// ============================================================================
// submit_response Payload
// ============================================================================

export interface ResponseSection {
  title?: string;
  body: string;
}

/** Snapshot of a response, saved at delivery time for stable cross-posting */
export interface ResponseSnapshot {
  text: string;
  sections: ResponseSection[];
}

// Continuation actions
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
  workMode?: boolean;
}

// Cross-posting actions
export interface PostToAction {
  type: "post_to";
  label?: string;
  auto?: boolean;
  /** Explicit target channel (for posting to a different channel/thread than the default) */
  channel?: string;
  /** Explicit target thread timestamp. Omit for top-level channel post. */
  thread_ts?: string;
  /** The exact text to post. Each post_to action posts only its own content. */
  content: string;
  /** Internal: resolved content entry ID set by submit_response before delivery (not from Claude) */
  _snapshotId?: string;
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

export interface UpdateAction {
  type: "update";
  ref: string;
  label?: string;
  auto?: boolean;
}

export type Action =
  | FollowupAction
  | ChoiceAction
  | PostToAction
  | ChangeAction
  | ConfigUpdateAction
  | UpdateAction;

export type ActionType = Action["type"];

export interface SubmitResponsePayload {
  /** Conversational preamble shown to user but excluded from snapshots and post_to */
  message?: string;
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
  actionType: "choice" | "followup";
  userInput: string;
  timestamp: number;
}

// ============================================================================
// Tool Server Result
// ============================================================================

export interface ClackToolsResult {
  mcpServer: McpSdkServerConfigWithInstance;
  toolNames: string[];
  getResult: () => SubmitResponsePayload | null;
  getRenderedBlocks: () => Record<string, unknown>[] | null;
  getStagedIntents: () => Map<string, StagedIntent>;
  getToolCallHistory: () => ToolCallRecord[];
  isSkipped: () => boolean;
  isDisengaged: () => boolean;
}
