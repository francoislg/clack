import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

export function createRegisterUserTool(data: TriviaDataLayer) {
  return tool(
    "register_user",
    "Register a user for trivia. If the user already exists, updates their display name.",
    {
      userId: z.string().describe("Unique user identifier (e.g., Slack user ID)"),
      displayName: z.string().describe("Display name for the leaderboard"),
    },
    async (args) => {
      const users = await data.loadUsers();
      const existing = users.get(args.userId);

      const user = {
        userId: args.userId,
        displayName: args.displayName,
        joinedAt: existing?.joinedAt ?? Date.now(),
      };

      await data.saveUser(user);

      return textResult({
        userId: user.userId,
        displayName: user.displayName,
        joinedAt: user.joinedAt,
        updated: !!existing,
      });
    },
  );
}
