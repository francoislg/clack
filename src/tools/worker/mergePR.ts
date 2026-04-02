import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getOctokit } from "../../github.js";
import { getSession } from "../../sessions.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { findRepoByName } from "../../config.js";
import { errorMessage } from "../../errors.js";
import { parsePrUrl } from "../../changes/pr.js";
import { cleanupAfterPRAction } from "./prHelpers.js";

export function createMergePRTool(ctx: WorkerToolContext) {
  return tool(
    "merge_pr",
    "Merge the pull request for this change session. Handles merge, remote branch deletion, and local cleanup.",
    {
      // Claude Agent SDK requires at least one schema property
      _placeholder: z.boolean().optional().describe("Unused parameter"),
    },
    async () => {
      try {
        // Get session and active change
        const session = await getSession(ctx.sessionId);
        const activeChange = session?.activeChange;

        if (!session || !activeChange) {
          return errorResult(`No active change found for session ${ctx.sessionId}`);
        }

        if (!activeChange.prUrl) {
          return errorResult("No PR URL found — this change has no associated pull request");
        }

        const parsed = parsePrUrl(activeChange.prUrl);
        if (!parsed) {
          return errorResult(`Could not parse PR URL: ${activeChange.prUrl}`);
        }

        const { owner, repo, pullNumber } = parsed;

        // Get merge strategy from repo config
        const repoConfig = findRepoByName(ctx.repoName, ctx.config);
        const mergeStrategy = repoConfig?.mergeStrategy ?? "squash";

        // Merge the PR
        const octokit = await getOctokit();
        await octokit.pulls.merge({
          owner,
          repo,
          pull_number: pullNumber,
          merge_method: mergeStrategy,
        });

        appendExecutionLog(ctx.branchName, `PR merged via ${mergeStrategy}: ${activeChange.prUrl}`);

        // Try to delete the remote branch
        let warning: string | undefined;
        try {
          await octokit.git.deleteRef({
            owner,
            repo,
            ref: `heads/${ctx.branchName}`,
          });
          appendExecutionLog(ctx.branchName, `Deleted remote branch: ${ctx.branchName}`);
        } catch (deleteError) {
          const deleteMsg = errorMessage(deleteError);
          warning = `Failed to delete remote branch ${ctx.branchName}: ${deleteMsg}`;
          appendExecutionLog(ctx.branchName, warning);
        }

        // Cleanup local resources
        await cleanupAfterPRAction(ctx, "merge_pr");

        const result: Record<string, unknown> = {
          success: true,
          merge_method: mergeStrategy,
        };
        if (warning) {
          result.warning = warning;
        }

        return textResult(result);
      } catch (error) {
        return errorResult(`merge failed: ${errorMessage(error)}`);
      }
    },
  );
}
