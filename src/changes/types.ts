import type { WorktreeInfo } from "../worktrees.js";

// ============================================================================
// Core Types
// ============================================================================

export type TriggerType =
  | "directMessages"
  | "mentions"
  | "reactions"
  | "autoRespond"
  | "scheduled"
  | "threadReply";

export interface ChangeRequest {
  userId: string;
  message: string;
  triggerType: TriggerType;
  channel: string;
  threadTs?: string;
  messageTs: string;
}

export interface ChangePlan {
  branchName: string;
  description: string;
  targetRepo: string;
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
}

export type FollowUpCommand = "review" | "merge" | "update" | "close";

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
}
