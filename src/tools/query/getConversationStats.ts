import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import {
  computeConversationStats,
  defaultDeps,
  type ConversationStatsDeps,
} from "./conversationStats/scan.js";

const DESCRIPTION = [
  "Compute fun, high-level statistics over Clack's own conversation history — leaderboards,",
  "rush hours, longest conversations, favourite emoji, and more. Use when someone asks for",
  "playful stats about how Clack is used (e.g. 'who pings you most?', 'busiest hour?',",
  "'longest conversation ever?').",
  "Returns COUNTS, names, and superlatives ONLY — never the content of any conversation or",
  "what anyone asked about. Optionally bound by a from/to time window (epoch ms); omit both",
  "for all-time. Present the numbers with personality.",
].join(" ");

export function createGetConversationStatsTool(
  ctx: QueryToolContext,
  depsOverride?: ConversationStatsDeps,
) {
  const deps: ConversationStatsDeps = depsOverride ?? {
    ...defaultDeps,
    now: () => (ctx.asOf ? ctx.asOf.getTime() : Date.now()),
  };

  return tool(
    "get_conversation_stats",
    DESCRIPTION,
    {
      from: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Epoch-ms inclusive lower bound on session creation time. Omit for all-time."),
      to: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Epoch-ms exclusive upper bound on session creation time. Omit for all-time."),
    },
    async ({ from, to }) => {
      const bundle = await computeConversationStats({ from: from ?? null, to: to ?? null }, deps);
      return textResult(bundle);
    },
  );
}
