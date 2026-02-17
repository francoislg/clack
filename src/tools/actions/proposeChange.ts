import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ToolContext } from "../types.js";
import type { IntentStore, ToolCallRecorder } from "../server.js";
import { getExistingWorktree } from "../../worktrees.js";
import { readSessionState } from "../../changes/persistence.js";

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

      // Validate repo exists and supports changes
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

      if (!repo.supportsChanges) {
        const changeRepos = ctx.config.repositories
          .filter((r) => r.supportsChanges)
          .map((r) => r.name);
        const errorResult = {
          error: `Repository "${args.repo}" does not support changes.${changeRepos.length > 0 ? ` Repos with change support: ${changeRepos.join(", ")}` : " No repos have change support enabled."}`,
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
