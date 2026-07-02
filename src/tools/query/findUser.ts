import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { meetsMinimumRole } from "../../permissions.js";
import type { UsersCache } from "../../slack/usersCache.js";

export function createFindUserTool(ctx: QueryToolContext, usersCache: UsersCache) {
  return tool(
    "find_user",
    "Search for Slack workspace members by user ID, username, or display name — the source of truth for teammate identity. Supports multiple search terms (results are unioned). Matching is case-insensitive substring by default. Use * as a wildcard (e.g., 'Mi*' matches 'Mike', 'Michael'; '*sen' matches 'Jensen'). Each result includes the member's public profile picture URL (avatarUrl, usable as an image tool's input_image_url) and, when mapped, their `github` identity. Paginate with `offset`; the response reports `totalCount` (all matches) and `hasMore`. Pass `includePluginData` (e.g. [\"trivia\"]) to project plugin-held per-user data (dev+ only; ignored for lower roles).",
    {
      query: z
        .array(z.string())
        .describe("One or more search terms to match against userId, username, or displayName"),
      limit: z.number().optional().describe("Maximum number of results per page (default: 10)"),
      offset: z
        .number()
        .optional()
        .describe("Number of matches to skip for pagination (default: 0)"),
      includePluginData: z
        .array(z.string())
        .optional()
        .describe(
          'Plugin namespaces to include on each result (e.g. ["trivia"]). Requires dev role or higher; ignored otherwise.',
        ),
    },
    async (args) => {
      const offset = Math.max(0, args.offset ?? 0);
      const limit = args.limit && args.limit > 0 ? args.limit : 10;
      const includePluginData = meetsMinimumRole(ctx.role, "dev")
        ? (args.includePluginData ?? [])
        : [];

      const { entries, totalMatched } = await usersCache.search(args.query, {
        offset,
        limit,
        includePluginData,
      });

      return textResult({
        users: entries,
        totalCount: totalMatched,
        offset,
        hasMore: offset + entries.length < totalMatched,
      });
    },
  );
}
