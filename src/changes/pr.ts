import { getOctokit } from "../github.js";
import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";

// ============================================================================
// Dependency Injection
// ============================================================================

export interface PrDeps {
  getOctokit: typeof getOctokit;
}

export const defaultPrDeps: PrDeps = {
  getOctokit,
};

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
export async function fetchPRReviewContext(
  prUrl: string,
  deps: PrDeps = defaultPrDeps,
): Promise<{ ok: true; context: string } | { ok: false; error: string }> {
  try {
    const parsed = parsePrUrl(prUrl);
    if (!parsed) {
      return { ok: false, error: `Invalid PR URL: ${prUrl}` };
    }
    const { owner, repo, pullNumber: pull_number } = parsed;
    const octokit = await deps.getOctokit();

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

// ============================================================================
// CI Check Runs
// ============================================================================

export interface CheckRunSummary {
  name: string;
  conclusion: string | null;
  detailsUrl: string | null;
}

export type CIChecksStatus = "all_passed" | "some_failed" | "in_progress" | "no_checks";

export interface CIChecksSnapshot {
  status: CIChecksStatus;
  /** Check runs that completed with a non-passing conclusion. */
  failedChecks: CheckRunSummary[];
  /** Names of check runs that are still queued or in progress. */
  pendingChecks: string[];
}

/** Conclusions that count as a pass (the run completed without failing). */
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

export interface CheckRunInput {
  name: string;
  status: string;
  conclusion: string | null;
  details_url?: string | null;
  html_url?: string | null;
}

/** Classify a set of GitHub check-runs into a single CI snapshot. */
export function classifyCheckRuns(runs: CheckRunInput[]): CIChecksSnapshot {
  const failedChecks: CheckRunSummary[] = [];
  const pendingChecks: string[] = [];
  for (const run of runs) {
    if (run.status !== "completed") {
      pendingChecks.push(run.name);
      continue;
    }
    if (run.conclusion && PASSING_CONCLUSIONS.has(run.conclusion)) {
      continue;
    }
    failedChecks.push({
      name: run.name,
      conclusion: run.conclusion,
      detailsUrl: run.details_url ?? run.html_url ?? null,
    });
  }

  let status: CIChecksStatus;
  if (failedChecks.length > 0) {
    status = "some_failed";
  } else if (pendingChecks.length > 0) {
    status = "in_progress";
  } else if (runs.length === 0) {
    status = "no_checks";
  } else {
    status = "all_passed";
  }

  return { status, failedChecks, pendingChecks };
}

/**
 * Fetch a one-shot snapshot of CI check-runs for a PR's head commit.
 * Resolves the PR head SHA, lists its check runs, and classifies them.
 * Returns null on error (caller decides how to treat an unreadable snapshot).
 */
export async function getPRChecks(
  prUrl: string,
  deps: PrDeps = defaultPrDeps,
): Promise<CIChecksSnapshot | null> {
  try {
    const parsed = parsePrUrl(prUrl);
    if (!parsed) {
      logger.debug(`Invalid PR URL: ${prUrl}`);
      return null;
    }
    const { owner, repo, pullNumber: pull_number } = parsed;
    const octokit = await deps.getOctokit();

    const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number });
    const ref = pr.head.sha;

    const { data } = await octokit.checks.listForRef({ owner, repo, ref, per_page: 100 });
    return classifyCheckRuns(data.check_runs);
  } catch (error) {
    logger.debug(`Failed to get PR checks for ${prUrl}: ${errorMessage(error)}`);
    return null;
  }
}

/**
 * Get the current status of a PR using the GitHub API.
 * Returns null on error.
 */
export async function getPRStatus(
  prUrl: string,
  deps: PrDeps = defaultPrDeps,
): Promise<{ state: PRState } | null> {
  try {
    const parsed = parsePrUrl(prUrl);
    if (!parsed) {
      logger.debug(`Invalid PR URL: ${prUrl}`);
      return null;
    }
    const { owner, repo, pullNumber: pull_number } = parsed;
    const octokit = await deps.getOctokit();
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
