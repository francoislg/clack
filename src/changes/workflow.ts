import { getConfig, findRepoByName } from "../config.js";
import { createWorktree, getExistingWorktree, type WorktreeInfo } from "../worktrees.js";
import type {
  ChangeRequest,
  ChangePlan,
  ChangeResult,
  ChangeStatus,
  FollowUpCommand,
  ExecutionResult,
} from "./types.js";
import type { ExecuteChangeOptions } from "./execution.js";
import type { ToolBuildContext } from "../tools/types.js";
import type { SessionContext } from "../sessions.js";
import { getSession } from "../sessions.js";
import type { ActiveChangeState } from "./activeState.js";
import {
  getActiveChange,
  setActiveChange,
  clearActiveChange,
  getActiveChangeForUser,
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
  mcpServers: { clack: object };
  onEvent?: (event: StreamEvent) => void | Promise<void>;
  abortController?: AbortController;
  timeout?: number;
  resumeSessionId?: string;
  onSessionId?: (id: string) => void;
}

interface WorkerContextParams {
  worktreePath: string;
  branchName: string;
  repoName: string;
  repoUrl: string;
  channelId: string;
  threadTs: string;
  sessionId: string;
  config: AppConfig;
}

interface ClackToolsResult {
  mcpServer: object;
}

export interface WorkflowDeps {
  getConfig: () => AppConfig;
  findRepoByName: (name: string, config: AppConfig) => RepositoryConfig | undefined;
  createWorktree: (repo: RepositoryConfig, branch: string) => Promise<WorktreeInfo>;
  getExistingWorktree: (repo: RepositoryConfig, branch: string) => WorktreeInfo | null;
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
  updateActiveChangeStatus: (sessionId: string, status: ChangeStatus) => void;
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
  buildWorkerContext: (params: WorkerContextParams) => ToolBuildContext;
  buildClackTools: (context: ToolBuildContext) => ClackToolsResult;
  fetchPRReviewContext: (
    prUrl: string,
  ) => Promise<{ ok: true; context: string } | { ok: false; error: string }>;
  getSession: (sessionId: string) => Promise<SessionContext | null>;
}

export const defaultWorkflowDeps: WorkflowDeps = {
  getConfig,
  findRepoByName,
  createWorktree,
  getExistingWorktree,
  getActiveChange,
  setActiveChange,
  clearActiveChange,
  getActiveChangeForUser,
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
};

// ============================================================================
// Main Workflow Orchestration
// ============================================================================

/**
 * Start a new change request workflow.
 * Attaches an activeChange to the existing unified thread session.
 */
export async function startChangeWorkflow(
  request: ChangeRequest,
  plan: ChangePlan,
  sessionId: string,
  onEvent?: (event: StreamEvent) => void | Promise<void>,
  deps: WorkflowDeps = defaultWorkflowDeps,
): Promise<ChangeResult> {
  const config = deps.getConfig();

  // Check if user already has an active session
  const existingChange = deps.getActiveChangeForUser(request.userId);
  if (existingChange) {
    return {
      success: false,
      error: `You already have an active change request. Check your existing thread or wait for it to complete.`,
    };
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
  };
  deps.setActiveChange(sessionId, activeChange, {
    userId: request.userId,
    channelId: request.channel,
    threadTs: request.messageTs,
    triggerType: request.triggerType,
  });

  // Check for existing worktree (from a previous failed/interrupted attempt)
  let worktree: WorktreeInfo;
  let resumeContext: string | undefined;

  const existingWorktree = deps.getExistingWorktree(repo, plan.branchName);
  if (existingWorktree) {
    // Check if there's a persisted session state we can resume
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
    worktree = existingWorktree;
  } else {
    try {
      worktree = await deps.createWorktree(repo, plan.branchName);
      // Run worktree setup for fresh worktrees only.
      // Forward onEvent so setup tool calls keep the stream alive.
      await deps.runWorktreeSetup(repo.name, worktree.worktreePath, plan.branchName, onEvent);
    } catch (err) {
      // Release the slot on failure
      deps.clearActiveChange(sessionId);
      return {
        success: false,
        error: `Failed to create workspace: ${errorMessage(err)}`,
      };
    }
  }

  // Now that the worktree exists, attach it to the active change
  activeChange.worktree = worktree;

  // Phase 2: Execution
  const abortController = new AbortController();
  activeChange.abortController = abortController;

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
    });
  } catch (error) {
    deps.appendExecutionLog(plan.branchName, `Execution error: ${errorMessage(error)}`);
    execResult = {
      success: false,
      error: `Execution threw exception: ${errorMessage(error)}`,
    };
  } finally {
    activeChange.abortController = undefined;
  }

  // Store SDK session ID for resuming follow-ups
  if (execResult.sdkSessionId) {
    const ac = deps.getActiveChange(sessionId);
    if (ac) ac.sdkSessionId = execResult.sdkSessionId;
  }

  if (!execResult.success) {
    if (activeChange.cancelledBy) {
      deps.updateActiveChangeStatus(sessionId, "cancelled");
      return {
        success: false,
        cancelled: true,
        cancelledBy: activeChange.cancelledBy,
        error: execResult.error ?? "Execution cancelled",
      };
    }
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
): Promise<ChangeResult> {
  const activeChange = session.activeChange;
  if (!activeChange) {
    return { success: false, error: "No active change in this thread." };
  }

  if (!activeChange.worktree) {
    return { success: false, error: "No worktree exists for this change." };
  }

  // Guard: only allow follow-ups when the change is idle (PR exists, no work in progress)
  const terminalStatuses: ChangeStatus[] = ["completed", "failed", "cancelled"];
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

  const config = deps.getConfig();
  const repo = deps.findRepoByName(activeChange.repo, config);

  activeChange.lastActivityAt = new Date();

  // Create an AbortController for cancellation support
  const abortController = new AbortController();
  activeChange.abortController = abortController;

  // Build worker context for this command
  const workerCtx = deps.buildWorkerContext({
    worktreePath: activeChange.worktree.worktreePath,
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
          cwd: activeChange.worktree.worktreePath,
          systemPrompt,
          allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
          disallowedTools: ["Task"],
          branchName: activeChange.branch,
          mcpServers: { clack: workerTools.mcpServer },
          onEvent,
          abortController,
          resumeSessionId: activeChange.sdkSessionId,
          onSessionId: (id: string) => {
            activeChange.sdkSessionId = id;
          },
        });

        if (result.success) {
          deps.updateActiveChangeStatus(session.sessionId, "pr_created");
          return { success: true, summary: "Review feedback addressed" };
        }
        if (activeChange.cancelledBy) {
          deps.updateActiveChangeStatus(session.sessionId, "cancelled");
          return {
            success: false,
            cancelled: true,
            cancelledBy: activeChange.cancelledBy,
            error: result.error ?? "Review cancelled",
          };
        }
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
          message: additionalInstructions ?? session.originalQuestion,
          triggerType: session.triggerType ?? "reactions",
          channel: session.channelId,
          messageTs: session.threadTs,
        };

        const updateResult = await deps.executeChange({
          plan,
          worktree: activeChange.worktree,
          request: updateRequest,
          sessionId: session.sessionId,
          onEvent,
          sdkSessionId: activeChange.sdkSessionId,
          abortController,
        });

        // Store SDK session ID for future follow-ups
        if (updateResult.sdkSessionId) {
          activeChange.sdkSessionId = updateResult.sdkSessionId;
        }

        if (!updateResult.success) {
          if (activeChange.cancelledBy) {
            deps.updateActiveChangeStatus(session.sessionId, "cancelled");
            return {
              success: false,
              cancelled: true,
              cancelledBy: activeChange.cancelledBy,
              error: updateResult.error ?? "Update cancelled",
            };
          }
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
          cwd: activeChange.worktree.worktreePath,
          allowedTools: [],
          disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
          timeout: 2,
          branchName: activeChange.branch,
          mcpServers: { clack: workerTools.mcpServer },
          onEvent,
          abortController,
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

        if (activeChange.cancelledBy) {
          deps.updateActiveChangeStatus(session.sessionId, "cancelled");
          return {
            success: false,
            cancelled: true,
            cancelledBy: activeChange.cancelledBy,
            error: result.error ?? "Merge cancelled",
          };
        }
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
          cwd: activeChange.worktree.worktreePath,
          allowedTools: [],
          disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
          timeout: 2,
          branchName: activeChange.branch,
          mcpServers: { clack: workerTools.mcpServer },
          onEvent,
          abortController,
        });

        // Check if close succeeded by reading session state
        const updatedSession = await deps.getSession(session.sessionId);
        if (!updatedSession?.activeChange || updatedSession.activeChange.status === "completed") {
          return {
            success: true,
            summary: "PR closed",
          };
        }

        if (activeChange.cancelledBy) {
          deps.updateActiveChangeStatus(session.sessionId, "cancelled");
          return {
            success: false,
            cancelled: true,
            cancelledBy: activeChange.cancelledBy,
            error: result.error ?? "Close cancelled",
          };
        }
        return {
          success: false,
          error: result.error ?? "Close failed",
        };
      }
    }
  } finally {
    activeChange.abortController = undefined;
  }
}
