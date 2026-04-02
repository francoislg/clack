import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import type { UsersCache } from "../../slack/usersCache.js";

export function createFindUserTool(ctx: QueryToolContext, usersCache: UsersCache) {
  return tool(
    "find_user",
    "Search for Slack workspace members by user ID, username, or display name. Supports multiple search terms (results are unioned). Matching is case-insensitive substring by default. Use * as a wildcard (e.g., 'Mi*' matches 'Mike', 'Michael'; '*sen' matches 'Jensen').",
    {
      query: z
        .array(z.string())
        .describe("One or more search terms to match against userId, username, or displayName"),
      limit: z.number().optional().describe("Maximum number of results to return (default: 10)"),
    },
    async (args) => {
      const results = await usersCache.search(args.query, args.limit ?? 10);
      const total = results.length;

      return textResult({
        users: results,
        total,
        truncated: total >= (args.limit ?? 10),
      });
    },
  );
}
