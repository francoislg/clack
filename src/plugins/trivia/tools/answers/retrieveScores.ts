import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import { buildQuestionPointsMap, computeLeaderboard } from "../../domain/computeLeaderboard.js";
import type { TriviaDataLayer } from "../../core/types.js";

export function createRetrieveScoresTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "retrieve_scores",
    "Retrieve the trivia leaderboard for a specific game. When seasons are enabled, results include both current-season and all-time totals per user; use the season parameter to scope the leaderboard's primary ranking.",
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). Leaderboard is scoped to this game's answers only.",
        ),
      limit: z.number().optional().describe("Number of top scores to return (default: 10)"),
      sortBy: z
        .enum(["totalCorrect", "accuracy"])
        .optional()
        .describe(
          "Sort order. 'totalCorrect' (default): most wins first, accuracy as tiebreaker. 'accuracy': highest accuracy % first, totalCorrect as tiebreaker.",
        ),
      season: z
        .string()
        .optional()
        .describe(
          'Season filter. Default "current" (active season) when seasons are enabled, ignored when disabled. Accepts "all" (cross-season cumulative), or any historical season slug.',
        ),
    },
    async (args) => {
      try {
        requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const users = await data.loadUsers();
      const allAnswers = await scoped.loadAnswers();

      const currentSlug = await scoped.getCurrentSeasonSlug();
      const seasonsEnabled = currentSlug !== null;
      const seasonArg = args.season ?? (seasonsEnabled ? "current" : "all");

      const primaryFilterSeason: string | null =
        !seasonsEnabled || seasonArg === "all"
          ? null
          : seasonArg === "current"
            ? currentSlug
            : seasonArg;

      const questions = await scoped.loadQuestions();
      const { leaderboard, totalPlayers } = computeLeaderboard(
        allAnswers,
        users,
        buildQuestionPointsMap(questions),
        {
          sortBy: args.sortBy ?? "totalCorrect",
          limit: args.limit ?? 10,
          primaryFilterSeason,
          currentSeasonSlug: currentSlug,
        },
      );

      return textResult({
        leaderboard,
        totalPlayers,
        totalQuestions: questions.length,
        ...(seasonsEnabled ? { currentSeason: currentSlug, seasonFilter: seasonArg } : {}),
      });
    },
  );
}
