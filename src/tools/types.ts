import type { App } from "@slack/bolt";
import type { Block as SlackRawBlock, KnownBlock } from "@slack/types";
import type { SlackBlocks } from "../slack/blocks.js";
import type { Block } from "../slack/blockSchema.js";
import type {
  McpSdkServerConfigWithInstance,
  McpServerConfig,
  McpSetServersResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { Config } from "../config.js";
import type { McpServerManager } from "../claude/mcpServerManager.js";
import type { SkillsManager } from "../claude/skillsManager.js";
import type { SlackImageFile, SlackFile } from "../slack/slackFileBase.js";

// ============================================================================
// Query handle — shared mutable ref for the SDK Query object
// ============================================================================

/**
 * Function signature for the SDK's `Query.setMcpServers`. Extracted so tools and
 * tests can reference the contract without depending on the whole `Query` interface
 * (which is an AsyncGenerator — awkward to fake in tests).
 */
export type SetMcpServersFn = (
  servers: Record<string, McpServerConfig>,
) => Promise<McpSetServersResult>;

// ============================================================================
// Delivery
// ============================================================================

/** Callback for delivering a response to Slack (via streamer or fallback). */
export type DeliverFn = (opts: {
  blocks: (KnownBlock | SlackRawBlock)[];
  reactions?: string[];
  /**
   * When true, deliver as a top-level channel message (no `thread_ts`) instead of a thread
   * reply. Used when the response is an announcement-style post that should go to the channel
   * directly. The streamer message (if any) is deleted before posting to avoid cruft in the
   * thread.
   */
  postTopLevel?: boolean;
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
  /**
   * Fully-qualified MCP tool names (e.g., `mcp__trivia__submit_answers`) that must be called
   * during this run before `submit_response` will be accepted. Populated by callers like the
   * cron scheduler when a job declares `requiredTools`.
   */
  requiredTools?: string[];
  /**
   * Free-form skip conditions for a scheduled run. When non-empty on a `scheduled` trigger,
   * `submit_response` exposes the `skip_response` parameter so Claude can decline delivery.
   * Ignored for non-scheduled triggers.
   */
  skipConditions?: string;
  /**
   * Owns the session's MCP-server lifecycle — tracks session-start servers, attached
   * servers, the effective registry, and wraps every `setMcpServers` call so the
   * merge invariant is guaranteed. Populated by the session orchestrator and bound
   * to the SDK Query in `clackSession`'s `onQuery` callback. Absent in contexts
   * without dynamic attachment (worker mode).
   */
  mcpManager?: McpServerManager;
  /**
   * Owns the session's lazy skill-pack metadata and loaded-skill set. Populated by
   * the session orchestrator in query mode. Consumed by `list_skill_pack_skills`
   * and `load_skill`. Absent in worker mode.
   */
  skillsManager?: SkillsManager;
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
  /**
   * Detailed implementation plan built up during the Slack conversation.
   * Forwarded to the worker so it doesn't have to re-derive intent from
   * `description` alone. Optional — only set when the conversation contains
   * non-trivial plan detail (file list, strategy, edge cases).
   */
  plan?: string;
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
  /**
   * Verbatim user message that motivated this update. Forwarded to the worker
   * as social context so it understands these instructions are a *correction*
   * to its prior decisions — not a fresh request that conflicts with them.
   * Optional — recommended whenever the update reacts to user feedback.
   */
  userFeedback?: string;
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

/**
 * Snapshot of a response, saved at delivery time for stable cross-posting.
 * The `blocks` array is the canonical shareable payload (Slack Block Kit in
 * Clack's curated subset). `text` is a plain-string fallback used as the
 * `text:` parameter on `chat.postMessage` for notifications and accessibility.
 */
export interface ResponseSnapshot {
  text: string;
  blocks: Block[];
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
  /**
   * Shareable Block Kit payload posted when the user clicks the button. When
   * presenting multiple post_to options, each action carries only its own
   * option's blocks.
   */
  blocks: Block[];
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
  /**
   * Claude-authored Slack Block Kit blocks (curated subset validated by
   * BlockSchema in `src/slack/blockSchema.ts`). Rendered above by Clack
   * (prepended by the `message` preamble if present) and followed by
   * action-button blocks generated from `actions`.
   */
  blocks: Block[];
  actions: Action[];
}

// ============================================================================
// Tool Call Record (for session persistence)
// ============================================================================

export interface ToolCallRecord {
  tool: string;
  args: object;
  result: object;
  timestamp: number;
}

// ============================================================================
// Tool Server Result
// ============================================================================

interface ClackToolsResultBase {
  toolNames: string[];
  getResult: () => SubmitResponsePayload | null;
  /** Slack Block Kit blocks rendered for the response (null until a response is captured). */
  getRenderedBlocks: () => SlackBlocks | null;
  getStagedIntents: () => Map<string, StagedIntent>;
  getToolCallHistory: () => ToolCallRecord[];
  isSkipped: () => boolean;
  isDisengaged: () => boolean;
  /** True when submit_response was called with `post_top_level: true` and delivery succeeded. */
  isPostedTopLevel: () => boolean;
}

/** Query-mode result: map of MCP servers (one `clack` core server plus one per loaded plugin). */
export interface ClackQueryToolsResult extends ClackToolsResultBase {
  mcpServers: Record<string, McpSdkServerConfigWithInstance>;
}

/** Worker-mode result: single MCP server (no plugin tools in worker mode). */
export interface ClackWorkerToolsResult extends ClackToolsResultBase {
  mcpServer: McpSdkServerConfigWithInstance;
}

export type ClackToolsResult = ClackQueryToolsResult | ClackWorkerToolsResult;
