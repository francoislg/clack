import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../helpers.js";
import { errorMessage } from "../../errors.js";
import type { EmojiCache } from "../../slack/emojiCache.js";

export function createFindEmojiTool(emojiCache: EmojiCache) {
  return tool(
    "find_emoji",
    "Search for custom emojis in the Slack workspace by name. Matching is case-insensitive substring by default. Use * as a wildcard (e.g., 'party*' matches 'partyparrot', 'partytime'). Use '*' alone to list all custom emojis.",
    {
      query: z
        .string()
        .describe("Search term to match against emoji names"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of results to return (default: 25)"),
    },
    async (args) => {
      try {
        const result = await emojiCache.search(args.query, args.limit ?? 25);
        return textResult(result);
      } catch (error) {
        return errorResult(`Failed to search emojis: ${errorMessage(error)}`);
      }
    }
  );
}
