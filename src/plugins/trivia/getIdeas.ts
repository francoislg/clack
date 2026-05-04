import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

type SuggestedDifficulty = "Easy" | "Medium" | "Hard";

function pickSuggestedDifficulty(): SuggestedDifficulty {
  const r = Math.random();
  if (r < 0.3) return "Easy";
  if (r < 0.9) return "Medium";
  return "Hard";
}

export function createGetIdeasTool(data: TriviaDataLayer) {
  return tool(
    "get_ideas",
    "Get 5 random trivia category suggestions (excluding categories used in the last 10 questions), plus a server-chosen `suggestedAnswer` (true/false) and `suggestedDifficulty` (Easy/Medium/Hard) hint that the question-flow prompt must honor.",
    {},
    async () => {
      const categories = await data.loadCategories();
      const questions = await data.loadQuestions();

      const recentCategories = new Set(questions.slice(-10).map((q) => q.category.toLowerCase()));

      const available = categories.filter((c) => !recentCategories.has(c.toLowerCase()));

      const pool = [...available];
      const ideas: string[] = [];
      const count = Math.min(5, pool.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        ideas.push(pool[idx]);
        pool.splice(idx, 1);
      }

      return textResult({
        categories: {
          ideas,
          total: categories.length,
          excluded: recentCategories.size,
        },
        suggestedAnswer: Math.random() < 0.5,
        suggestedDifficulty: pickSuggestedDifficulty(),
      });
    },
  );
}
