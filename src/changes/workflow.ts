import { getConfig } from "../config.js";
import { createWorktree, getExistingWorktree, type WorktreeInfo } from "../worktrees.js";
import type {
  ChangeRequest,
  ChangePlan,
  ChangeResult,
  ChangeSession,
  FollowUpCommand,
} from "./types.js";
import {
  createSession,
  getActiveSession,
  getActiveSessionCount,
  getActiveSessionForUser,
  updateSessionStatus,
} from "./session.js";
import { appendExecutionLog, readSessionState } from "./persistence.js";
import { findRepoByName } from "./detection.js";
import { executeChange, resolveChangesInstructions, runClaudeInWorktree, runWorktreeSetup } from "./execution.js";
import { buildWorkerContext } from "../tools/context.js";
import { buildClackTools } from "../tools/server.js";
import { getOctokit, parseRepoUrl } from "../github.js";

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
      // Run worktree setup for fresh worktrees only
      await runWorktreeSetup(repo.name, worktree.worktreePath, plan.branchName);
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
  let execResult;
  try {
    execResult = await executeChange(
      plan,
      worktree,
      request,
      session.id,
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

  // The ensure_pr tool updates session state during execution.
  // Read the session to check if PR was created.
  const updatedSession = getActiveSession(session.id);
  if (updatedSession?.prUrl) {
    return {
      success: true,
      prUrl: updatedSession.prUrl,
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
 * Handle a follow-up command in a change thread
 */
export async function handleFollowUp(
  session: ChangeSession,
  command: FollowUpCommand,
  additionalInstructions?: string,
): Promise<ChangeResult> {
  const config = getConfig();
  const repo = findRepoByName(session.plan.targetRepo, config);

  session.lastActivityAt = new Date();

  // Build worker context for this command
  const workerCtx = buildWorkerContext({
    worktreePath: session.worktree.worktreePath,
    branchName: session.plan.branchName,
    repoName: session.plan.targetRepo,
    repoUrl: repo?.url ?? "",
    channelId: session.channel,
    threadTs: session.threadTs,
    sessionId: session.id,
    config,
  });
  const workerTools = buildClackTools(workerCtx);

  // Build prompt based on command
  let prompt: string;
  let allowedTools: string[];
  let systemPrompt: string | undefined;

  const changesInstructions = resolveChangesInstructions(session.plan.targetRepo);

  switch (command) {
    case "review": {
      updateSessionStatus(session.id, "reviewing");

      // Fetch PR comments to pass as context
      let reviewContext = "";
      try {
        const { owner, repo: repoName } = parseRepoUrl(repo!.url);
        const octokit = await getOctokit();
        const prMatch = session.prUrl!.match(/pull\/(\d+)/);
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

      prompt = `Address the feedback on this PR: ${session.prUrl}\n\n${reviewContext}\n\n1. Read and understand each review comment\n2. Implement the requested changes\n3. Commit with a message like "Address review feedback"\n4. Push the changes using the git_push tool\n5. Report what you addressed using the report_status tool`;
      systemPrompt = changesInstructions ? `Repository-Specific Instructions:\n${changesInstructions}` : undefined;
      allowedTools = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];
      break;
    }

    case "update": {
      updateSessionStatus(session.id, "executing");

      const updateResult = await executeChange(
        { ...session.plan, description: additionalInstructions ?? session.plan.description },
        session.worktree,
        { ...session.request, message: additionalInstructions ?? session.request.message },
        session.id,
      );

      if (!updateResult.success) {
        // Revert to pr_created — the PR still exists and user can retry
        updateSessionStatus(session.id, "pr_created");
        return { success: false, error: updateResult.error };
      }

      // executeChange() already handles push via its MCP tools (git_push + ensure_pr + report_status)
      updateSessionStatus(session.id, "pr_created");
      return {
        success: true,
        prUrl: session.prUrl,
        summary: updateResult.summary ?? "Additional changes pushed",
      };
    }

    case "merge": {
      updateSessionStatus(session.id, "merging");

      const result = await runClaudeInWorktree(session.plan.targetRepo, {
        prompt: `Merge the pull request at ${session.prUrl} using the merge_pr tool. Report the result using report_status.`,
        cwd: session.worktree.worktreePath,
        allowedTools: [],
        disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
        timeout: 2,
        branchName: session.plan.branchName,
        mcpServers: { clack: workerTools.mcpServer },
      });

      // Check if merge succeeded by reading session state
      const updatedSession = getActiveSession(session.id);
      if (!updatedSession || updatedSession.status === "completed") {
        return {
          success: true,
          prUrl: session.prUrl,
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

      const result = await runClaudeInWorktree(session.plan.targetRepo, {
        prompt: `Close the pull request at ${session.prUrl} using the close_pr tool${deleteBranchRequested ? " with delete_branch: true" : ""}. Report the result using report_status.`,
        cwd: session.worktree.worktreePath,
        allowedTools: [],
        disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
        timeout: 2,
        branchName: session.plan.branchName,
        mcpServers: { clack: workerTools.mcpServer },
      });

      // Check if close succeeded by reading session state
      const updatedSession = getActiveSession(session.id);
      if (!updatedSession || updatedSession.status === "completed") {
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
  const result = await runClaudeInWorktree(session.plan.targetRepo, {
    prompt,
    cwd: session.worktree.worktreePath,
    systemPrompt,
    allowedTools,
    disallowedTools: ["Task"],
    branchName: session.plan.branchName,
    mcpServers: { clack: workerTools.mcpServer },
  });

  updateSessionStatus(session.id, "pr_created");
  return {
    success: result.success,
    summary: result.success ? "Review feedback addressed" : undefined,
    error: result.success ? undefined : (result.error ?? "Review failed"),
  };
}
