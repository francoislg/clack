import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { getOctokit } from "../../github.js";
import { getSession, updateActiveChangeStatus, clearActiveChange } from "../../sessions.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { removeWorktree, deleteBranch as deleteLocalBranch } from "../../worktrees.js";

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
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ error: "No active change found for this session." }),
            }],
            isError: true,
          };
        }

        if (!activeChange.prUrl) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ error: "No PR URL found for this change." }),
            }],
            isError: true,
          };
        }

        const prMatch = activeChange.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (!prMatch) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ error: `Could not parse PR URL: ${activeChange.prUrl}` }),
            }],
            isError: true,
          };
        }

        const [, owner, repoName, pullNumberStr] = prMatch;
        const pull_number = parseInt(pullNumberStr, 10);

        const octokit = await getOctokit();

        // Close the PR without merging
        await octokit.pulls.update({
          owner,
          repo: repoName,
          pull_number,
          state: "closed",
        });

        appendExecutionLog(ctx.branchName, `close_pr: closed PR ${activeChange.prUrl}`);

        // Optionally delete the remote branch via GitHub API
        let branchDeleteWarning: string | undefined;
        if (args.delete_branch) {
          try {
            await octokit.git.deleteRef({
              owner,
              repo: repoName,
              ref: `heads/${ctx.branchName}`,
            });
            appendExecutionLog(ctx.branchName, `close_pr: deleted remote branch ${ctx.branchName}`);
          } catch (error) {
            branchDeleteWarning = `Failed to delete remote branch: ${error instanceof Error ? error.message : String(error)}`;
            appendExecutionLog(ctx.branchName, `close_pr: warning - ${branchDeleteWarning}`);
          }
        }

        // Cleanup: update status, remove worktree and local branch, clear activeChange
        updateActiveChangeStatus(ctx.sessionId, "completed");
        await removeWorktree(ctx.repoName, ctx.worktreePath);
        await deleteLocalBranch(ctx.repoName, ctx.branchName);
        clearActiveChange(ctx.sessionId, true);

        appendExecutionLog(ctx.branchName, "close_pr: cleanup complete");

        const result: Record<string, unknown> = {
          success: true,
          branch_deleted: args.delete_branch ? !branchDeleteWarning : false,
        };

        if (branchDeleteWarning) {
          result.warning = branchDeleteWarning;
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result),
          }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: `Failed to close PR: ${errorMessage}` }),
          }],
          isError: true,
        };
      }
    }
  );
}
