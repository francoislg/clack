import { getConfig } from "../config.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { ChangePlan, ChangeSession } from "./types.js";
import { runClaude, resolvePRTemplate, resolvePRInstructions } from "./execution.js";
import { findRepoByName } from "./detection.js";

// ============================================================================
// PR Operations
// ============================================================================

/**
 * Create a PR using gh CLI
 */
export async function createPR(
  worktree: WorktreeInfo,
  plan: ChangePlan,
  summary: string
): Promise<{ success: boolean; prUrl?: string; error?: string }> {
  const config = getConfig();
  const repo = findRepoByName(plan.targetRepo, config);
  if (!repo) {
    return { success: false, error: `Repository ${plan.targetRepo} not found` };
  }

  // First push the branch
  const pushResult = await runClaude({
    prompt: `Run this command to push the branch:
git push -u origin ${plan.branchName}

Output only "PUSH_SUCCESS" if successful, or the error message if it fails.`,
    cwd: worktree.worktreePath,
    allowedTools: ["Bash"],
    disallowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Task"],
    timeout: 2,
  });

  if (!pushResult.success || !pushResult.text.includes("PUSH_SUCCESS")) {
    return {
      success: false,
      error: `Failed to push branch: ${pushResult.error ?? pushResult.text}`,
    };
  }

  // Get PR template
  const template = resolvePRTemplate(worktree.worktreePath);
  const prInstructions = resolvePRInstructions(worktree.worktreePath, repo, config);

  // Create PR using gh CLI
  const prPrompt = `Create a pull request with:
- Title: ${plan.description.substring(0, 72)}
- Body based on this template:
${template}

Fill in the template with:
- Summary: ${summary}
- Description of what was changed

Use this command:
gh pr create --title "..." --body "..."

Output only the PR URL on a line starting with "PR_URL:" if successful.`;

  const prResult = await runClaude({
    prompt: prPrompt,
    cwd: worktree.worktreePath,
    systemPrompt: prInstructions ? `PR Guidelines:\n${prInstructions}` : undefined,
    allowedTools: ["Bash"],
    disallowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Task"],
    timeout: 2,
  });

  const prUrlMatch = prResult.text.match(/PR_URL:\s*(https:\/\/\S+)/i);
  if (prUrlMatch) {
    return { success: true, prUrl: prUrlMatch[1] };
  }

  // Try to extract URL from gh output
  const ghUrlMatch = prResult.text.match(/(https:\/\/github\.com\/[^\s]+\/pull\/\d+)/);
  if (ghUrlMatch) {
    return { success: true, prUrl: ghUrlMatch[1] };
  }

  return {
    success: false,
    error: `Failed to create PR: ${prResult.error ?? "Could not find PR URL in output"}`,
  };
}

/**
 * Merge a PR using gh CLI - Claude decides about cleanup
 */
export async function mergePR(
  prUrl: string,
  worktreePath: string,
  mergeStrategy: "squash" | "merge" | "rebase" = "squash"
): Promise<{ success: boolean; cleanupSummary?: string; error?: string }> {
  const strategyFlag = `--${mergeStrategy}`;

  const result = await runClaude({
    prompt: `Merge this PR: ${prUrl}

1. Merge the PR using: gh pr merge "${prUrl}" ${strategyFlag}

2. After merging, decide whether to delete the remote branch:
   - If this was a typical feature/fix, delete the branch: git push origin --delete <branch-name>
   - If there's reason to keep it (ongoing work, reference needed), leave it

3. Output your decision and result in this format:
   MERGE_SUCCESS
   CLEANUP_ACTION: <what you did with the branch - deleted or kept and why>`,
    cwd: worktreePath,
    allowedTools: ["Bash"],
    disallowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Task"],
    timeout: 3,
  });

  if (result.text.includes("MERGE_SUCCESS")) {
    const cleanupMatch = result.text.match(/CLEANUP_ACTION:\s*(.+?)(?:\n|$)/i);
    return {
      success: true,
      cleanupSummary: cleanupMatch?.[1] ?? "Merged successfully",
    };
  }

  return {
    success: false,
    error: result.error ?? "Merge failed",
  };
}

/**
 * Close a PR without merging - Claude asks about cleanup
 */
export async function closePR(
  prUrl: string,
  worktreePath: string,
  deleteRemoteBranch: boolean = false
): Promise<{ success: boolean; cleanupSummary?: string; error?: string }> {
  const result = await runClaude({
    prompt: `Close this PR without merging: ${prUrl}

1. Close the PR: gh pr close "${prUrl}"

2. ${deleteRemoteBranch
      ? `Delete the remote branch since user requested it: git push origin --delete <branch-name>`
      : `Keep the remote branch for now - user can delete it later if needed`}

3. Output your result:
   CLOSE_SUCCESS
   CLEANUP_ACTION: <what you did with the branch>`,
    cwd: worktreePath,
    allowedTools: ["Bash"],
    disallowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Task"],
    timeout: 2,
  });

  if (result.text.includes("CLOSE_SUCCESS")) {
    const cleanupMatch = result.text.match(/CLEANUP_ACTION:\s*(.+?)(?:\n|$)/i);
    return {
      success: true,
      cleanupSummary: cleanupMatch?.[1] ?? "PR closed",
    };
  }

  return {
    success: false,
    error: result.error ?? "Close failed",
  };
}

/**
 * Fetch and address PR review comments
 */
export async function reviewPR(
  session: ChangeSession
): Promise<{ success: boolean; commentsAddressed?: number; error?: string }> {
  if (!session.prUrl) {
    return { success: false, error: "No PR URL in session" };
  }

  const reviewPrompt = `Review and address feedback on this PR: ${session.prUrl}

1. First, fetch the PR comments:
   gh pr view "${session.prUrl}" --comments --json comments,reviews

2. Read and understand each review comment
3. Implement the requested changes
4. Commit with a message like "Address review feedback"
5. Push the changes

Output "COMMENTS_ADDRESSED: N" where N is the number of comments you addressed.`;

  const result = await runClaude({
    prompt: reviewPrompt,
    cwd: session.worktree.worktreePath,
    allowedTools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash"],
    disallowedTools: ["Task"],
    branchName: session.plan.branchName,
  });

  const countMatch = result.text.match(/COMMENTS_ADDRESSED:\s*(\d+)/i);
  if (countMatch) {
    return { success: true, commentsAddressed: parseInt(countMatch[1], 10) };
  }

  if (result.success) {
    return { success: true, commentsAddressed: 0 };
  }

  return {
    success: false,
    error: result.error ?? "Review failed",
  };
}
