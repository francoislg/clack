import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getAuthenticatedCloneUrl } from "../../github.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { errorMessage } from "../../errors.js";
import { simpleGit } from "simple-git";

export function createGitPushTool(ctx: WorkerToolContext) {
  return tool(
    "git_push",
    "Push the current branch to the remote origin. Returns success or a structured error if the push fails (e.g., hook failure, auth error).",
    {
      // Claude Agent SDK requires at least one schema property
      _placeholder: z.boolean().optional().describe("Unused parameter"),
    },
    async () => {
      try {
        const authenticatedUrl = await getAuthenticatedCloneUrl(ctx.repoUrl);
        const git = simpleGit({ baseDir: ctx.worktreePath });
        await git.remote(["set-url", "origin", authenticatedUrl]);
        await git.push(["-u", "origin", ctx.branchName]);

        appendExecutionLog(ctx.branchName, "git_push: pushed successfully");

        return textResult({ success: true });
      } catch (error) {
        const msg = errorMessage(error);
        appendExecutionLog(ctx.branchName, `git_push: failed - ${msg}`);

        return errorResult(`push failed: ${msg}`);
      }
    }
  );
}
