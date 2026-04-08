import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getActiveWorkers, type ActiveWorker } from "../../changes/activeState.js";
import { getVisibleRepos } from "../../repoAccess.js";
import type { UserRole } from "../../roles.js";
import type { RepositoryConfig } from "../../config.js";

export interface FindChangesDeps {
  getActiveWorkers: () => ActiveWorker[];
  getVisibleRepos: (role: UserRole, repos: RepositoryConfig[]) => RepositoryConfig[];
}

export const defaultDeps: FindChangesDeps = {
  getActiveWorkers,
  getVisibleRepos,
};

export function createFindChangesTool(ctx: QueryToolContext, deps: FindChangesDeps = defaultDeps) {
  return tool(
    "find_changes",
    "Find active change sessions (currently in-progress). These are changes being executed, reviewed, or merged right now.",
    {
      repo: z.string().optional().describe("Filter by repository name"),
      status: z
        .enum([
          "planning",
          "executing",
          "pr_created",
          "reviewing",
          "merging",
          "completed",
          "failed",
          "cancelled",
        ])
        .optional()
        .describe("Filter by status"),
    },
    async (args) => {
      const visibleRepoNames = new Set(
        deps.getVisibleRepos(ctx.role, ctx.config.repositories).map((r) => r.name),
      );
      let workers = deps.getActiveWorkers().filter((w) => visibleRepoNames.has(w.repo));

      if (args.repo) {
        workers = workers.filter((w) => w.repo === args.repo);
      }
      if (args.status) {
        workers = workers.filter((w) => w.status === args.status);
      }

      const result = workers.map((w) => ({
        id: w.id,
        branch: w.branch,
        repo: w.repo,
        description: w.description,
        status: w.status,
        prUrl: w.prUrl,
        startedAt: w.startedAt.toISOString(),
      }));

      return textResult(result);
    },
  );
}
