import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
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

      const categories = await data.loadCategories();
      const categoryLower = args.category.toLowerCase();
      const matchingCategory = categories.find((c) => c.toLowerCase() === categoryLower);

      if (!matchingCategory) {
        return errorResult(
          `Category "${args.category}" not found in the pool. Use add_categories to add it first.`,
        );
      }

      const question: TriviaQuestion = {
        id: randomUUID(),
        category: matchingCategory,
        statement: args.statement,
        isTrue: args.isTrue,
        emojis: args.emojis,
        createdAt: Date.now(),
      };

      await data.saveQuestion(question);

      return textResult({ saved: true, question });
    },
  );
}
