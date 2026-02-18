import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ToolContext } from "../types.js";
import { getVisibleRepos, canWriteRepo } from "../../repoAccess.js";

export function createListRepositoriesTool(ctx: ToolContext) {
  return tool(
    "list_repositories",
    "List repositories you have access to, with their descriptions and whether you can propose code changes.",
    {
      includeChangeSupport: z
        .boolean()
        .optional()
        .describe("Include whether each repo supports the changes workflow (default: true)"),
    },
    async (args) => {
      const visible = getVisibleRepos(ctx.role, ctx.config.repositories);
      const repos = visible.map((r) => ({
        name: r.name,
        description: r.description,
        ...(args.includeChangeSupport !== false && { canChange: canWriteRepo(ctx.role, r) }),
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(repos, null, 2) }],
      };
    }
  );
}
