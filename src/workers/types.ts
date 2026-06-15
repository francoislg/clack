import type { RepositoryConfig } from "../config.js";
import type { WorktreeInfo } from "../worktrees.js";

export type WorkerStatus = "idle" | "busy" | "initializing" | "quarantined" | "failed";

export type ReleaseReason =
  | "pr_merged"
  | "pr_closed"
  | "idle_timeout"
  | "cancelled"
  | "failed"
  | "discarded";

export interface Worker {
  id: string;
  repo: string;
  worktreePath: string;
  currentBranch: string | null;
  status: WorkerStatus;
  setupComplete: boolean;
  setupVersionHash: string | null;
  claimedBy: string | null;
  lastUsedAt: Date;
  createdAt: Date;
  /** Resolves when an `initializing` worker finishes setup; rejects on failure. */
  readyPromise?: Promise<void>;
}

/**
 * Bridge between the new pool-based API and existing `WorktreeInfo` consumers.
 * The pool returns `Worker` records but the workflow layer expects `WorktreeInfo`.
 * This helper lets both views coexist during the transition.
 */
export function workerToWorktreeInfo(worker: Worker): WorktreeInfo {
  return {
    repoName: worker.repo,
    branchName: worker.currentBranch ?? "",
    worktreePath: worker.worktreePath,
    createdAt: worker.createdAt,
  };
}

export interface QueueEntry {
  repo: string;
  branch: string;
  sessionId: string;
  enqueuedAt: Date;
  resolve: (worker: Worker) => void;
  reject: (err: Error) => void;
  /** Drop the entry from the queue and reject the awaiter. */
  cancel: (reason?: string) => void;
}

export interface AcquireOptions {
  /**
   * Fires synchronously when an acquire request enqueues instead of returning
   * a worker immediately. Receives the queue position (1-based). Used by the
   * workflow layer to post a "you're queued" Slack ack while the awaiter
   * waits for a release. Never called in disposable mode.
   */
  onQueued?: (position: number) => void;
  /**
   * Continue an existing PR: check the branch out from its own remote head (`origin/<branch>`)
   * instead of re-branching from the default branch, preserving the PR's commits. Throws
   * `RemoteBranchNotFound` if the remote branch is gone (never clobbers). Default `false`.
   */
  resumeRemoteBranch?: boolean;
}

export interface WorkerPool {
  /** Acquire a worker for the given (repo, branch, sessionId). May enqueue or throw. */
  acquire(
    repo: RepositoryConfig,
    branch: string,
    sessionId: string,
    options?: AcquireOptions,
  ): Promise<Worker>;
  /** Release a previously-acquired worker. Folder is preserved. */
  release(worker: Worker, reason: ReleaseReason): Promise<void>;
  /** Find a worker that currently has the branch checked out (skips quarantined). */
  findByBranch(repo: string, branch: string): Worker | null;
  /** List workers, optionally scoped to a single repo. */
  list(repo?: string): Worker[];
  /** Boot warm-up: ensure at least `minimumProvisioned` workers exist for the repo. */
  ensureMinimum(repo: RepositoryConfig): Promise<void>;
  /**
   * Re-run the setup-version check (and the idempotent install step) on a worker that
   * is already claimed. Acquire paths heal stale setup only when they hand a worker
   * out; recovery flows on a failed change keep their claim, so they call this
   * explicitly before re-entering execution. Optional: the disposable pool has no
   * setup versioning and omits it.
   */
  refreshSetup?(worker: Worker, repo: RepositoryConfig): Promise<void>;
}
