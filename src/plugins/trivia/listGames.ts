import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import { defaultGetGames, type GetGamesFn } from "./configBridge.js";

interface ListGamesEntry {
  name: string;
  channel: string;
  timezone: string;
  enabled: boolean;
}

const DESCRIPTION = `List the trivia games configured in this deployment (config.trivia.games[]).

By default, disabled games are excluded; pass \`includeDisabled: true\` to surface them too. The response omits cron expressions — those are scheduling details, not relevant to per-game tool calls.

Use this to discover available game slugs to pass as the \`game\` argument to other trivia tools.`;

export function createListGamesTool(getGamesFn: GetGamesFn = defaultGetGames) {
  return tool(
    "list_games",
    DESCRIPTION,
    {
      includeDisabled: z
        .boolean()
        .optional()
        .describe("When true, include games whose `enabled: false`. Defaults to false."),
    },
    async (args) => {
      const includeDisabled = args.includeDisabled ?? false;
      const games = getGamesFn();
      const filtered = includeDisabled ? games : games.filter((g) => g.enabled !== false);
      const entries: ListGamesEntry[] = filtered.map((g) => ({
        name: g.name,
        channel: g.channel,
        timezone: g.timezone,
        enabled: g.enabled !== false,
      }));
      return textResult({ games: entries, total: entries.length });
    },
  );
}
