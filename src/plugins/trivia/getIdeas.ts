import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import { findCurrentSeason } from "./data.js";
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
      const seasonsState = await data.loadSeasonsState();
      const currentSeasonEntry = findCurrentSeason(seasonsState, Date.now());
      // Source pool: the currently-active season's categories when one exists,
      // otherwise (seasons disabled OR in a timeline gap) the legacy global pool.
      const categories =
        currentSeasonEntry !== null ? currentSeasonEntry.categories : await data.loadCategories();
      const allQuestions = await data.loadQuestions();
      // When a current season exists, "recent" means within the current season —
      // keeps the exclusion signal honest across timeline transitions.
      const questions =
        currentSeasonEntry !== null
          ? allQuestions.filter((q) => q.season === currentSeasonEntry.slug)
          : allQuestions;

      // Scale the exclusion window so small themed pools don't deadlock with an empty ideas array.
      const exclusionWindow = Math.min(10, Math.floor(categories.length / 3));
      const recentCategories = new Set(
        questions.slice(-exclusionWindow).map((q) => q.category.toLowerCase()),
      );

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
