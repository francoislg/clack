import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ToolContext } from "../types.js";
import { getActiveWorkers } from "../../changes/session.js";

export function createFindChangesTool(_ctx: ToolContext) {
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
      let workers = getActiveWorkers();

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
