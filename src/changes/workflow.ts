import { getConfig, findRepoByName } from "../config.js";
import { t } from "../i18n/t.js";
import type { WorktreeInfo } from "../worktrees.js";
import {
  isRecoveryCommand,
  type ChangeRequest,
  type ChangePlan,
  type ChangeResult,
  type ChangeStatus,
  type FollowUpCommand,
  type ExecutionResult,
} from "./types.js";
import type { ExecuteChangeOptions } from "./execution.js";
import type { WorkerToolContext, ClackWorkerToolsResult } from "../tools/types.js";
import type { SessionContext } from "../sessions.js";
import { getSession } from "../sessions.js";
import { firstUserMessage } from "../sessions/selectors.js";
import type { ActiveChangeState } from "./activeState.js";
import type { ClaudeRunHandle } from "../claude/runHandle.js";
import { lazyDefaultPool } from "../workers/index.js";
import { forceResetBranch } from "../workers/branchSwitch.js";
import { poolWorkerForChange } from "./poolWorker.js";
import { workerToWorktreeInfo, type Worker, type WorkerPool } from "../workers/types.js";
import {
  getActiveChange,
  setActiveChange,
  clearActiveChange,
  getActiveChangeForUser,
  countActiveChangesForUser,
  updateActiveChangeStatus,
} from "./activeState.js";
import { appendExecutionLog, readSessionState } from "./persistence.js";
import {
  executeChange,
  resolveChangesInstructions,
  runClaudeInWorktree,
  runWorktreeSetup,
} from "./execution.js";
import { buildWorkerContext } from "../tools/context.js";
import { buildClackTools } from "../tools/server.js";
import { fetchPRReviewContext } from "./pr.js";
import type { StreamEvent } from "../streaming/types.js";
import { errorMessage } from "../errors.js";
import type { Config as AppConfig, RepositoryConfig } from "../config.js";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

// ============================================================================
// Dependency Injection
// ============================================================================

interface RunClaudeInWorktreeOptions {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  allowedTools: string[];
  disallowedTools: string[];
  branchName: string;
  mcpServers: { clack: McpServerConfig };
  onEvent?: (event: StreamEvent) => void | Promise<void>;
  abortController?: AbortController;
  /** Captures the live `ClaudeRunHandle` so the workflow can route stop/sendUpdate to it. */
  onHandle?: (handle: ClaudeRunHandle) => void;
  timeout?: number;
  resumeSessionId?: string;
  onSessionId?: (id: string) => void;
}

export interface WorkflowDeps {
  getConfig: () => AppConfig;
  findRepoByName: (name: string, config: AppConfig) => RepositoryConfig | undefined;
  pool: WorkerPool;
  getActiveChange: (sessionId: string) => ActiveChangeState | undefined;
  setActiveChange: (
    sessionId: string,
    change: ActiveChangeState,
    ref: { userId: string; channelId: string; threadTs: string; triggerType: string },
  ) => void;
  clearActiveChange: (sessionId: string) => void;
  getActiveChangeForUser: (
    userId: string,
  ) => { sessionId: string; change: ActiveChangeState } | undefined;
  countActiveChangesForUser: (userId: string) => number;
  updateActiveChangeStatus: (sessionId: string, status: ChangeStatus, lastMessage?: string) => void;
  appendExecutionLog: (branch: string, message: string) => void;
  readSessionState: (
    branch: string,
  ) => Promise<{ status: string; phase: string; lastMessage: string } | null>;
  executeChange: (opts: ExecuteChangeOptions) => Promise<ExecutionResult>;
  resolveChangesInstructions: (repoName: string) => string;
  runClaudeInWorktree: (
    repoName: string,
    opts: RunClaudeInWorktreeOptions,
  ) => Promise<{ success: boolean; error?: string }>;
  runWorktreeSetup: (
    repoName: string,
    worktreePath: string,
    branch: string,
    onEvent?: (event: StreamEvent) => void | Promise<void>,
  ) => Promise<void>;
  buildWorkerContext: typeof buildWorkerContext;
  // Workflow only uses worker-mode build. Narrow the type so test mocks only need the worker shape.
  buildClackTools: (ctx: WorkerToolContext) => ClackWorkerToolsResult;
  fetchPRReviewContext: (
    prUrl: string,
  ) => Promise<{ ok: true; context: string } | { ok: false; error: string }>;
  getSession: (sessionId: string) => Promise<SessionContext | null>;
  forceResetBranch: (worker: Worker, repo: RepositoryConfig, branch: string) => Promise<void>;
}

export const defaultWorkflowDeps: WorkflowDeps = {
  getConfig,
  findRepoByName,
  pool: lazyDefaultPool(),
  getActiveChange,
  setActiveChange,
  clearActiveChange,
  getActiveChangeForUser,
  countActiveChangesForUser,
  updateActiveChangeStatus,
  appendExecutionLog,
  readSessionState,
  executeChange,
  resolveChangesInstructions,
  runClaudeInWorktree,
  runWorktreeSetup,
  buildWorkerContext,
  buildClackTools,
  fetchPRReviewContext,
  getSession,
  forceResetBranch,
};

// ============================================================================
// Helpers
// ============================================================================

function buildCancelledResult(
  activeChange: ActiveChangeState,
  deps: Pick<WorkflowDeps, "updateActiveChangeStatus">,
  sessionId: string,
  sourceError: string | undefined,
  fallback: string,
): ChangeResult | null {
  if (!activeChange.cancelledBy) return null;
  // If we were cancelled while running a follow-up on an existing PR (review,
  // update, merge, close), the PR itself is untouched — revert the in-memory
  // status so the user can retry via buttons. For planning/executing (no PR
  // yet), transition to terminal `cancelled`.
  const prFollowUpStatuses: ChangeStatus[] = ["reviewing", "merging"];
  const updateStatus = activeChange.prUrl || prFollowUpStatuses.includes(activeChange.status);
  deps.updateActiveChangeStatus(sessionId, updateStatus ? "pr_created" : "cancelled");
  return {
    success: false,
    cancelled: true,
    cancelledBy: activeChange.cancelledBy,
    error: sourceError ?? fallback,
  };
}

/**
 * Settle a recovery execution (continue / restart): mirror the start-workflow
 * outcome handling — PR created means success, anything else returns the change
 * to `failed` so the recovery actions are offered again.
 */
async function settleRecoveryResult(
  deps: WorkflowDeps,
  sessionId: string,
  activeChange: ActiveChangeState,
  result: ExecutionResult,
): Promise<ChangeResult> {
  if (result.sdkSessionId) {
    activeChange.sdkSessionId = result.sdkSessionId;
  }
  if (!result.success) {
    const cancelled = buildCancelledResult(
      activeChange,
      deps,
      sessionId,
      result.error,
      "Recovery cancelled",
    );
    if (cancelled) return cancelled;
    deps.updateActiveChangeStatus(sessionId, "failed");
    return { success: false, error: result.error ?? "Recovery failed" };
  }

  const updatedSession = await deps.getSession(sessionId);
  if (updatedSession?.activeChange?.prUrl) {
    return {
      success: true,
      prUrl: updatedSession.activeChange.prUrl,
      summary: result.summary,
    };
  }

  deps.updateActiveChangeStatus(sessionId, "failed");
  return {
    success: false,
    summary: result.summary,
    error: "Changes committed but PR was not created. Check the thread for details.",
  };
}

// ============================================================================
// Main Workflow Orchestration
// ============================================================================

/**
 * Start a new change request workflow.
 * Attaches an activeChange to the existing unified thread session.
 *
 * `onAck` is an optional Slack-side hook used to post out-of-band acks (e.g.,
 * "you're queued at position N") that don't fit cleanly into the StreamEvent
 * pipeline. Provided by `changeAction.ts` with the Slack client + thread bound.
 */
export async function startChangeWorkflow(
  request: ChangeRequest,
  plan: ChangePlan,
  sessionId: string,
  onEvent?: (event: StreamEvent) => void | Promise<void>,
  deps: WorkflowDeps = defaultWorkflowDeps,
  onAck?: (text: string) => Promise<void>,
): Promise<ChangeResult> {
  const config = deps.getConfig();

  // Per-user concurrent-change cap. Default 1 preserves legacy behavior;
  // 0 disables the cap and relies on the worker pool's queue for backpressure.
  const userCap = config.changesWorkflow?.maxActiveChangesPerUser ?? 1;
  if (userCap > 0) {
    const activeCount = deps.countActiveChangesForUser(request.userId);
    if (activeCount >= userCap) {
      const error =
        userCap === 1
          ? `You already have an active change request. Check your existing thread or wait for it to complete.`
          : `You already have ${activeCount} active change request${activeCount === 1 ? "" : "s"} (limit ${userCap}). Wait for one to complete before starting another.`;
      return { success: false, error };
    }
  }

  // Find target repo
  const repo = deps.findRepoByName(plan.targetRepo, config);
  if (!repo) {
    return {
      success: false,
      error: `Repository ${plan.targetRepo} not found`,
    };
  }

  // Reserve the active change slot early to prevent concurrent triggers
  // (e.g., auto-execute + button click racing). The worktree field is set
  // after creation, but the slot blocks duplicate startChangeWorkflow calls.
  const activeChange: ActiveChangeState = {
    branch: plan.branchName,
    repo: plan.targetRepo,
    description: plan.description,
    worktree: undefined, // set below after worktree creation
    status: "executing",
    startedAt: new Date(),
    lastActivityAt: new Date(),
    verificationAttempts: 0,
  };
  deps.setActiveChange(sessionId, activeChange, {
    userId: request.userId,
    channelId: request.channel,
    threadTs: request.messageTs,
    triggerType: request.triggerType,
  });

  // Acquire a worker via the pool. This handles fresh-create vs. existing-resume
  // (disposable mode) and slot-allocation (reusable mode) transparently.
  let worker: Worker;
  let worktree: WorktreeInfo;
  let resumeContext: string | undefined;

  const preExisting = deps.pool.findByBranch(repo.name, plan.branchName);
  if (preExisting) {
    const existingState = await deps.readSessionState(plan.branchName);
    if (existingState) {
      const stateObj = existingState as { status: string; phase: string; lastMessage: string };
      deps.appendExecutionLog(
        plan.branchName,
        `Resuming from existing worktree (previous status: ${stateObj.status})`,
      );
      resumeContext = `Previous session was in "${stateObj.phase}" phase. Last message: "${stateObj.lastMessage}"`;
    } else {
      deps.appendExecutionLog(plan.branchName, "Reusing existing worktree (no previous state)");
      resumeContext =
        "A previous session started but left no state. The workspace may have partial changes.";
    }
  }

  try {
    worker = await deps.pool.acquire(repo, plan.branchName, sessionId, {
      onQueued: (position) => {
        deps.appendExecutionLog(
          plan.branchName,
          `Queued for worker (position ${position}) — waiting for a slot to free up`,
        );
        // Surface to the user too — they'd otherwise see no feedback while parked.
        if (onAck) {
          const text =
            position === 1
              ? t("changes.queue.next_in_line", { repo: plan.targetRepo })
              : t("changes.queue.queued_at", { position, repo: plan.targetRepo });
          // Fire-and-forget: a Slack hiccup must not cause the queued acquire to fail.
          onAck(text).catch((err) =>
            deps.appendExecutionLog(plan.branchName, `Queue ack post failed: ${errorMessage(err)}`),
          );
        }
      },
    });
    worktree = workerToWorktreeInfo(worker);
    // For fresh worker without setup yet, run worktree setup. The pool's reusable
    // implementation runs setup internally (via injected setup runner); the disposable
    // implementation defers to the workflow.
    if (!worker.setupComplete) {
      await deps.runWorktreeSetup(repo.name, worktree.worktreePath, plan.branchName, onEvent);
      worker.setupComplete = true;
    }
  } catch (err) {
    deps.clearActiveChange(sessionId);
    return {
      success: false,
      error: t("changes.create_workspace_failed", { error: errorMessage(err) }),
    };
  }

  // Now that the worktree exists, attach it to the active change
  activeChange.worktree = worktree;

  // Phase 2: Execution
  const abortController = new AbortController();

  let execResult;
  try {
    execResult = await deps.executeChange({
      plan,
      worktree,
      request,
      sessionId,
      resumeContext,
      onEvent,
      abortController,
      onHandle: (handle) => {
        activeChange.handle = handle;
      },
    });
  } catch (error) {
    deps.appendExecutionLog(plan.branchName, `Execution error: ${errorMessage(error)}`);
    execResult = {
      success: false,
      error: `Execution threw exception: ${errorMessage(error)}`,
    };
  } finally {
    activeChange.handle = undefined;
  }

  // Store SDK session ID for resuming follow-ups
  if (execResult.sdkSessionId) {
    const ac = deps.getActiveChange(sessionId);
    if (ac) ac.sdkSessionId = execResult.sdkSessionId;
  }

  if (!execResult.success) {
    const cancelledResult = buildCancelledResult(
      activeChange,
      deps,
      sessionId,
      execResult.error,
      "Execution cancelled",
    );
    if (cancelledResult) return cancelledResult;
    deps.updateActiveChangeStatus(sessionId, "failed");
    return {
      success: false,
      error: execResult.error ?? "Execution failed",
    };
  }

  // Read the session to check if PR was created (ensure_pr updates activeChange state).
  const updatedSession = await deps.getSession(sessionId);
  if (updatedSession?.activeChange?.prUrl) {
    return {
      success: true,
      prUrl: updatedSession.activeChange.prUrl,
      summary: execResult.summary,
    };
  }

  // PR wasn't created — execution ran but the workflow didn't fully complete
  return {
    success: false,
    summary: execResult.summary,
    error: "Changes committed but PR was not created. Check the thread for details.",
  };
}

/**
 * Handle a follow-up command in a change thread.
 * Operates on the unified session's activeChange.
 */
export async function handleFollowUp(
  session: SessionContext,
  command: FollowUpCommand,
  additionalInstructions?: string,
  onEvent?: (event: StreamEvent) => void | Promise<void>,
  deps: WorkflowDeps = defaultWorkflowDeps,
  userFeedback?: string,
): Promise<ChangeResult> {
  const activeChange = session.activeChange;
  if (!activeChange) {
    return { success: false, error: "No active change in this thread." };
  }

  const config = deps.getConfig();
  const repo = deps.findRepoByName(activeChange.repo, config);

  // Reusable mode: a detached session has no `worktree` until we re-acquire it.
  // Disposable mode: a missing worktree is a real failure — surface the error.
  // Discard skips re-acquire: claiming a worker only to release it is pointless.
  if (!activeChange.worktree && command !== "discard") {
    const reusableMode = config.changesWorkflow?.reusableFolders?.enabled === true;
    if (!reusableMode || !repo) {
      return { success: false, error: "No worktree exists for this change." };
    }
    try {
      const worker = await deps.pool.acquire(repo, activeChange.branch, session.sessionId);
      activeChange.worktree = workerToWorktreeInfo(worker);
    } catch (err) {
      return {
        success: false,
        error: `Failed to re-acquire worker for branch ${activeChange.branch}: ${errorMessage(err)}`,
      };
    }
  }

  // Guard: PR follow-ups need an idle change (PR exists, no work in progress);
  // recovery commands need a failed change. completed/cancelled are terminal for all.
  const terminalStatuses: ChangeStatus[] = ["completed", "cancelled"];
  const busyStatuses: ChangeStatus[] = ["executing", "reviewing", "merging"];
  if (terminalStatuses.includes(activeChange.status)) {
    return {
      success: false,
      error: `This change is already ${activeChange.status}. No further actions are possible.`,
    };
  }
  if (busyStatuses.includes(activeChange.status)) {
    return {
      success: false,
      error: `This change is currently ${activeChange.status}. Please wait for it to finish before requesting another action.`,
    };
  }
  if (activeChange.status === "failed" && !isRecoveryCommand(command)) {
    return {
      success: false,
      error: [
        "This change failed. Use the recovery actions to resume it (Continue),",
        "redo it from scratch (Start over), or abandon it (Discard).",
      ].join(" "),
    };
  }
  if (isRecoveryCommand(command) && activeChange.status !== "failed") {
    return {
      success: false,
      error: "Recovery actions only apply to a failed change.",
    };
  }

  activeChange.lastActivityAt = new Date();

  // Discard needs no worker context or Claude run — release the workspace and stop.
  if (command === "discard") {
    const worker = poolWorkerForChange(activeChange, deps.pool);
    if (worker) {
      try {
        await deps.pool.release(worker, "discarded");
      } catch (err) {
        return {
          success: false,
          error: `Failed to release the workspace: ${errorMessage(err)}`,
        };
      }
    }
    activeChange.worktree = undefined;
    deps.updateActiveChangeStatus(session.sessionId, "cancelled", "Discarded by user");
    return { success: true, summary: "Change discarded. The workspace was released." };
  }
  if (!activeChange.worktree) {
    return { success: false, error: "No worktree exists for this change." };
  }
  const worktree = activeChange.worktree;

  // Create an AbortController for cancellation support. The live `ClaudeRunHandle` is
  // captured into `activeChange.handle` via the `onHandle` callback on each inner call so
  // `cancel_worker_run` and Slack-side stop paths can call `handle.stop(reason)`.
  const abortController = new AbortController();
  const captureHandle = (handle: ClaudeRunHandle): void => {
    activeChange.handle = handle;
  };

  // Build worker context for this command
  const workerCtx = deps.buildWorkerContext({
    worktreePath: worktree.worktreePath,
    branchName: activeChange.branch,
    repoName: activeChange.repo,
    repoUrl: repo?.url ?? "",
    channelId: session.channelId,
    threadTs: session.threadTs,
    sessionId: session.sessionId,
    config,
  });
  const workerTools = deps.buildClackTools(workerCtx);

  const changesInstructions = deps.resolveChangesInstructions(activeChange.repo);

  try {
    switch (command) {
      case "review": {
        deps.updateActiveChangeStatus(session.sessionId, "reviewing");

        const reviewResult = await deps.fetchPRReviewContext(activeChange.prUrl!);
        if (!reviewResult.ok) {
          return { success: false, error: reviewResult.error };
        }

        const prompt = `Address the feedback on this PR: ${activeChange.prUrl}\n\n${reviewResult.context}\n\n1. Read and understand each review comment\n2. Implement the requested changes\n3. Commit with a message like "Address review feedback"\n4. Push the changes using the git_push tool\n5. Report what you addressed using the report_status tool`;
        const systemPrompt = changesInstructions
          ? `Repository-Specific Instructions:\n${changesInstructions}`
          : undefined;

        const result = await deps.runClaudeInWorktree(activeChange.repo, {
          prompt,
          cwd: worktree.worktreePath,
          systemPrompt,
          allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
          disallowedTools: ["Task"],
          branchName: activeChange.branch,
          mcpServers: { clack: workerTools.mcpServer },
          onEvent,
          abortController,
          onHandle: captureHandle,
          resumeSessionId: activeChange.sdkSessionId,
          onSessionId: (id: string) => {
            activeChange.sdkSessionId = id;
          },
        });

        if (result.success) {
          deps.updateActiveChangeStatus(session.sessionId, "pr_created");
          return { success: true, summary: "Review feedback addressed" };
        }
        const cancelledReview = buildCancelledResult(
          activeChange,
          deps,
          session.sessionId,
          result.error,
          "Review cancelled",
        );
        if (cancelledReview) return cancelledReview;
        // Revert to pr_created — the PR still exists and user can retry
        deps.updateActiveChangeStatus(session.sessionId, "pr_created");
        return { success: false, error: result.error ?? "Review failed" };
      }

      case "update": {
        deps.updateActiveChangeStatus(session.sessionId, "executing");

        const plan: ChangePlan = {
          branchName: activeChange.branch,
          description: additionalInstructions ?? activeChange.description,
          targetRepo: activeChange.repo,
        };
        const updateRequest: ChangeRequest = {
          userId: session.userId,
          message: additionalInstructions ?? firstUserMessage(session).text,
          triggerType: session.triggerType ?? "reactions",
          channel: session.channelId,
          messageTs: session.threadTs,
        };

        // The worker resumes its prior SDK session and remembers its previous decisions.
        // Without seeing why the user is asking again, it tends to defend those decisions.
        // The verbatim user feedback flips the framing from "new task" to "user is correcting me".
        const resumeContext = userFeedback
          ? `IMPORTANT — User feedback that triggered this update:
"${userFeedback}"

The instructions above were generated from the user's full Slack thread context (which you cannot see) and reflect this feedback. They may correct conclusions you reached in your previous turn — defer to them rather than your prior reasoning. If the prior turn concluded a file shouldn't change and the user is now asking you to change it, the user wins.`
          : undefined;

        const updateResult = await deps.executeChange({
          plan,
          worktree,
          request: updateRequest,
          sessionId: session.sessionId,
          onEvent,
          sdkSessionId: activeChange.sdkSessionId,
          abortController,
          onHandle: captureHandle,
          ...(resumeContext && { resumeContext }),
        });

        // Store SDK session ID for future follow-ups
        if (updateResult.sdkSessionId) {
          activeChange.sdkSessionId = updateResult.sdkSessionId;
        }

        if (!updateResult.success) {
          const cancelledUpdate = buildCancelledResult(
            activeChange,
            deps,
            session.sessionId,
            updateResult.error,
            "Update cancelled",
          );
          if (cancelledUpdate) return cancelledUpdate;
          // Revert to pr_created — the PR still exists and user can retry
          deps.updateActiveChangeStatus(session.sessionId, "pr_created");
          return { success: false, error: updateResult.error };
        }

        // executeChange() already handles push via its MCP tools (git_push + ensure_pr + report_status)
        deps.updateActiveChangeStatus(session.sessionId, "pr_created");
        return {
          success: true,
          prUrl: activeChange.prUrl,
          summary: updateResult.summary ?? "Additional changes pushed",
        };
      }

      case "merge": {
        deps.updateActiveChangeStatus(session.sessionId, "merging");

        const result = await deps.runClaudeInWorktree(activeChange.repo, {
          prompt: `Merge the pull request at ${activeChange.prUrl} using the merge_pr tool. Report the result using report_status.`,
          cwd: worktree.worktreePath,
          allowedTools: [],
          disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
          timeout: 2,
          branchName: activeChange.branch,
          mcpServers: { clack: workerTools.mcpServer },
          onEvent,
          abortController,
          onHandle: captureHandle,
        });

        // Check if merge succeeded by reading session state
        const updatedSession = await deps.getSession(session.sessionId);
        if (!updatedSession?.activeChange || updatedSession.activeChange.status === "completed") {
          return {
            success: true,
            prUrl: activeChange.prUrl,
            summary: "PR merged successfully",
          };
        }

        const cancelledMerge = buildCancelledResult(
          activeChange,
          deps,
          session.sessionId,
          result.error,
          "Merge cancelled",
        );
        if (cancelledMerge) return cancelledMerge;
        return {
          success: false,
          error: result.error ?? "Merge failed",
        };
      }

      case "close": {
        const deleteBranchRequested = additionalInstructions
          ? /delete\s*(the\s*)?(remote\s*)?branch/i.test(additionalInstructions)
          : false;

        const result = await deps.runClaudeInWorktree(activeChange.repo, {
          prompt: `Close the pull request at ${activeChange.prUrl} using the close_pr tool${deleteBranchRequested ? " with delete_branch: true" : ""}. Report the result using report_status.`,
          cwd: worktree.worktreePath,
          allowedTools: [],
          disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
          timeout: 2,
          branchName: activeChange.branch,
          mcpServers: { clack: workerTools.mcpServer },
          onEvent,
          abortController,
          onHandle: captureHandle,
        });

        // Check if close succeeded by reading session state
        const updatedSession = await deps.getSession(session.sessionId);
        if (!updatedSession?.activeChange || updatedSession.activeChange.status === "completed") {
          return {
            success: true,
            summary: "PR closed",
          };
        }

        const cancelledClose = buildCancelledResult(
          activeChange,
          deps,
          session.sessionId,
          result.error,
          "Close cancelled",
        );
        if (cancelledClose) return cancelledClose;
        return {
          success: false,
          error: result.error ?? "Close failed",
        };
      }

      case "continue": {
        if (!repo) {
          return { success: false, error: `Repository ${activeChange.repo} not found` };
        }

        // Read the persisted state BEFORE the status transition — flipping to
        // `executing` overwrites the phase/lastMessage the resume context needs.
        const prevState = await deps.readSessionState(activeChange.branch);
        const resumeContext = prevState
          ? [
              `A previous session on this change failed in "${prevState.phase}" phase.`,
              `Last message: "${prevState.lastMessage}".`,
              "Continue the work from where it left off.",
            ].join(" ")
          : [
              "A previous session on this change failed and left no state.",
              "The workspace may have partial changes. Continue the work.",
            ].join(" ");

        deps.updateActiveChangeStatus(session.sessionId, "executing", "Continuing after failure");

        const worker = poolWorkerForChange(activeChange, deps.pool);
        if (worker && deps.pool.refreshSetup) {
          try {
            await deps.pool.refreshSetup(worker, repo);
          } catch (err) {
            deps.updateActiveChangeStatus(session.sessionId, "failed");
            return { success: false, error: `Workspace setup failed: ${errorMessage(err)}` };
          }
        }

        const result = await deps.executeChange({
          plan: {
            branchName: activeChange.branch,
            description: activeChange.description,
            targetRepo: activeChange.repo,
          },
          worktree,
          request: {
            userId: session.userId,
            message: firstUserMessage(session).text,
            triggerType: session.triggerType ?? "reactions",
            channel: session.channelId,
            messageTs: session.threadTs,
          },
          sessionId: session.sessionId,
          onEvent,
          sdkSessionId: activeChange.sdkSessionId,
          abortController,
          onHandle: captureHandle,
          resumeContext,
        });
        return settleRecoveryResult(deps, session.sessionId, activeChange, result);
      }

      case "restart": {
        if (!repo) {
          return { success: false, error: `Repository ${activeChange.repo} not found` };
        }
        const worker = poolWorkerForChange(activeChange, deps.pool);
        if (!worker) {
          return { success: false, error: "No workspace is bound to this change to reset." };
        }

        deps.updateActiveChangeStatus(session.sessionId, "executing", "Starting over from scratch");

        try {
          await deps.forceResetBranch(worker, repo, activeChange.branch);
          if (deps.pool.refreshSetup) {
            await deps.pool.refreshSetup(worker, repo);
          }
        } catch (err) {
          deps.updateActiveChangeStatus(session.sessionId, "failed");
          return { success: false, error: `Failed to reset workspace: ${errorMessage(err)}` };
        }

        // Fresh run: the prior SDK session's context describes the scrapped attempt.
        activeChange.sdkSessionId = undefined;

        const result = await deps.executeChange({
          plan: {
            branchName: activeChange.branch,
            description: activeChange.description,
            targetRepo: activeChange.repo,
          },
          worktree,
          request: {
            userId: session.userId,
            message: firstUserMessage(session).text,
            triggerType: session.triggerType ?? "reactions",
            channel: session.channelId,
            messageTs: session.threadTs,
          },
          sessionId: session.sessionId,
          onEvent,
          abortController,
          onHandle: captureHandle,
        });
        return settleRecoveryResult(deps, session.sessionId, activeChange, result);
      }
    }
  } finally {
    activeChange.handle = undefined;
  }
}
