import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { getActiveWorkers } from "../../sessions.js";
import { getVisibleRepos } from "../../repoAccess.js";

export function createFindChangesTool(ctx: QueryToolContext) {
  return tool(
    "find_changes",
    "Find active change sessions (currently in-progress). These are changes being executed, reviewed, or merged right now.",
    {
      repo: z.string().optional().describe("Filter by repository name"),
      status: z
        .enum(["planning", "executing", "reviewing", "merging", "completed", "failed"])
        .optional()
        .describe("Filter by status"),
    },
    async (args) => {
      const visibleRepoNames = new Set(
        getVisibleRepos(ctx.role, ctx.config.repositories).map((r) => r.name)
      );
      let workers = getActiveWorkers().filter((w) => visibleRepoNames.has(w.repo));

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

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
