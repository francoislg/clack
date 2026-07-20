import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { findSeasonBySlug } from "../../core/seasonTimeline.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer } from "../../core/types.js";

export function createDeleteSeasonTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "delete_season",
    "Remove a season from a specific game's timeline. A season that hasn't started yet can always be removed. A started season can still be removed as long as no questions have been recorded under it (a started-but-empty season has no history to preserve). Refuses once the season has questions stamped to it, or if it is the only season on that game's timeline.",
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
        const questions = await scoped.loadQuestions();
        const hasStampedQuestions = questions.some((q) => q.season === args.slug);
        if (hasStampedQuestions) {
          return errorResult(
            `Cannot delete season "${args.slug}": it has already started and has questions recorded under it. Past and current seasons with history are immutable.`,
          );
        }
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
