import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { getOctokit } from "../../github.js";
import { getActiveSession, updateSessionStatus, removeSession } from "../../changes/session.js";
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

        // Get session
        const session = getActiveSession(ctx.sessionId);
        if (!session) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No active session found", details: `Session ${ctx.sessionId} not found` }),
            }],
            isError: true,
          };
        }

        if (!session.prUrl) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "No PR URL found", details: "This session has no associated pull request" }),
            }],
            isError: true,
          };
        }

        // Parse PR URL
        const prMatch = session.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (!prMatch) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ success: false, error: "Invalid PR URL", details: `Could not parse PR URL: ${session.prUrl}` }),
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

        appendExecutionLog(ctx.branchName, `PR merged via ${mergeStrategy}: ${session.prUrl}`);

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
        updateSessionStatus(ctx.sessionId, "completed");
        await removeWorktree(ctx.repoName, ctx.worktreePath);
        await deleteBranch(ctx.repoName, ctx.branchName);
        removeSession(ctx.sessionId);

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
