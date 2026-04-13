import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../helpers.js";
import type { ChannelsCache, SlackChannelEntry } from "../../slack/channelsCache.js";

const MAX_RESULTS = 20;

function formatChannel(ch: SlackChannelEntry) {
  return {
    id: ch.id,
    name: ch.name,
    is_private: ch.isPrivate,
    is_archived: ch.isArchived,
    ...(ch.topic && { topic: ch.topic }),
    ...(ch.purpose && { purpose: ch.purpose }),
    ...(ch.numMembers != null && { num_members: ch.numMembers }),
  };
}

export function createFindChannelTool(channelsCache: ChannelsCache) {
  return tool(
    "find_channel",
    "Search for Slack channels by name or ID. Useful when you know a channel name (e.g., #general) but need the channel ID to use with other tools like fetch_channel_messages. Matching is case-insensitive substring. Supports * wildcards (e.g., 'dev-*' matches 'dev-team', 'dev-updates').",
    {
      query: z
        .string()
        .describe(
          "Channel name (with or without #), wildcard pattern, or channel ID (e.g., 'general', '#dev-*', 'C0123456789')",
        ),
      scope: z
        .enum(["all", "public", "private"])
        .optional()
        .describe("Filter by channel type (default: 'all')"),
      include_archived: z
        .boolean()
        .optional()
        .describe("Include archived channels in results (default: false)"),
      limit: z
        .number()
        .optional()
        .describe(`Maximum number of results per page (default: ${MAX_RESULTS})`),
      page: z.number().optional().describe("Page number, 0-indexed (default: 0)"),
    },
    async (args) => {
      const input = args.query.trim();
      if (!input) {
        return errorResult("Query cannot be empty");
      }

      // If it looks like a channel ID, resolve it directly
      if (/^[CG][A-Z0-9_]+$/.test(input)) {
        const channel = await channelsCache.resolve(input);
        if (!channel) {
          return errorResult(`Channel ${input} not found or bot is not a member`);
        }
        return textResult(formatChannel(channel));
      }

      // Search by name
      const limit = args.limit ?? MAX_RESULTS;
      const page = args.page ?? 0;
      // Fetch enough to know the full count and support pagination
      const matches = await channelsCache.search(input, {
        scope: args.scope ?? "all",
        includeArchived: args.include_archived ?? false,
        limit: (page + 1) * limit + 1,
      });

      if (matches.length === 0) {
        const searchName = input.replace(/^#/, "");
        return errorResult(
          `No channels matching "${searchName}" found. Make sure the bot is a member of the channel.`,
        );
      }

      const start = page * limit;
      const pageResults = matches.slice(start, start + limit);
      const hasMore = matches.length > start + limit;

      return textResult({
        channels: pageResults.map(formatChannel),
        total: matches.length - (hasMore ? 1 : 0),
        page,
        has_more: hasMore,
      });
    },
  );
}
