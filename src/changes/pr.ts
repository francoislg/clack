import { getOctokit } from "../github.js";
import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";

// ============================================================================
// PR URL Parsing
// ============================================================================

export interface ParsedPrUrl {
  owner: string;
  repo: string;
  pullNumber: number;
}

/**
 * Extract owner, repo, and pull number from a GitHub PR URL.
 * Returns null if the URL doesn't match the expected pattern.
 */
export function parsePrUrl(url: string): ParsedPrUrl | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;

  const [, owner, repo, pullNumberStr] = match;
  return { owner, repo, pullNumber: parseInt(pullNumberStr, 10) };
}

// ============================================================================
// PR Status
// ============================================================================

export type PRState = "OPEN" | "MERGED" | "CLOSED";

/**
 * Fetch review comments and reviews for a PR, formatted as context for Claude.
 */
export async function fetchPRReviewContext(prUrl: string): Promise<{ ok: true; context: string } | { ok: false; error: string }> {
  try {
    const parsed = parsePrUrl(prUrl);
    if (!parsed) {
      return { ok: false, error: `Invalid PR URL: ${prUrl}` };
    }
    const { owner, repo, pullNumber: pull_number } = parsed;
    const octokit = await getOctokit();

    const [{ data: comments }, { data: reviews }] = await Promise.all([
      octokit.pulls.listReviewComments({ owner, repo, pull_number }),
      octokit.pulls.listReviews({ owner, repo, pull_number }),
    ]);

    let context = "";
    if (reviews.length > 0) {
      context += "PR Reviews:\n";
      for (const review of reviews) {
        if (review.body) {
          context += `- ${review.user?.login ?? "unknown"} (${review.state}): ${review.body}\n`;
        }
      }
    }
    if (comments.length > 0) {
      context += "\nInline Comments:\n";
      for (const comment of comments) {
        context += `- ${comment.user?.login ?? "unknown"} on ${comment.path}:${comment.line ?? "?"}: ${comment.body}\n`;
      }
    }
    if (!context) {
      context = "No review comments or feedback found.";
    }

    return { ok: true, context };
  } catch (error) {
    return { ok: false, error: `Failed to fetch PR reviews: ${errorMessage(error)}` };
  }
}

/**
 * Get the current status of a PR using the GitHub API.
 * Returns null on error.
 */
export async function getPRStatus(prUrl: string): Promise<{ state: PRState } | null> {
  try {
    const parsed = parsePrUrl(prUrl);
    if (!parsed) {
      logger.debug(`Invalid PR URL: ${prUrl}`);
      return null;
    }
    const { owner, repo, pullNumber: pull_number } = parsed;
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
    logger.debug(`Failed to get PR status for ${prUrl}: ${errorMessage(error)}`);
    return null;
  }
}
