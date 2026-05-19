import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import { defaultGetGames, type GetGamesFn } from "./configBridge.js";
import { requireGame } from "./gamesRegistry.js";
import type { TriviaDataLayer, SubmittedAnswer } from "./types.js";

interface LeaderboardEntry {
  userId: string;
  displayName: string;
  totalCorrect: number;
  totalAnswered: number;
  accuracy: number;
  currentSeasonCorrect?: number;
  currentSeasonAnswered?: number;
}

function aggregate(
  answers: SubmittedAnswer[],
): Map<string, { totalCorrect: number; totalAnswered: number }> {
  const scoreMap = new Map<string, { totalCorrect: number; totalAnswered: number }>();
  for (const answer of answers) {
    const entry = scoreMap.get(answer.userId) ?? { totalCorrect: 0, totalAnswered: 0 };
    entry.totalAnswered++;
    if (answer.correct) entry.totalCorrect++;
    scoreMap.set(answer.userId, entry);
  }
  return scoreMap;
}

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
      const limit = args.limit ?? 10;
      const sortBy = args.sortBy ?? "totalCorrect";
      const users = await data.loadUsers();
      const allAnswers = await scoped.loadAnswers();

      const currentSlug = await scoped.getCurrentSeasonSlug();
      const seasonsEnabled = currentSlug !== null;
      const seasonArg = args.season ?? (seasonsEnabled ? "current" : "all");

      const primaryFilter: string | null =
        !seasonsEnabled || seasonArg === "all"
          ? null
          : seasonArg === "current"
            ? currentSlug
            : seasonArg;
      const primaryAnswers =
        primaryFilter === null ? allAnswers : allAnswers.filter((a) => a.season === primaryFilter);
      const primaryMap = aggregate(primaryAnswers);

      const allTimeMap = aggregate(allAnswers);

      const currentSeasonMap =
        seasonsEnabled && currentSlug !== null
          ? aggregate(allAnswers.filter((a) => a.season === currentSlug))
          : null;

      const compare =
        sortBy === "accuracy"
          ? (a: { accuracy: number; totalCorrect: number }, b: typeof a) =>
              b.accuracy - a.accuracy || b.totalCorrect - a.totalCorrect
          : (a: { totalCorrect: number; accuracy: number }, b: typeof a) =>
              b.totalCorrect - a.totalCorrect || b.accuracy - a.accuracy;

      const leaderboard: LeaderboardEntry[] = [...primaryMap.entries()]
        .map(([userId, stats]) => {
          const user = users.get(userId);
          const allTime = allTimeMap.get(userId) ?? { totalCorrect: 0, totalAnswered: 0 };
          const entry: LeaderboardEntry = {
            userId,
            displayName: user?.displayName ?? userId,
            totalCorrect: allTime.totalCorrect,
            totalAnswered: allTime.totalAnswered,
            accuracy:
              stats.totalAnswered > 0
                ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100)
                : 0,
          };
          if (currentSeasonMap !== null) {
            const cs = currentSeasonMap.get(userId) ?? { totalCorrect: 0, totalAnswered: 0 };
            entry.currentSeasonCorrect = cs.totalCorrect;
            entry.currentSeasonAnswered = cs.totalAnswered;
          }
          return entry;
        })
        .sort(compare)
        .slice(0, limit);

      return textResult({
        leaderboard,
        totalPlayers: primaryMap.size,
        totalQuestions: (await scoped.loadQuestions()).length,
        ...(seasonsEnabled ? { currentSeason: currentSlug, seasonFilter: seasonArg } : {}),
      });
    },
  );
}
