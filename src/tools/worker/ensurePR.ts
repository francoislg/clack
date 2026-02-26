import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { getOctokit, parseRepoUrl } from "../../github.js";
import { updateActiveChangePrUrl, updateActiveChangeStatus } from "../../sessions.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { findRepoByName } from "../../changes/detection.js";

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
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: `Repository "${ctx.repoName}" not found in configuration.`,
              }),
            }],
            isError: true,
          };
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

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                pr_url: existingPRs[0].html_url,
                created: false,
              }),
            }],
          };
        }

        // Create a new PR
        const defaultBranch = repo.branch || "main";
        const pr = await octokit.pulls.create({
          owner,
          repo: repoName,
          title: args.title,
          body: args.summary,
          head: ctx.branchName,
          base: defaultBranch,
        });

        updateActiveChangePrUrl(ctx.sessionId, pr.data.html_url);
        updateActiveChangeStatus(ctx.sessionId, "pr_created");
        appendExecutionLog(ctx.branchName, `ensure_pr: created PR ${pr.data.html_url}`);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              pr_url: pr.data.html_url,
              created: true,
            }),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: `Failed to ensure PR: ${error}`,
            }),
          }],
          isError: true,
        };
      }
    }
  );
}
