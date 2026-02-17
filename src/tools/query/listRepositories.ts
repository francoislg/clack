import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ToolContext } from "../types.js";

export function createListRepositoriesTool(ctx: ToolContext) {
  return tool(
    "list_repositories",
    "List all configured repositories with their descriptions and whether they support code changes.",
    {
      includeChangeSupport: z
        .boolean()
        .optional()
        .describe("Include whether each repo supports the changes workflow (default: true)"),
    },
    async (args) => {
      const repos = ctx.config.repositories.map((r) => ({
        name: r.name,
        description: r.description,
        ...(args.includeChangeSupport !== false && { supportsChanges: r.supportsChanges ?? false }),
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(repos, null, 2) }],
      };
    }
  );
}
