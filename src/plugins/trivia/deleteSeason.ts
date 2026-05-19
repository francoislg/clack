import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import { findSeasonBySlug } from "./data.js";
import { defaultGetGames, type GetGamesFn } from "./configBridge.js";
import { requireWritableGame } from "./gamesRegistry.js";
import type { TriviaDataLayer } from "./types.js";

export function createDeleteSeasonTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "delete_season",
    "Remove a not-yet-started season from a specific game's timeline. Refuses if the named season has already started (its history is immutable) or if it is the only season on that game's timeline.",
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[] and not disabled). The season is removed from this game's seasons.json.",
        ),
      slug: z.string().describe("Slug of the season to delete."),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const state = await scoped.loadSeasonsState();
      if (state === null) {
        return errorResult("Seasons are not initialized — nothing to delete.");
      }
      const target = findSeasonBySlug(state, args.slug);
      if (target === null) {
        return errorResult(`No season with slug "${args.slug}" on the timeline.`);
      }
      if (target.startedAt <= Date.now()) {
        return errorResult(
          `Cannot delete season "${args.slug}": it has already started. Past and current seasons are immutable historical records.`,
        );
      }
      if (state.seasons.length <= 1) {
        return errorResult(
          "Cannot delete the only season on the timeline — at least one season must exist while seasons is enabled.",
        );
      }
      await scoped.saveSeasonsState({
        seasons: state.seasons.filter((s) => s.slug !== args.slug),
      });
      return textResult({ deleted: args.slug, remaining: state.seasons.length - 1 });
    },
  );
}
