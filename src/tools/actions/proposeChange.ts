import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { getExistingWorktree } from "../../worktrees.js";
import { readSessionState } from "../../changes/persistence.js";
import { canWriteRepo, getWritableRepos } from "../../repoAccess.js";

const BRANCH_PATTERN = /^clack\/(fix|feat|refactor|docs|chore)\/.+$/;
const BRANCH_TYPES = ["fix", "feat", "refactor", "docs", "chore"];

export function createProposeChangeTool(
  ctx: QueryToolContext,
  intentStore: IntentStore,
  recorder: ToolCallRecorder,
) {
  return tool(
    "propose_change",
    "Propose a code change. Validates branch name, repo, and checks for existing worktrees. Returns a ref ID to use in submit_response.",
    {
      branch: z
        .string()
        .describe(
          `Branch name following convention: clack/{type}/{name} where type is one of: ${BRANCH_TYPES.join(", ")}`,
        ),
      description: z.string().describe("Brief description of the change to make"),
      repo: z.string().describe("Repository name to make the change in"),
    },
    async (args) => {
      const argsRecord = args as Record<string, unknown>;

      // Validate branch convention
      if (!BRANCH_PATTERN.test(args.branch)) {
        const errMsg = `Invalid branch name "${args.branch}". Must follow convention: clack/{type}/{name} where type is one of: ${BRANCH_TYPES.join(", ")}`;
        recorder.record("propose_change", argsRecord, { error: errMsg });
        return errorResult(errMsg);
      }

      // Validate repo exists and user has write access
      const repo = ctx.config.repositories.find((r) => r.name === args.repo);
      if (!repo) {
        const availableRepos = ctx.config.repositories.map((r) => r.name);
        const errMsg = `Repository "${args.repo}" not found. Available repositories: ${availableRepos.join(", ")}`;
        recorder.record("propose_change", argsRecord, { error: errMsg });
        return errorResult(errMsg);
      }

      if (!canWriteRepo(ctx.role, repo)) {
        const writableRepos = getWritableRepos(ctx.role, ctx.config.repositories).map(
          (r) => r.name,
        );
        const errMsg = `You do not have write access to "${args.repo}".${writableRepos.length > 0 ? ` Repos you can change: ${writableRepos.join(", ")}` : " No repos have change support for your role."}`;
        recorder.record("propose_change", argsRecord, { error: errMsg });
        return errorResult(errMsg);
      }

      // Check for existing worktree
      let existingWorktreeInfo: { status: string; lastActivity: string } | undefined;
      const existingWorktree = getExistingWorktree(repo, args.branch);
      if (existingWorktree) {
        const sessionState = await readSessionState(args.branch);
        existingWorktreeInfo = {
          status: sessionState?.status ?? "unknown",
          lastActivity: sessionState?.lastActivityAt ?? existingWorktree.createdAt.toISOString(),
        };
      }

      // Stage the intent
      const ref = intentStore.stage({
        type: "change",
        branch: args.branch,
        description: args.description,
        repo: args.repo,
        existingWorktree: existingWorktreeInfo,
      });

      const result = {
        ref,
        branch: args.branch,
        description: args.description,
        repo: args.repo,
        existingWorktree: existingWorktreeInfo,
      };

      recorder.record("propose_change", argsRecord, result);

      return textResult(result);
    },
  );
}
