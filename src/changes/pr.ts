import { simpleGit } from "simple-git";
import { getConfig } from "../config.js";
import { getOctokit, parseRepoUrl, getAuthenticatedCloneUrl } from "../github.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { ChangePlan, ChangeSession } from "./types.js";
import { runClaude, resolvePRTemplate, resolvePRInstructions } from "./execution.js";
import { findRepoByName } from "./detection.js";
import { logger } from "../logger.js";

// ============================================================================
// PR Status
// ============================================================================

export type PRState = "OPEN" | "MERGED" | "CLOSED";

/**
 * Extract owner, repo, and pull number from a GitHub PR URL.
 */
function parsePRUrl(prUrl: string): { owner: string; repo: string; pull_number: number } {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    throw new Error(`Invalid PR URL: ${prUrl}`);
  }
  return { owner: match[1], repo: match[2], pull_number: parseInt(match[3], 10) };
}

/**
 * Get the current status of a PR using the GitHub API.
 * Returns null on error.
 */
export async function getPRStatus(prUrl: string): Promise<{ state: PRState } | null> {
  try {
    const { owner, repo, pull_number } = parsePRUrl(prUrl);
    const octokit = await getOctokit();
    const { data } = await octokit.pulls.get({ owner, repo, pull_number });

    if (data.merged) {
      return { state: "MERGED" };
    }
    if (data.state === "closed") {
      return { state: "CLOSED" };
    }
    return { state: "OPEN" };
  } catch (error) {
    logger.debug(`Failed to get PR status for ${prUrl}: ${error}`);
    return null;
  }
}

// ============================================================================
// PR Operations
// ============================================================================

/**
 * Create a PR using the GitHub API.
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

  // Set authenticated remote and push the branch
  const authenticatedUrl = await getAuthenticatedCloneUrl(repo.url);
  const git = simpleGit({ baseDir: worktree.worktreePath });
  await git.remote(["set-url", "origin", authenticatedUrl]);

  try {
    await git.push(["-u", "origin", plan.branchName]);
  } catch (pushError) {
    return {
      success: false,
      error: `Failed to push branch: ${pushError}`,
    };
  }

  // Get PR template and instructions for Claude to generate the PR body
  const template = resolvePRTemplate(worktree.worktreePath);
  const prInstructions = resolvePRInstructions(worktree.worktreePath, repo, config);

  // Use Claude to generate a good PR body from the template
  const prBodyResult = await runClaude({
    prompt: `Generate a pull request body based on this template:
${template}

Fill it in with:
- Summary: ${summary}
- Description of what was changed

Output ONLY the filled-in PR body (markdown), nothing else.`,
    cwd: worktree.worktreePath,
    systemPrompt: prInstructions ? `PR Guidelines:\n${prInstructions}` : undefined,
    allowedTools: ["Read", "Glob", "Grep"],
    disallowedTools: ["Write", "Edit", "Bash", "Task"],
    timeout: 2,
  });

  const prBody = prBodyResult.success && prBodyResult.text
    ? prBodyResult.text
    : summary;

  // Create PR via Octokit
  try {
    const { owner, repo: repoName } = parseRepoUrl(repo.url);
    const octokit = await getOctokit();
    const defaultBranch = repo.branch || "main";

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo: repoName,
      title: plan.description.substring(0, 72),
      body: prBody,
      head: plan.branchName,
      base: defaultBranch,
    });

    return { success: true, prUrl: pr.html_url };
  } catch (createError) {
    return {
      success: false,
      error: `Failed to create PR: ${createError}`,
    };
  }
}

/**
 * Merge a PR using the GitHub API.
 */
export async function mergePR(
  prUrl: string,
  _worktreePath: string,
  mergeStrategy: "squash" | "merge" | "rebase" = "squash"
): Promise<{ success: boolean; cleanupSummary?: string; error?: string }> {
  try {
    const { owner, repo, pull_number } = parsePRUrl(prUrl);
    const octokit = await getOctokit();

    // Get the PR to find the branch name
    const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number });
    const branchName = pr.head.ref;

    // Merge the PR
    await octokit.pulls.merge({
      owner,
      repo,
      pull_number,
      merge_method: mergeStrategy,
    });

    // Delete the remote branch
    let cleanupAction = "Merged successfully";
    try {
      await octokit.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
      });
      cleanupAction = `Merged and deleted remote branch ${branchName}`;
    } catch (deleteError) {
      logger.warn(`Failed to delete remote branch ${branchName}: ${deleteError}`);
      cleanupAction = `Merged (branch ${branchName} kept — could not delete)`;
    }

    return { success: true, cleanupSummary: cleanupAction };
  } catch (error) {
    return {
      success: false,
      error: `Merge failed: ${error}`,
    };
  }
}

/**
 * Close a PR without merging using the GitHub API.
 */
export async function closePR(
  prUrl: string,
  _worktreePath: string,
  deleteRemoteBranch: boolean = false
): Promise<{ success: boolean; cleanupSummary?: string; error?: string }> {
  try {
    const { owner, repo, pull_number } = parsePRUrl(prUrl);
    const octokit = await getOctokit();

    // Get the PR to find the branch name
    const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number });
    const branchName = pr.head.ref;

    // Close the PR
    await octokit.pulls.update({
      owner,
      repo,
      pull_number,
      state: "closed",
    });

    let cleanupAction = "PR closed";

    if (deleteRemoteBranch) {
      try {
        await octokit.git.deleteRef({
          owner,
          repo,
          ref: `heads/${branchName}`,
        });
        cleanupAction = `PR closed and remote branch ${branchName} deleted`;
      } catch (deleteError) {
        logger.warn(`Failed to delete remote branch ${branchName}: ${deleteError}`);
        cleanupAction = `PR closed (branch ${branchName} kept — could not delete)`;
      }
    }

    return { success: true, cleanupSummary: cleanupAction };
  } catch (error) {
    return {
      success: false,
      error: `Close failed: ${error}`,
    };
  }
}

/**
 * Fetch and address PR review comments using the GitHub API.
 */
export async function reviewPR(
  session: ChangeSession
): Promise<{ success: boolean; commentsAddressed?: number; error?: string }> {
  if (!session.prUrl) {
    return { success: false, error: "No PR URL in session" };
  }

  // Fetch PR comments and reviews via Octokit
  let reviewContext = "";
  try {
    const { owner, repo, pull_number } = parsePRUrl(session.prUrl);
    const octokit = await getOctokit();

    const [{ data: comments }, { data: reviews }] = await Promise.all([
      octokit.pulls.listReviewComments({ owner, repo, pull_number }),
      octokit.pulls.listReviews({ owner, repo, pull_number }),
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

  // Refresh remote auth for push
  const config = getConfig();
  const repo = findRepoByName(session.plan.targetRepo, config);
  if (repo) {
    const authenticatedUrl = await getAuthenticatedCloneUrl(repo.url);
    const git = simpleGit({ baseDir: session.worktree.worktreePath });
    await git.remote(["set-url", "origin", authenticatedUrl]);
  }

  const reviewPrompt = `Address the feedback on this PR: ${session.prUrl}

${reviewContext}

1. Read and understand each review comment
2. Implement the requested changes
3. Commit with a message like "Address review feedback"
4. Push the changes

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
