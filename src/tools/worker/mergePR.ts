import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { getOctokit } from "../../github.js";
import { getSession, updateActiveChangeStatus, clearActiveChange } from "../../sessions.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { removeWorktree, deleteBranch } from "../../worktrees.js";
import { findRepoByName } from "../../changes/detection.js";

export function createMergePRTool(ctx: WorkerToolContext) {
  return tool(
    "merge_pr",
    "Merge the pull request for this change session. Handles merge, remote branch deletion, and local cleanup.",
    {
      _placeholder: z.boolean().optional().describe("Unused parameter"),
    },
    async () => {
      try {
        // Get session and active change
        const session = await getSession(ctx.sessionId);
        const activeChange = session?.activeChange;

        if (!session || !activeChange) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No active change found", details: `Session ${ctx.sessionId} has no active change` }),
            }],
            isError: true,
          };
        }

        if (!activeChange.prUrl) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No PR URL found", details: "This change has no associated pull request" }),
            }],
            isError: true,
          };
        }

        // Parse PR URL
        const prMatch = activeChange.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (!prMatch) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "Invalid PR URL", details: `Could not parse PR URL: ${activeChange.prUrl}` }),
            }],
            isError: true,
          };
        }

        const [, owner, repoName, pullNumberStr] = prMatch;
        const pull_number = parseInt(pullNumberStr, 10);

        // Get merge strategy from repo config
        const repo = findRepoByName(ctx.repoName, ctx.config);
        const mergeStrategy = repo?.mergeStrategy ?? "squash";

        // Merge the PR
        const octokit = await getOctokit();
        await octokit.pulls.merge({
          owner,
          repo: repoName,
          pull_number,
          merge_method: mergeStrategy,
        });

        appendExecutionLog(ctx.branchName, `PR merged via ${mergeStrategy}: ${activeChange.prUrl}`);

        // Try to delete the remote branch
        let warning: string | undefined;
        try {
          await octokit.git.deleteRef({
            owner,
            repo: repoName,
            ref: `heads/${ctx.branchName}`,
          });
          appendExecutionLog(ctx.branchName, `Deleted remote branch: ${ctx.branchName}`);
        } catch (deleteError) {
          const deleteMessage = deleteError instanceof Error ? deleteError.message : String(deleteError);
          warning = `Failed to delete remote branch ${ctx.branchName}: ${deleteMessage}`;
          appendExecutionLog(ctx.branchName, warning);
        }

        // Cleanup local resources
        updateActiveChangeStatus(ctx.sessionId, "completed");
        await removeWorktree(ctx.repoName, ctx.worktreePath);
        await deleteBranch(ctx.repoName, ctx.branchName);
        clearActiveChange(ctx.sessionId, true);

        const result: Record<string, unknown> = {
          success: true,
          merge_method: mergeStrategy,
        };
        if (warning) {
          result.warning = warning;
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ success: false, error: "merge failed", details: errorMessage }),
          }],
          isError: true,
        };
      }
    }
  );
}
