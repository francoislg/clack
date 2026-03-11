import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getOctokit } from "../../github.js";
import { getSession } from "../../sessions.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { errorMessage } from "../../errors.js";
import { parsePrUrl, cleanupAfterPrAction } from "./prHelpers.js";

export function createClosePRTool(ctx: WorkerToolContext) {
  return tool(
    "close_pr",
    "Close the pull request without merging. Optionally deletes the remote branch.",
    {
      delete_branch: z.boolean().optional().describe("Whether to also delete the remote branch"),
    },
    async (args) => {
      try {
        const session = await getSession(ctx.sessionId);
        const activeChange = session?.activeChange;

        if (!session || !activeChange) {
          return errorResult("No active change found for this session.");
        }

        if (!activeChange.prUrl) {
          return errorResult("No PR URL found for this change.");
        }

        const parsed = parsePrUrl(activeChange.prUrl);
        if (!parsed) {
          return errorResult(`Could not parse PR URL: ${activeChange.prUrl}`);
        }

        const { owner, repo, pullNumber } = parsed;
        const octokit = await getOctokit();

        // Close the PR without merging
        await octokit.pulls.update({
          owner,
          repo,
          pull_number: pullNumber,
          state: "closed",
        });

        appendExecutionLog(ctx.branchName, `close_pr: closed PR ${activeChange.prUrl}`);

        // Optionally delete the remote branch via GitHub API
        let branchDeleteWarning: string | undefined;
        if (args.delete_branch) {
          try {
            await octokit.git.deleteRef({
              owner,
              repo,
              ref: `heads/${ctx.branchName}`,
            });
            appendExecutionLog(ctx.branchName, `close_pr: deleted remote branch ${ctx.branchName}`);
          } catch (error) {
            branchDeleteWarning = `Failed to delete remote branch: ${errorMessage(error)}`;
            appendExecutionLog(ctx.branchName, `close_pr: warning - ${branchDeleteWarning}`);
          }
        }

        // Cleanup: update status, remove worktree and local branch, clear activeChange
        await cleanupAfterPrAction(ctx, "close_pr");

        const result: Record<string, unknown> = {
          success: true,
          branch_deleted: args.delete_branch ? !branchDeleteWarning : false,
        };

        if (branchDeleteWarning) {
          result.warning = branchDeleteWarning;
        }

        return textResult(result);
      } catch (error) {
        return errorResult(`Failed to close PR: ${errorMessage(error)}`);
      }
    }
  );
}
