import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import { findCurrentSeason } from "./data.js";
import type { TriviaDataLayer, TriviaQuestion } from "./types.js";

export function createSaveQuestionTool(data: TriviaDataLayer) {
  return tool(
    "save_question",
    "Save a new trivia question. The category must exist in the category pool.",
    {
      category: z.string().describe("The category from the pool (must exist in categories.json)"),
      statement: z.string().describe("The trivia statement that is either true or false"),
      isTrue: z.boolean().describe("Whether the statement is true or false"),
      emojis: z.array(z.string()).describe("1-4 topic-relevant emojis"),
    },
    async (args) => {
      if (args.statement.length < 10) {
        return errorResult("Statement must be at least 10 characters");
      }
      if (args.statement.length > 500) {
        return errorResult("Statement must be at most 500 characters");
      }
      if (args.emojis.length < 1 || args.emojis.length > 4) {
        return errorResult("Must provide 1-4 emojis");
      }

      const seasonsState = await data.loadSeasonsState();
      const currentSeasonEntry = findCurrentSeason(seasonsState, Date.now());
      const categories =
        currentSeasonEntry !== null ? currentSeasonEntry.categories : await data.loadCategories();
      const categoryLower = args.category.toLowerCase();
      const matchingCategory = categories.find((c) => c.toLowerCase() === categoryLower);

      if (!matchingCategory) {
        const hint =
          currentSeasonEntry !== null
            ? `Category "${args.category}" is not in this season's pool. Use add_categories to add it (target: "current" for this season only, or "both" to also persist it in the default baseline).`
            : `Category "${args.category}" not found in the pool. Use add_categories to add it first.`;
        return errorResult(hint);
      }

      const currentSeason = currentSeasonEntry?.slug ?? null;
      const question: TriviaQuestion = {
        id: randomUUID(),
        category: matchingCategory,
        statement: args.statement,
        isTrue: args.isTrue,
        emojis: args.emojis,
        createdAt: Date.now(),
        ...(currentSeason !== null ? { season: currentSeason } : {}),
      };

      await data.saveQuestion(question);

      return textResult({ saved: true, question });
    },
  );
}
