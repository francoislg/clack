import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { Octokit } from "@octokit/rest";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getOctokit, parseRepoUrl } from "../../github.js";
import { updateActiveChangePrUrl, updateActiveChangeStatus } from "../../changes/activeState.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { findRepoByName, type Config, type RepositoryConfig } from "../../config.js";
import { errorMessage } from "../../errors.js";
import type { ChangeStatus } from "../../changes/types.js";

export interface EnsurePRDeps {
  getOctokit: () => Promise<Octokit>;
  parseRepoUrl: (url: string) => { owner: string; repo: string };
  findRepoByName: (name: string, config: Config) => RepositoryConfig | undefined;
  updateActiveChangePrUrl: (sessionId: string, prUrl: string) => void;
  updateActiveChangeStatus: (sessionId: string, status: ChangeStatus) => void;
  appendExecutionLog: (branchName: string, message: string) => void;
}

export const defaultEnsurePRDeps: EnsurePRDeps = {
  getOctokit,
  parseRepoUrl,
  findRepoByName,
  updateActiveChangePrUrl,
  updateActiveChangeStatus,
  appendExecutionLog,
};

/**
 * Drop the author (case-insensitive) and any duplicates from the reviewer list, preserving
 * order. GitHub rejects the author as a reviewer and dedupes anyway, so this keeps the request
 * clean and avoids an avoidable 422.
 */
function reviewersExcludingAuthor(reviewers: string[], authorLogin: string | null | undefined) {
  const author = authorLogin?.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const login of reviewers) {
    const key = login.toLowerCase();
    if (key === author || seen.has(key)) continue;
    seen.add(key);
    out.push(login);
  }
  return out;
}

/**
 * Best-effort reviewer request, gated on `requirePRReviewers`. Returns a non-fatal warning
 * string when reviewers were expected but couldn't be requested; never throws. A no-op (returns
 * undefined) when the flag is off — the reviewers arg is ignored entirely in that case.
 */
async function requestReviewersBestEffort(args: {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullNumber: number;
  ctx: WorkerToolContext;
  reviewers: string[] | undefined;
  appendExecutionLog: EnsurePRDeps["appendExecutionLog"];
}): Promise<string | undefined> {
  const { octokit, owner, repo, pullNumber, ctx, reviewers, appendExecutionLog } = args;
  if (!ctx.requirePRReviewers) return undefined;

  const requested = reviewersExcludingAuthor(reviewers ?? [], ctx.requestingUserGithubUsername);
  if (requested.length === 0) {
    const warning =
      "requirePRReviewers is on but no reviewer could be resolved. Map Slack users to GitHub usernames with update_user so reviewers can be requested.";
    appendExecutionLog(ctx.branchName, `ensure_pr: ${warning}`);
    return warning;
  }

  try {
    await octokit.pulls.requestReviewers({
      owner,
      repo,
      pull_number: pullNumber,
      reviewers: requested,
    });
    appendExecutionLog(ctx.branchName, `ensure_pr: requested reviewers ${requested.join(", ")}`);
    return undefined;
  } catch (error) {
    const warning = `Could not request reviewers (${errorMessage(error)}). The PR was created regardless.`;
    appendExecutionLog(ctx.branchName, `ensure_pr: ${warning}`);
    return warning;
  }
}

export function createEnsurePRTool(
  ctx: WorkerToolContext,
  deps: EnsurePRDeps = defaultEnsurePRDeps,
) {
  return tool(
    "ensure_pr",
    "Create a pull request for the current branch, or return the existing PR if one is already open. Updates session state on success.",
    {
      title: z.string().describe("PR title"),
      summary: z.string().describe("Brief summary of changes for the PR body"),
      reviewers: z
        .array(z.string())
        .optional()
        .describe(
          "GitHub logins to request as reviewers, chosen by your judgement. Only honored when the workspace has requirePRReviewers enabled; otherwise ignored. The PR author is excluded automatically. Resolve unmapped reviewers via repo collaborators + update_user before passing them here.",
        ),
    },
    async (args) => {
      try {
        const config = ctx.config;
        const repo = deps.findRepoByName(ctx.repoName, config);

        if (!repo) {
          return errorResult(`Repository "${ctx.repoName}" not found in configuration.`);
        }

        const { owner, repo: repoName } = deps.parseRepoUrl(repo.url);
        const octokit = await deps.getOctokit();

        // Check for existing open PRs on this branch
        const { data: existingPRs } = await octokit.pulls.list({
          owner,
          repo: repoName,
          head: `${owner}:${ctx.branchName}`,
          state: "open",
        });

        if (existingPRs.length > 0) {
          const existingPR = existingPRs[0];
          // Update the PR title and body to reflect the latest changes
          await octokit.pulls.update({
            owner,
            repo: repoName,
            pull_number: existingPR.number,
            title: args.title,
            body: args.summary,
          });
          deps.appendExecutionLog(ctx.branchName, `ensure_pr: updated PR ${existingPR.html_url}`);
          deps.updateActiveChangePrUrl(ctx.sessionId, existingPR.html_url);
          deps.updateActiveChangeStatus(ctx.sessionId, "pr_created");

          const warning = await requestReviewersBestEffort({
            octokit,
            owner,
            repo: repoName,
            pullNumber: existingPR.number,
            ctx,
            reviewers: args.reviewers,
            appendExecutionLog: deps.appendExecutionLog,
          });

          return textResult({
            success: true,
            pr_url: existingPR.html_url,
            created: false,
            updated: true,
            ...(warning && { warning }),
          });
        }

        // Create a new PR — handle race condition where another call creates one first
        const defaultBranch = repo.branch || "main";
        let prUrl: string;
        let prNumber: number;
        let created: boolean;

        try {
          const pr = await octokit.pulls.create({
            owner,
            repo: repoName,
            title: args.title,
            body: args.summary,
            head: ctx.branchName,
            base: defaultBranch,
          });
          prUrl = pr.data.html_url;
          prNumber = pr.data.number;
          created = true;
          deps.appendExecutionLog(ctx.branchName, `ensure_pr: created PR ${prUrl}`);
        } catch (createError: unknown) {
          // GitHub returns 422 if a PR already exists for this head/base combo
          const status = (createError as { status?: number }).status;
          if (status === 422) {
            const { data: retryPRs } = await octokit.pulls.list({
              owner,
              repo: repoName,
              head: `${owner}:${ctx.branchName}`,
              state: "open",
            });
            if (retryPRs.length > 0) {
              prUrl = retryPRs[0].html_url;
              prNumber = retryPRs[0].number;
              created = false;
              deps.appendExecutionLog(
                ctx.branchName,
                `ensure_pr: PR already exists (race): ${prUrl}`,
              );
            } else {
              throw createError;
            }
          } else {
            throw createError;
          }
        }

        deps.updateActiveChangePrUrl(ctx.sessionId, prUrl);
        deps.updateActiveChangeStatus(ctx.sessionId, "pr_created");

        const warning = await requestReviewersBestEffort({
          octokit,
          owner,
          repo: repoName,
          pullNumber: prNumber,
          ctx,
          reviewers: args.reviewers,
          appendExecutionLog: deps.appendExecutionLog,
        });

        return textResult({
          success: true,
          pr_url: prUrl,
          created,
          ...(warning && { warning }),
        });
      } catch (error) {
        return errorResult(`Failed to ensure PR: ${errorMessage(error)}`);
      }
    },
  );
}
