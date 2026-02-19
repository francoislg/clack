import { getOctokit } from "../github.js";
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
