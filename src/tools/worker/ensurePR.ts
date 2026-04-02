import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getOctokit, parseRepoUrl } from "../../github.js";
import { updateActiveChangePrUrl, updateActiveChangeStatus } from "../../changes/activeState.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { findRepoByName } from "../../config.js";
import { errorMessage } from "../../errors.js";

export function createEnsurePRTool(ctx: WorkerToolContext) {
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
        const repo = findRepoByName(ctx.repoName, config);

        if (!repo) {
          return errorResult(`Repository "${ctx.repoName}" not found in configuration.`);
        }

        const { owner, repo: repoName } = parseRepoUrl(repo.url);
        const octokit = await getOctokit();

        // Check for existing open PRs on this branch
        const { data: existingPRs } = await octokit.pulls.list({
          owner,
          repo: repoName,
          head: `${owner}:${ctx.branchName}`,
          state: "open",
        });

        if (existingPRs.length > 0) {
          updateActiveChangePrUrl(ctx.sessionId, existingPRs[0].html_url);
          updateActiveChangeStatus(ctx.sessionId, "pr_created");

          return textResult({
            success: true,
            pr_url: existingPRs[0].html_url,
            created: false,
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
          appendExecutionLog(ctx.branchName, `ensure_pr: created PR ${prUrl}`);
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
              appendExecutionLog(ctx.branchName, `ensure_pr: PR already exists (race): ${prUrl}`);
            } else {
              throw createError;
            }
          } else {
            throw createError;
          }
        }

        updateActiveChangePrUrl(ctx.sessionId, prUrl);
        updateActiveChangeStatus(ctx.sessionId, "pr_created");

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
