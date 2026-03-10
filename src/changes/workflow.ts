import { getConfig } from "../config.js";
import { createWorktree, getExistingWorktree, type WorktreeInfo } from "../worktrees.js";
import type {
  ChangeRequest,
  ChangePlan,
  ChangeResult,
  FollowUpCommand,
} from "./types.js";
import type { SessionContext, ActiveChangeState } from "../sessions.js";
import {
  setActiveChange,
  getActiveChangeForUser,
  updateActiveChangeStatus,
  getSession,
} from "../sessions.js";
import { appendExecutionLog, readSessionState } from "./persistence.js";
import { findRepoByName } from "./detection.js";
import { executeChange, resolveChangesInstructions, runClaudeInWorktree, runWorktreeSetup } from "./execution.js";
import { buildWorkerContext } from "../tools/context.js";
import { buildClackTools } from "../tools/server.js";
import { getOctokit, parseRepoUrl } from "../github.js";
import type { StreamEvent } from "../streaming/types.js";

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
): Promise<ChangeResult> {
  const config = getConfig();

  // Check if user already has an active session
  const existingChange = getActiveChangeForUser(request.userId);
  if (existingChange) {
    return {
      success: false,
      error: `You already have an active change request. Check your existing thread or wait for it to complete.`,
    };
  }

  // Find target repo
  const repo = findRepoByName(plan.targetRepo, config);
  if (!repo) {
    return {
      success: false,
      error: `Repository ${plan.targetRepo} not found`,
    };
  }

  // Check for existing worktree (from a previous failed/interrupted attempt)
  let worktree: WorktreeInfo;
  let resumeContext: string | undefined;

  const existingWorktree = getExistingWorktree(repo, plan.branchName);
  if (existingWorktree) {
    // Check if there's a persisted session state we can resume
    const existingState = readSessionState(plan.branchName);
    if (existingState) {
      appendExecutionLog(plan.branchName, `Resuming from existing worktree (previous status: ${existingState.status})`);
      resumeContext = `Previous session was in "${existingState.phase}" phase. Last message: "${existingState.lastMessage}"`;
    } else {
      appendExecutionLog(plan.branchName, "Reusing existing worktree (no previous state)");
      resumeContext = "A previous session started but left no state. The workspace may have partial changes.";
    }
    worktree = existingWorktree;
  } else {
    try {
      worktree = await createWorktree(repo, plan.branchName);
      // Run worktree setup for fresh worktrees only.
      // Forward onEvent so setup tool calls keep the stream alive.
      await runWorktreeSetup(repo.name, worktree.worktreePath, plan.branchName, onEvent);
    } catch (err) {
      return {
        success: false,
        error: `Failed to create workspace: ${err}`,
      };
    }
  }

  // Attach activeChange to the unified session
  const activeChange: ActiveChangeState = {
    branch: plan.branchName,
    repo: plan.targetRepo,
    description: plan.description,
    worktree,
    status: "executing",
    startedAt: new Date(),
    lastActivityAt: new Date(),
  };
  setActiveChange(sessionId, activeChange);

  // Phase 2: Execution
  let execResult;
  try {
    execResult = await executeChange(
      plan,
      worktree,
      request,
      sessionId,
      resumeContext,
      onEvent,
    );
  } catch (error) {
    appendExecutionLog(plan.branchName, `Execution error: ${error}`);
    execResult = {
      success: false,
      error: `Execution threw exception: ${error}`,
    };
  }

  if (!execResult.success) {
    updateActiveChangeStatus(sessionId, "failed");
    return {
      success: false,
      error: execResult.error ?? "Execution failed",
    };
  }

  // Read the session to check if PR was created (ensure_pr updates activeChange state).
  const updatedSession = await getSession(sessionId);
  if (updatedSession?.activeChange?.prUrl) {
    return {
      success: true,
      prUrl: updatedSession.activeChange.prUrl,
      summary: execResult.summary,
    };
  }

  // PR wasn't created but execution succeeded — partial success
  return {
    success: execResult.success,
    summary: execResult.summary,
    error: execResult.success ? "Changes committed but PR was not created. Check the thread for details." : execResult.error,
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
): Promise<ChangeResult> {
  const activeChange = session.activeChange;
  if (!activeChange) {
    return { success: false, error: "No active change in this thread." };
  }

  const config = getConfig();
  const repo = findRepoByName(activeChange.repo, config);

  activeChange.lastActivityAt = new Date();

  // Build worker context for this command
  const workerCtx = buildWorkerContext({
    worktreePath: activeChange.worktree.worktreePath,
    branchName: activeChange.branch,
    repoName: activeChange.repo,
    repoUrl: repo?.url ?? "",
    channelId: session.channelId,
    threadTs: session.threadTs,
    sessionId: session.sessionId,
    config,
  });
  const workerTools = buildClackTools(workerCtx);

  // Build prompt based on command
  let prompt: string;
  let allowedTools: string[];
  let systemPrompt: string | undefined;

  const changesInstructions = resolveChangesInstructions(activeChange.repo);

  switch (command) {
    case "review": {
      updateActiveChangeStatus(session.sessionId, "reviewing");

      // Fetch PR comments to pass as context
      let reviewContext = "";
      try {
        const { owner, repo: repoName } = parseRepoUrl(repo!.url);
        const octokit = await getOctokit();
        const prMatch = activeChange.prUrl!.match(/pull\/(\d+)/);
        const pull_number = parseInt(prMatch![1], 10);

        const [{ data: comments }, { data: reviews }] = await Promise.all([
          octokit.pulls.listReviewComments({ owner, repo: repoName, pull_number }),
          octokit.pulls.listReviews({ owner, repo: repoName, pull_number }),
        ]);

        if (reviews.length > 0) {
          reviewContext += "PR Reviews:\n";
          for (const review of reviews) {
            if (review.body) {
              reviewContext += `- ${review.user?.login ?? "unknown"} (${review.state}): ${review.body}\n`;
            }
          }
        }
        if (comments.length > 0) {
          reviewContext += "\nInline Comments:\n";
          for (const comment of comments) {
            reviewContext += `- ${comment.user?.login ?? "unknown"} on ${comment.path}:${comment.line ?? "?"}: ${comment.body}\n`;
          }
        }
        if (!reviewContext) {
          reviewContext = "No review comments or feedback found.";
        }
      } catch (error) {
        return { success: false, error: `Failed to fetch PR reviews: ${error}` };
      }

      prompt = `Address the feedback on this PR: ${activeChange.prUrl}\n\n${reviewContext}\n\n1. Read and understand each review comment\n2. Implement the requested changes\n3. Commit with a message like "Address review feedback"\n4. Push the changes using the git_push tool\n5. Report what you addressed using the report_status tool`;
      systemPrompt = changesInstructions ? `Repository-Specific Instructions:\n${changesInstructions}` : undefined;
      allowedTools = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];
      break;
    }

    case "update": {
      updateActiveChangeStatus(session.sessionId, "executing");

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

      const updateResult = await executeChange(
        plan,
        activeChange.worktree,
        updateRequest,
        session.sessionId,
        undefined,
        onEvent,
      );

      if (!updateResult.success) {
        // Revert to pr_created — the PR still exists and user can retry
        updateActiveChangeStatus(session.sessionId, "pr_created");
        return { success: false, error: updateResult.error };
      }

      // executeChange() already handles push via its MCP tools (git_push + ensure_pr + report_status)
      updateActiveChangeStatus(session.sessionId, "pr_created");
      return {
        success: true,
        prUrl: activeChange.prUrl,
        summary: updateResult.summary ?? "Additional changes pushed",
      };
    }

    case "merge": {
      updateActiveChangeStatus(session.sessionId, "merging");

      const result = await runClaudeInWorktree(activeChange.repo, {
        prompt: `Merge the pull request at ${activeChange.prUrl} using the merge_pr tool. Report the result using report_status.`,
        cwd: activeChange.worktree.worktreePath,
        allowedTools: [],
        disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
        timeout: 2,
        branchName: activeChange.branch,
        mcpServers: { clack: workerTools.mcpServer },
        onEvent,
      });

      // Check if merge succeeded by reading session state
      const updatedSession = await getSession(session.sessionId);
      if (!updatedSession?.activeChange || updatedSession.activeChange.status === "completed") {
        return {
          success: true,
          prUrl: activeChange.prUrl,
          summary: "PR merged successfully",
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

      const result = await runClaudeInWorktree(activeChange.repo, {
        prompt: `Close the pull request at ${activeChange.prUrl} using the close_pr tool${deleteBranchRequested ? " with delete_branch: true" : ""}. Report the result using report_status.`,
        cwd: activeChange.worktree.worktreePath,
        allowedTools: [],
        disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
        timeout: 2,
        branchName: activeChange.branch,
        mcpServers: { clack: workerTools.mcpServer },
        onEvent,
      });

      // Check if close succeeded by reading session state
      const updatedSession = await getSession(session.sessionId);
      if (!updatedSession?.activeChange || updatedSession.activeChange.status === "completed") {
        return {
          success: true,
          summary: "PR closed",
        };
      }

      return {
        success: false,
        error: result.error ?? "Close failed",
      };
    }
  }

  // For review, execute the Claude invocation
  const result = await runClaudeInWorktree(activeChange.repo, {
    prompt,
    cwd: activeChange.worktree.worktreePath,
    systemPrompt,
    allowedTools,
    disallowedTools: ["Task"],
    branchName: activeChange.branch,
    mcpServers: { clack: workerTools.mcpServer },
    onEvent,
  });

  updateActiveChangeStatus(session.sessionId, "pr_created");
  return {
    success: result.success,
    summary: result.success ? "Review feedback addressed" : undefined,
    error: result.success ? undefined : (result.error ?? "Review failed"),
  };
}
