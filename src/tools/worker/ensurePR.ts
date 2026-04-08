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

          return textResult({
            success: true,
            pr_url: existingPR.html_url,
            created: false,
            updated: true,
          });
        }

        // Create a new PR — handle race condition where another call creates one first
        const defaultBranch = repo.branch || "main";
        let prUrl: string;
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

        return textResult({
          success: true,
          pr_url: prUrl,
          created,
        });
      } catch (error) {
        return errorResult(`Failed to ensure PR: ${errorMessage(error)}`);
      }
    },
  );
}
