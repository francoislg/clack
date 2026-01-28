import { getConfig } from "../config.js";
import { createWorktree, getExistingWorktree, removeWorktree, deleteBranch, type WorktreeInfo } from "../worktrees.js";
import type {
  ChangeRequest,
  ChangePlan,
  ChangeResult,
  ChangeSession,
  FollowUpCommand,
} from "./types.js";
import {
  createSession,
  getActiveSessionCount,
  getActiveSessionForUser,
  updateSessionStatus,
  updateSessionPrUrl,
  removeSession,
} from "./session.js";
import { writeSessionState, appendExecutionLog, readSessionState } from "./persistence.js";
import { findRepoByName } from "./detection.js";
import { executeChange, resolvePRInstructions, runClaude } from "./execution.js";
import { createPR, mergePR, closePR, reviewPR } from "./pr.js";

// ============================================================================
// Main Workflow Orchestration
// ============================================================================

/**
 * Start a new change request workflow with a pre-determined plan from Claude.
 * The plan (branch name, description, target repo) is now provided by Claude's
 * change detection in askClaude() rather than a separate planning phase.
 */
export async function startChangeWorkflow(
  request: ChangeRequest,
  plan: ChangePlan,
  threadTs: string,
  onProgress: (message: string) => Promise<void>
): Promise<ChangeResult> {
  const config = getConfig();

  // Check concurrency limits
  const maxConcurrent = config.changesWorkflow?.maxConcurrent ?? 3;
  if (getActiveSessionCount() >= maxConcurrent) {
    return {
      success: false,
      error: `System is at capacity (${maxConcurrent} concurrent changes). Please try again later.`,
    };
  }

  // Check if user already has an active session
  const existingSession = getActiveSessionForUser(request.userId);
  if (existingSession) {
    return {
      success: false,
      error: `You already have an active change request. Check your existing thread or wait for it to complete.`,
    };
  }

  await onProgress(`Planning: ${plan.description}`);

  // Find target repo
  const repo = findRepoByName(plan.targetRepo, config);
  if (!repo) {
    return {
      success: false,
      error: `Repository ${plan.targetRepo} not found`,
    };
  }

  // Check for existing worktree (from a previous failed/interrupted attempt)
  await onProgress("Setting up workspace...");
  let worktree: WorktreeInfo;
  let resumeContext: string | undefined;

  const existingWorktree = getExistingWorktree(repo, plan.branchName);
  if (existingWorktree) {
    // Check if there's a persisted session state we can resume
    const existingState = readSessionState(plan.branchName);
    if (existingState) {
      await onProgress(`Resuming existing workspace (was: ${existingState.phase})...`);
      appendExecutionLog(plan.branchName, `Resuming from existing worktree (previous status: ${existingState.status})`);
      resumeContext = `Previous session was in "${existingState.phase}" phase. Last message: "${existingState.lastMessage}"`;
    } else {
      await onProgress("Reusing existing workspace...");
      appendExecutionLog(plan.branchName, "Reusing existing worktree (no previous state)");
      resumeContext = "A previous session started but left no state. The workspace may have partial changes.";
    }
    worktree = existingWorktree;
  } else {
    try {
      worktree = await createWorktree(repo, plan.branchName);
    } catch (err) {
      return {
        success: false,
        error: `Failed to create workspace: ${err}`,
      };
    }
  }

  // Create session
  const session = createSession(request, plan, worktree, threadTs);

  // Phase 2: Execution
  await onProgress("Implementing changes...");
  const prInstructions = resolvePRInstructions(worktree.worktreePath, repo, config);

  // Track last update time to throttle Slack updates
  let lastUpdateTime = 0;
  const UPDATE_INTERVAL_MS = 30000; // 30 seconds

  let execResult;
  try {
    execResult = await executeChange(
      plan,
      worktree,
      request,
      prInstructions,
      async (progressMsg) => {
        const now = Date.now();
        if (now - lastUpdateTime >= UPDATE_INTERVAL_MS) {
          lastUpdateTime = now;
          await onProgress(`Implementing changes...\n_${progressMsg}_`);

          // Also update persisted state
          writeSessionState(session, progressMsg);
        }
      },
      resumeContext
    );
  } catch (error) {
    appendExecutionLog(plan.branchName, `Execution error: ${error}`);
    execResult = {
      success: false,
      error: `Execution threw exception: ${error}`,
    };
  }

  if (!execResult.success) {
    updateSessionStatus(session.id, "failed");
    return {
      success: false,
      error: execResult.error ?? "Execution failed",
    };
  }

  // Create PR
  await onProgress("Creating pull request...");
  const prResult = await createPR(worktree, plan, execResult.summary ?? "");

  if (!prResult.success || !prResult.prUrl) {
    updateSessionStatus(session.id, "failed");
    return {
      success: false,
      error: prResult.error ?? "Failed to create PR",
    };
  }

  updateSessionPrUrl(session.id, prResult.prUrl);
  updateSessionStatus(session.id, "pr_created");

  return {
    success: true,
    prUrl: prResult.prUrl,
    summary: execResult.summary,
  };
}

/**
 * Handle a follow-up command in a change thread
 */
export async function handleFollowUp(
  session: ChangeSession,
  command: FollowUpCommand,
  additionalInstructions?: string,
  onProgress?: (message: string) => Promise<void>
): Promise<ChangeResult> {
  const config = getConfig();
  const repo = findRepoByName(session.plan.targetRepo, config);

  session.lastActivityAt = new Date();

  switch (command) {
    case "review": {
      await onProgress?.("Reviewing PR comments...");
      updateSessionStatus(session.id, "reviewing");

      const reviewResult = await reviewPR(session);
      if (!reviewResult.success) {
        return { success: false, error: reviewResult.error };
      }

      updateSessionStatus(session.id, "pr_created");
      return {
        success: true,
        summary: `Addressed ${reviewResult.commentsAddressed ?? 0} review comments`,
      };
    }

    case "merge": {
      await onProgress?.("Merging PR...");
      updateSessionStatus(session.id, "merging");

      const mergeStrategy = repo?.mergeStrategy ?? "squash";
      const mergeResult = await mergePR(
        session.prUrl!,
        session.worktree.worktreePath,
        mergeStrategy
      );

      if (!mergeResult.success) {
        updateSessionStatus(session.id, "pr_created");
        return { success: false, error: mergeResult.error };
      }

      // Claude handled remote branch cleanup, now clean up local worktree
      updateSessionStatus(session.id, "completed");
      await removeWorktree(session.worktree.repoName, session.worktree.worktreePath);
      await deleteBranch(session.worktree.repoName, session.plan.branchName);
      removeSession(session.id);

      return {
        success: true,
        prUrl: session.prUrl,
        summary: `PR merged. ${mergeResult.cleanupSummary ?? ""}`.trim(),
      };
    }

    case "close": {
      await onProgress?.("Closing PR...");

      // For close, we keep the remote branch by default - user can request deletion
      // by saying "close and delete branch" or similar
      const deleteBranchRequested = additionalInstructions
        ? /delete\s*(the\s*)?(remote\s*)?branch/i.test(additionalInstructions)
        : false;

      const closeResult = await closePR(
        session.prUrl!,
        session.worktree.worktreePath,
        deleteBranchRequested
      );
      if (!closeResult.success) {
        return { success: false, error: closeResult.error };
      }

      // Clean up local worktree
      updateSessionStatus(session.id, "completed");
      await removeWorktree(session.worktree.repoName, session.worktree.worktreePath);
      await deleteBranch(session.worktree.repoName, session.plan.branchName);
      removeSession(session.id);

      const branchNote = deleteBranchRequested
        ? ""
        : " Remote branch kept - reply 'delete branch' to remove it.";

      return {
        success: true,
        summary: `PR closed. ${closeResult.cleanupSummary ?? ""}${branchNote}`.trim(),
      };
    }

    case "update": {
      await onProgress?.("Implementing additional changes...");
      updateSessionStatus(session.id, "executing");

      const prInstructions = repo
        ? resolvePRInstructions(session.worktree.worktreePath, repo, config)
        : "";

      // Track last update time to throttle Slack updates
      let lastUpdateTime = 0;
      const UPDATE_INTERVAL_MS = 30000; // 30 seconds

      const updateResult = await executeChange(
        { ...session.plan, description: additionalInstructions ?? session.plan.description },
        session.worktree,
        { ...session.request, message: additionalInstructions ?? session.request.message },
        prInstructions,
        async (progressMsg) => {
          const now = Date.now();
          if (now - lastUpdateTime >= UPDATE_INTERVAL_MS) {
            lastUpdateTime = now;
            await onProgress?.(`Implementing additional changes...\n_${progressMsg}_`);
            writeSessionState(session, progressMsg);
          }
        }
      );

      if (!updateResult.success) {
        updateSessionStatus(session.id, "pr_created");
        return { success: false, error: updateResult.error };
      }

      // Push updates
      await runClaude({
        prompt: "Push the new commits: git push\nOutput PUSH_SUCCESS if successful.",
        cwd: session.worktree.worktreePath,
        allowedTools: ["Bash"],
        timeout: 2,
        branchName: session.plan.branchName,
      });

      updateSessionStatus(session.id, "pr_created");
      return {
        success: true,
        prUrl: session.prUrl,
        summary: updateResult.summary ?? "Additional changes pushed",
      };
    }
  }
}
