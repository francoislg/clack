import type { WorktreeInfo } from "../worktrees.js";
import type { SpinoffIntentData } from "./spinoff.js";

// ============================================================================
// Core Types
// ============================================================================

export type TriggerType =
  | "directMessages"
  | "mentions"
  | "reactions"
  | "autoRespond"
  | "scheduled"
  | "threadReply"
  | "channelReply";

export interface ChangeRequest {
  userId: string;
  /** Slack display name (or real name) of the requester, resolved before the worker runs. */
  userDisplayName?: string;
  message: string;
  triggerType: TriggerType;
  channel: string;
  threadTs?: string;
  messageTs: string;
  /**
   * When true, the worker suppresses its `report_status` Slack posts (the change still runs and
   * opens a PR). Set for silent cron runs. See the `silent-change-execution` capability.
   */
  silent?: boolean;
}

/**
 * What a change run is FOR. `"implement"` (the default when absent) is the classic worker
 * flow ending in a PR; `"test"` is a tester run — reduced-privilege QA on an existing PR
 * branch ending in a recording, never a PR.
 */
export type ChangeKind = "implement" | "test";

export interface ChangePlan {
  branchName: string;
  description: string;
  targetRepo: string;
  /** Run kind. Absent reads as `"implement"`. */
  kind?: ChangeKind;
  /**
   * Detailed implementation plan from the originating Slack conversation,
   * if one was discussed. Forwarded into the worker prompt so the worker
   * doesn't have to re-derive the strategy from `description` alone.
   */
  plan?: string;
  /**
   * Continue an existing PR on this branch: acquire from the branch's own remote head
   * (preserving its commits) instead of re-branching from the default branch. Set when the
   * change is a continuation (e.g. the idler advancing one of Clack's own open PRs). Default false.
   */
  resumeRemoteBranch?: boolean;
  /**
   * Absolute path to a spinoff slice patch to apply onto the fresh worktree before the worker
   * runs. Set only for a sibling change provisioned from a `propose_spinoff` intent — the slice's
   * exact code is applied here rather than regenerated. If the patch fails to apply, the change
   * fails and the patch is retained at this path for recovery.
   */
  applySpinoffPatch?: string;
}

export interface ChangeSession {
  id: string;
  userId: string;
  request: ChangeRequest;
  plan: ChangePlan;
  worktree?: WorktreeInfo;
  prUrl?: string;
  status: ChangeStatus;
  createdAt: Date;
  lastActivityAt: Date;
  channel: string;
  threadTs: string;
  cancelledBy?: { userId: string; reason?: string };
  verificationAttempts?: number;
}

export type ChangeStatus =
  | "planning"
  | "executing"
  | "pr_created"
  | "reviewing"
  | "merging"
  | "completed"
  | "failed"
  | "cancelled";

export interface ChangeResult {
  success: boolean;
  prUrl?: string;
  error?: string;
  summary?: string;
  cancelled?: boolean;
  cancelledBy?: { userId: string; reason?: string };
  /**
   * Spinoff slices the worker staged during this run. Surfaced here (not provisioned
   * inside the workflow) because provisioning a sibling needs the Slack client, session,
   * and streamer machinery that only the handler layer owns. The handler reads this and
   * provisions one standalone sibling change per entry.
   */
  spinoffs?: SpinoffIntentData[];
}

export type FollowUpCommand =
  | "review"
  | "merge"
  | "update"
  | "close"
  | "continue"
  | "restart"
  | "discard";

/** Commands that act on a `failed` change instead of a live PR. */
export const RECOVERY_COMMANDS: ReadonlySet<FollowUpCommand> = new Set([
  "continue",
  "restart",
  "discard",
]);

export function isRecoveryCommand(command: FollowUpCommand): boolean {
  return RECOVERY_COMMANDS.has(command);
}

export interface FollowUpInfo {
  command: FollowUpCommand;
  additionalInstructions?: string;
}

/**
 * Subset of ChangeSession fields that writeSessionState actually needs.
 * Used during restoration when a full ChangeSession cannot be reconstructed
 * (e.g., the original ChangeRequest is unavailable).
 */
export interface WriteableSessionState {
  id: string;
  userId: string;
  plan: ChangePlan;
  prUrl?: string;
  status: ChangeStatus;
  createdAt: Date;
  lastActivityAt: Date;
  channel: string;
  threadTs: string;
  cancelledBy?: { userId: string; reason?: string };
  verificationAttempts?: number;
}

// ============================================================================
// Persisted State Types
// ============================================================================

export interface PersistedSessionState {
  sessionId: string;
  status: ChangeStatus;
  phase: string;
  branch: string;
  repo: string;
  userId: string;
  description: string;
  prUrl: string | null;
  startedAt: string;
  lastActivityAt: string;
  lastMessage: string;
  channel: string | null;
  threadTs: string | null;
  cancelledBy?: { userId: string; reason?: string };
  verificationAttempts?: number;
}

// ============================================================================
// Execution Types
// ============================================================================

export interface ExecutionResult {
  success: boolean;
  commitHash?: string;
  summary?: string;
  error?: string;
  /** SDK session ID captured during execution (for resuming follow-ups) */
  sdkSessionId?: string;
  /** Spinoff slices the worker staged via `propose_spinoff` during this run. */
  stagedSpinoffs?: SpinoffIntentData[];
}
