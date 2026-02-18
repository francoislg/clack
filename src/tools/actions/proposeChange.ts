import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";
import { getExistingWorktree } from "../../worktrees.js";
import { readSessionState } from "../../changes/persistence.js";
import { canWriteRepo, getWritableRepos } from "../../repoAccess.js";

const BRANCH_PATTERN = /^clack\/(fix|feat|refactor|docs|chore)\/.+$/;
const BRANCH_TYPES = ["fix", "feat", "refactor", "docs", "chore"];

export function createProposeChangeTool(
  ctx: ToolContext,
  intentStore: IntentStore,
  recorder: ToolCallRecorder
) {
  return tool(
    "propose_change",
    "Propose a code change. Validates branch name, repo, and checks for existing worktrees. Returns a ref ID to use in submit_response.",
    {
      branch: z
        .string()
        .describe(
          `Branch name following convention: clack/{type}/{name} where type is one of: ${BRANCH_TYPES.join(", ")}`
        ),
      description: z.string().describe("Brief description of the change to make"),
      repo: z.string().describe("Repository name to make the change in"),
    },
    async (args) => {
      const result: Record<string, unknown> = {};

      // Validate branch convention
      if (!BRANCH_PATTERN.test(args.branch)) {
        const errorResult = {
          error: `Invalid branch name "${args.branch}". Must follow convention: clack/{type}/{name} where type is one of: ${BRANCH_TYPES.join(", ")}`,
        };
        recorder.record("propose_change", args as Record<string, unknown>, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      // Validate repo exists and user has write access
      const repo = ctx.config.repositories.find((r) => r.name === args.repo);
      if (!repo) {
        const availableRepos = ctx.config.repositories.map((r) => r.name);
        const errorResult = {
          error: `Repository "${args.repo}" not found. Available repositories: ${availableRepos.join(", ")}`,
        };
        recorder.record("propose_change", args as Record<string, unknown>, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      if (!canWriteRepo(ctx.role, repo)) {
        const writableRepos = getWritableRepos(ctx.role, ctx.config.repositories).map((r) => r.name);
        const errorResult = {
          error: `You do not have write access to "${args.repo}".${writableRepos.length > 0 ? ` Repos you can change: ${writableRepos.join(", ")}` : " No repos have change support for your role."}`,
        };
        recorder.record("propose_change", args as Record<string, unknown>, errorResult);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(errorResult) }],
          isError: true,
        };
      }

      // Check for existing worktree
      const existingWorktree = getExistingWorktree(repo, args.branch);
      if (existingWorktree) {
        const sessionState = readSessionState(args.branch);
        result.existingWorktree = {
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
        existingWorktree: result.existingWorktree as
          | { status: string; lastActivity: string }
          | undefined,
      });

      result.ref = ref;
      result.branch = args.branch;
      result.description = args.description;
      result.repo = args.repo;

      recorder.record("propose_change", args as Record<string, unknown>, result);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
