import type { WorktreeInfo } from "../worktrees.js";

// ============================================================================
// Core Types
// ============================================================================

export type TriggerType = "directMessages" | "mentions" | "reactions";

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
  worktree: WorktreeInfo;
  prUrl?: string;
  status: ChangeStatus;
  createdAt: Date;
  lastActivityAt: Date;
  channel: string;
  threadTs: string;
}

export type ChangeStatus =
  | "planning"
  | "executing"
  | "pr_created"
  | "reviewing"
  | "merging"
  | "completed"
  | "failed";

export interface ChangeResult {
  success: boolean;
  prUrl?: string;
  error?: string;
  summary?: string;
}

export type FollowUpCommand = "review" | "merge" | "update" | "close";

export interface FollowUpInfo {
  command: FollowUpCommand;
  additionalInstructions?: string;
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
}

// ============================================================================
// Execution Types
// ============================================================================

export interface ExecutionResult {
  success: boolean;
  commitHash?: string;
  summary?: string;
  error?: string;
}

export interface PlanGenerationResult {
  success: boolean;
  plan?: ChangePlan;
  error?: string;
}

// ============================================================================
// Worker Display Types
// ============================================================================

export interface ActiveWorker {
  id: string;
  userId: string;
  status: ChangeStatus;
  description: string;
  branch: string;
  repo: string;
  prUrl?: string;
  channel: string;
  threadTs: string;
  startedAt: Date;
}
