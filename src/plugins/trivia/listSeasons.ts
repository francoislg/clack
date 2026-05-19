import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import { defaultGetGames, type GetGamesFn } from "./configBridge.js";
import { requireGame } from "./gamesRegistry.js";
import type { TriviaDataLayer, SeasonEntry } from "./types.js";

type Status = "past" | "current" | "future";

function statusOf(entry: SeasonEntry, now: number): Status {
  if (entry.startedAt > now) return "future";
  const effectiveEnd = entry.endedAt ?? entry.expectedEndAt;
  if (effectiveEnd <= now) return "past";
  return "current";
}

export function createListSeasonsTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "list_seasons",
    'List every season on a specific game\'s trivia timeline with full details — slug, dates, categories, and a computed status flag ("past" | "current" | "future"). Use this to inspect what\'s queued, see a future season\'s category pool before it goes live, or audit past seasons. Returns the timeline in stored order.',
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). The timeline is scoped to this game's seasons.json.",
        ),
    },
    async (args) => {
      try {
        requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const state = await scoped.loadSeasonsState();
      if (state === null) {
        return errorResult(
          `Seasons are not initialized for game "${args.game}" (seasons.json missing). Cannot list.`,
        );
      }
      const now = Date.now();
      const seasons = state.seasons.map((entry) => ({
        slug: entry.slug,
        startedAt: entry.startedAt,
        expectedEndAt: entry.expectedEndAt,
        endedAt: entry.endedAt ?? null,
        categories: entry.categories,
        status: statusOf(entry, now),
      }));
      return textResult({ game: args.game, seasons, total: seasons.length });
    },
  );
}
