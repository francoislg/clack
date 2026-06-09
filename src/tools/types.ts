import type { App } from "@slack/bolt";
import type { Block as SlackRawBlock, KnownBlock } from "@slack/types";
import type { SlackBlocks } from "../slack/blocks.js";
import type { AuthoredTableBlock, Block } from "../slack/blockSchema.js";
import type {
  McpSdkServerConfigWithInstance,
  McpServerConfig,
  McpServerStatus,
  McpSetServersResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { UserRole } from "../roles.js";
import type { SessionContext, AttentionLevel, DeliveryMode } from "../sessions.js";
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

/**
 * Function signature for the SDK's `Query.mcpServerStatus`. Used by the manager
 * to verify that an always-on baseline server is actually live before short-
 * circuiting `attach_integration` — if the baseline registration silently failed
 * (or is still pending), we want to fall through to a real attach as recovery.
 */
export type McpServerStatusFn = () => Promise<McpServerStatus[]>;

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
  /**
   * When true, the underlying `chat.postMessage` call disables Slack link and media
   * unfurling (both `unfurl_links: false` and `unfurl_media: false`). When absent or
   * false, Slack's default unfurling applies. Sourced from `submit_response`'s
   * `suppress_unfurls` field.
   */
  suppressUnfurls?: boolean;
  /**
   * Explicit thread timestamp for follow-up messages in a multi-message batch.
   * `additional_messages` siblings carry the session's existing thread ts; `thread_replies`
   * carry the primary's returned ts (used when `postTopLevel: true`). When set, the
   * implementation posts via `chat.postMessage` with this `thread_ts` and does NOT touch
   * the streamer — the primary delivery already consumed it. Takes precedence over
   * `postTopLevel` (a non-empty thread target always wins).
   */
  threadTs?: string;
}) => Promise<{ ok: true; ts?: string } | { ok: false; error: string }>;

/**
 * Handle the `switch_delivery_context` tool uses to change the in-flight delivery mode of the
 * current turn. Provided by the delivery orchestrator (`executeAndDeliver`); the tool never
 * touches a streamer directly. `switchTo` swaps the active handler now AND persists the new
 * mode as the session's `deliveryMode`. Idempotent; a no-op once the turn has delivered.
 */
export interface DeliveryControl {
  switchTo: (mode: DeliveryMode) => Promise<void>;
}

/**
 * The shared message-payload entity: the content a single Slack message carries, with NO
 * routing or terminator fields (no `channel`, `thread_ts`, `skip_response`, `deliver_to`,
 * `additional_messages`). Referenced by each `deliver_to` entry's `response`; the same content
 * shape the primary and `post_to` action carry. Same surface as `MessagePayload` plus
 * `suppress_unfurls` and per-message `thread_replies`.
 */
export interface DeliverToPayload {
  blocks: Block[];
  table?: AuthoredTableBlock;
  actions?: Action[];
  reactions?: string[];
  suppress_unfurls?: boolean;
  thread_replies?: MessagePayload[];
}

/** One explicit-destination delivery in a `deliver_to` array. */
export interface DeliverToEntry {
  /** REQUIRED explicit destination channel id — there is no bound channel to fall back to. */
  channel: string;
  /** When set, the message replies into this thread; when absent, it posts top-level in `channel`. */
  thread_ts?: string;
  response: DeliverToPayload;
  /**
   * Optional attention level seeded onto the destination thread so human replies there engage
   * the thread auto-respond path. Absent / `"off"` ⇒ fire-and-forget (no session seeded). Distinct
   * from the top-level `submit_response.attention_level` (which governs the current session).
   */
  attention_level?: AttentionLevel;
  /** Optional guidance injected into the answer turn when a human replies in the destination thread. */
  follow_up_context?: string;
  /** Optional delivery mode seeded onto the destination thread (only meaningful with a non-`"off"` level). */
  default_delivery_mode?: DeliveryMode;
}

/**
 * Delivers one message-payload to an explicit `(channel, thread_ts?)`. The channelless
 * `submit_response` handler calls it once per `deliver_to` entry. Backed by the shared
 * per-channel routine (`postAnswerToChannel`) — NOT a parallel delivery path. Surfaces Slack
 * failures via `{ ok: false }` so the handler can record the run as an error.
 */
export type DeliverToChannelFn = (args: {
  channel: string;
  threadTs?: string;
  payload: DeliverToPayload;
  /** When set and non-`"off"`, seed an engaged session on the destination thread after delivery. */
  attentionLevel?: AttentionLevel;
  /** Follow-up guidance stored on the seeded session (only meaningful with a non-`"off"` level). */
  followUpContext?: string;
  /** Delivery mode seeded onto the engaged session (only meaningful with a non-`"off"` level). */
  deliveryMode?: DeliveryMode;
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
  /** Whether the user-facing scheduling MCP tools are exposed (sourced from `config.cron.userSchedules`). */
  cronUserSchedules: boolean;
  /** Slack WebClient for API calls (absent in test/verify contexts) */
  slackClient?: App["client"];
  /** Delivery callback — when provided, submit_response delivers to Slack directly */
  deliver?: DeliverFn;
  /** Mid-run delivery-mode switch handle. Present only on interactive turns; enables the
   *  `switch_delivery_context` tool. Absent in channelless cron / worker contexts. */
  deliveryControl?: DeliveryControl;
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
   * Declarative override of the `submit_response` schema/gating behavior. See
   * `CronJob.submitResponseMode` for the full contract. When unset, today's auto-derivation
   * rules apply (allowSkip derived from triggerType + skipConditions). Propagated from the
   * cron job through the scheduler → handler → tool-server build context chain.
   */
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
  /**
   * When true, `submit_response` exposes the top-level `additional_messages` and
   * `thread_replies` fields. Only the scheduled (cron) trigger flips this on; other
   * triggers (DM, @mention, reaction, auto-respond, thread-reply, worker) leave it unset
   * so the schema hides the fields and Claude can't reach for multi-message-to-trigger-channel
   * in a context where the trigger channel is the user's conversation space.
   * The `post_to` action's own multi-message fields are NOT gated by this flag.
   */
  allowMultiMessage?: boolean;
  /**
   * Per-installation cap on `additional_messages.length`. Sourced from
   * `config.submitResponse.maxAdditionalMessages` (default 5, valid [1, 10]). Applied at
   * the top level (when `allowMultiMessage: true`) and inside every `post_to` action.
   */
  maxAdditionalMessages?: number;
  /**
   * Effective "now" for time-sensitive tools. Populated by `cronScheduler.executeJob` during
   * replay (the same `asOf` parameter that drives the system prompt's REPLAY CONTEXT block).
   * Real wall-clock `Date.now()` is used when absent.
   */
  asOf?: Date;
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
  /**
   * Returns true when at least one user message has been queued via `handle.sendUpdate`
   * and Claude has not yet observed it. Used by `submit_response` to refuse finalizing
   * while there are unread follow-ups.
   */
  hasPendingInput?: () => boolean;
  /**
   * Returns AND clears the texts of every queued `sendUpdate` push that Claude has not yet
   * observed. `submit_response`'s pending-input gate calls this to inline the texts into
   * its error result so Claude can address them in the current turn.
   */
  consumePendingPushedTexts?: () => string[];
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

export type StagedIntentType =
  | "change"
  | "config_update"
  | "update"
  | "review"
  | "merge"
  | "close"
  | "skill_create"
  | "skill_update"
  | "skill_disable"
  | "skill_restore";

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

export type StagedConfigUpdateIntent =
  | {
      type: "config_update";
      operation: "write";
      file: string;
      content: string;
    }
  | {
      type: "config_update";
      operation: "delete";
      file: string;
    };

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

export interface StagedSkillCreateIntent {
  type: "skill_create";
  slug: string;
  description: string;
  body: string;
  ownerUserId: string;
}

export interface StagedSkillUpdateIntent {
  type: "skill_update";
  slug: string;
  description?: string;
  body?: string;
  editableByAnyone?: boolean;
}

export interface StagedSkillDisableIntent {
  type: "skill_disable";
  slug: string;
}

export interface StagedSkillRestoreIntent {
  type: "skill_restore";
  slug: string;
}

export type StagedIntent =
  | StagedChangeIntent
  | StagedConfigUpdateIntent
  | StagedUpdateIntent
  | StagedReviewIntent
  | StagedMergeIntent
  | StagedCloseIntent
  | StagedSkillCreateIntent
  | StagedSkillUpdateIntent
  | StagedSkillDisableIntent
  | StagedSkillRestoreIntent;

// ============================================================================
// submit_response Payload
// ============================================================================

/**
 * Snapshot of a response, saved at delivery time for stable cross-posting.
 * The `blocks` array is the canonical shareable payload (Slack Block Kit in
 * Clack's curated subset). `text` is a plain-string fallback used as the
 * `text:` parameter on `chat.postMessage` for notifications and accessibility.
 *
 * `actions` and `reactions` are persisted alongside `blocks` so the deferred
 * (button-click) `post_to` delivery path can replay them after an arbitrary
 * delay between submit time and click time. They are forward-declared via
 * `Action[]`, defined further down in this file.
 */
export interface ResponseSnapshot {
  text: string;
  blocks: Block[];
  /**
   * Optional table appended to the cross-posted message at delivery time.
   * Slack always renders tables at the bottom of the message, so this is a
   * sibling of `blocks` rather than a member of it.
   */
  table?: AuthoredTableBlock;
  actions?: Action[];
  reactions?: string[];
  /**
   * When true, the deferred `post_to` delivery (auto-execute or button-click)
   * disables Slack link/media unfurling on the cross-posted message. Captured
   * from the `post_to` action's `suppress_unfurls` field at snapshot time.
   */
  suppressUnfurls?: boolean;
  /**
   * Optional sibling messages persisted alongside the primary. Replayed by the
   * button-click and auto-execute delivery paths after the primary lands, using
   * the post_to's `thread_ts` as the shared thread context.
   */
  additional_messages?: MessagePayload[];
  /**
   * Optional reply messages persisted alongside the primary. Replayed under the
   * primary's returned `ts` (the post_to lands top-level; replies thread under it).
   */
  thread_replies?: MessagePayload[];
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
  /**
   * Optional table appended to the cross-posted message at delivery time.
   * Slack always renders tables at the bottom of the message, so this is a
   * sibling of `blocks` rather than a member of it.
   */
  table?: AuthoredTableBlock;
  /**
   * Optional interactive buttons rendered on the cross-posted message. Same
   * action types as top-level (followup, choice, change, config_update, update).
   * Nested `post_to` is rejected. Click handlers route back to the original
   * session, so ref-based actions resolve against the original intentStore.
   */
  actions?: Action[];
  /**
   * Optional emoji reactions added to the cross-posted message after delivery.
   * Same semantics as top-level `submit_response.reactions`.
   */
  reactions?: string[];
  /**
   * Optional. When true, disables Slack link/media unfurling on the
   * cross-posted message. Forwarded into the snapshot so the deferred
   * button-click path can replay it.
   */
  suppress_unfurls?: boolean;
  /**
   * Optional sibling messages posted in the same thread as this post_to's primary.
   * Requires `thread_ts` to be set on this action (siblings need a shared thread
   * context). Capped per-installation by `submitResponse.maxAdditionalMessages`.
   */
  additional_messages?: MessagePayload[];
  /**
   * Optional replies posted under this post_to's own message timestamp. Requires
   * `thread_ts` to be ABSENT on this action (the post_to itself must land
   * top-level so replies can thread under it). Capped at 20.
   */
  thread_replies?: MessagePayload[];
  /**
   * Optional attention level seeded onto the cross-posted thread so human replies engage the
   * thread auto-respond path. Absent / `"off"` ⇒ fire-and-forget. Mirrors the `deliver_to` entry field.
   */
  attention_level?: AttentionLevel;
  /** Optional guidance injected into the answer turn when a human replies in the cross-posted thread. */
  follow_up_context?: string;
  /** Optional delivery mode seeded onto the cross-posted thread (only meaningful with a non-`"off"` level). */
  default_delivery_mode?: DeliveryMode;
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
  auto?: boolean;
}

export interface UpdateAction {
  type: "update";
  ref: string;
  label?: string;
  auto?: boolean;
}

export interface SkillCreateAction {
  type: "skill_create";
  ref: string;
  label?: string;
  auto?: boolean;
}

export interface SkillUpdateAction {
  type: "skill_update";
  ref: string;
  label?: string;
  auto?: boolean;
}

export interface SkillDisableAction {
  type: "skill_disable";
  ref: string;
  label?: string;
  auto?: boolean;
}

export interface SkillRestoreAction {
  type: "skill_restore";
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
  | UpdateAction
  | SkillCreateAction
  | SkillUpdateAction
  | SkillDisableAction
  | SkillRestoreAction;

export type ActionType = Action["type"];

/**
 * Shape of a single follow-up message inside `additional_messages` / `thread_replies`
 * (both at the top level of `submit_response` and inside a `post_to` action). Same
 * surface as the primary message minus the session-level signals (`message`,
 * `post_top_level`, `attention_level`, `skip_response`) that only make sense once per call.
 */
export interface MessagePayload {
  blocks: Block[];
  table?: AuthoredTableBlock;
  actions?: Action[];
  reactions?: string[];
}

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
  /**
   * Optional table appended after `blocks` at delivery. Slack always renders
   * tables at the bottom of the message regardless of position, so the MCP
   * surface exposes it as a sibling of `blocks` rather than a block type.
   */
  table?: AuthoredTableBlock;
  actions: Action[];
  /**
   * Sibling messages posted in the same thread as the primary. Only present when
   * the run's deps set `allowMultiMessage: true` (today, scheduled-trigger only).
   * Mutually exclusive with `threadReplies`. Bounded by `submitResponse.maxAdditionalMessages`.
   */
  additionalMessages?: MessagePayload[];
  /**
   * Replies posted under the primary top-level message. Only valid when the primary
   * was delivered with `post_top_level: true`. Bounded by a fixed sanity ceiling of 20.
   */
  threadReplies?: MessagePayload[];
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
  /** The attention level Claude set via `submit_response.attention_level`, or null if unset. */
  getAttentionLevel: () => AttentionLevel | null;
  /** The delivery mode Claude set via `submit_response.default_delivery_mode`, or null if unset. */
  getDeliveryMode: () => DeliveryMode | null;
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
