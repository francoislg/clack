import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

export function createRetrieveScoresTool(data: TriviaDataLayer) {
  return tool(
    "retrieve_scores",
    "Retrieve the trivia leaderboard, ranked either by total correct answers (default) or by accuracy.",
    {
      limit: z.number().optional().describe("Number of top scores to return (default: 10)"),
      sortBy: z
        .enum(["totalCorrect", "accuracy"])
        .optional()
        .describe(
          "Sort order. 'totalCorrect' (default): most wins first, accuracy as tiebreaker — best for leaderboards that show raw win counts. 'accuracy': highest accuracy % first, totalCorrect as tiebreaker (so a 5/5 player beats a 1/1 player) — best when ranking by skill rather than volume.",
        ),
    },
    async (args) => {
      const limit = args.limit ?? 10;
      const sortBy = args.sortBy ?? "totalCorrect";
      const users = await data.loadUsers();
      const answers = await data.loadAnswers();

      // Aggregate scores per user
      const scoreMap = new Map<string, { totalCorrect: number; totalAnswered: number }>();
      for (const answer of answers) {
        const entry = scoreMap.get(answer.userId) ?? {
          totalCorrect: 0,
          totalAnswered: 0,
        };
        entry.totalAnswered++;
        if (answer.correct) entry.totalCorrect++;
        scoreMap.set(answer.userId, entry);
      }

      const compare =
        sortBy === "accuracy"
          ? (a: { accuracy: number; totalCorrect: number }, b: typeof a) =>
              b.accuracy - a.accuracy || b.totalCorrect - a.totalCorrect
          : (a: { totalCorrect: number; accuracy: number }, b: typeof a) =>
              b.totalCorrect - a.totalCorrect || b.accuracy - a.accuracy;

      const leaderboard = [...scoreMap.entries()]
        .map(([userId, stats]) => {
          const user = users.get(userId);
          return {
            userId,
            displayName: user?.displayName ?? userId,
            totalCorrect: stats.totalCorrect,
            totalAnswered: stats.totalAnswered,
            accuracy:
              stats.totalAnswered > 0
                ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100)
                : 0,
          };
        })
        .sort(compare)
        .slice(0, limit);

      return textResult({
        leaderboard,
        totalPlayers: scoreMap.size,
        totalQuestions: (await data.loadQuestions()).length,
      });
    },
  );
}
