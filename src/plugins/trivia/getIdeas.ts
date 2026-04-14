import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

export function createGetIdeasTool(data: TriviaDataLayer) {
  return tool(
    "get_ideas",
    "Get 5 random trivia category suggestions, excluding categories used in the last 10 questions.",
    {},
    async () => {
      const categories = await data.loadCategories();
      const questions = await data.loadQuestions();

      const recentCategories = new Set(questions.slice(-10).map((q) => q.category.toLowerCase()));

      const available = categories.filter((c) => !recentCategories.has(c.toLowerCase()));

      // Pick up to 5 random from available
      const pool = [...available];
      const ideas: string[] = [];
      const count = Math.min(5, pool.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        ideas.push(pool[idx]);
        pool.splice(idx, 1);
      }

      return textResult({
        ideas,
        totalCategories: categories.length,
        excluded: recentCategories.size,
      });
    },
  );
}
