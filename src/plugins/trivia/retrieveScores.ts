import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

export function createRetrieveScoresTool(data: TriviaDataLayer) {
  return tool(
    "retrieve_scores",
    "Retrieve the trivia leaderboard with scores ranked by total correct answers.",
    {
      limit: z.number().optional().describe("Number of top scores to return (default: 10)"),
    },
    async (args) => {
      const limit = args.limit ?? 10;
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

      // Build leaderboard sorted by totalCorrect desc, then accuracy desc
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
        .sort((a, b) => b.totalCorrect - a.totalCorrect || b.accuracy - a.accuracy)
        .slice(0, limit);

      return textResult({
        leaderboard,
        totalPlayers: scoreMap.size,
        totalQuestions: (await data.loadQuestions()).length,
      });
    },
  );
}
