import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

export function createAddCategoriesTool(data: TriviaDataLayer) {
  return tool(
    "add_categories",
    "Add new categories to the trivia category pool",
    { categories: z.array(z.string()).describe("Categories to add to the pool") },
    async (args) => {
      const existing = await data.loadCategories();
      const existingLower = existing.map((c) => c.toLowerCase());

      const added: string[] = [];
      const alreadyExists: string[] = [];

      for (const category of args.categories) {
        const categoryLower = category.toLowerCase();
        if (existingLower.includes(categoryLower)) {
          alreadyExists.push(category);
        } else {
          added.push(category);
          existing.push(category);
          existingLower.push(categoryLower);
        }
      }

      if (added.length > 0) {
        await data.saveCategories(existing);
      }

      return textResult({
        added,
        alreadyExists,
        total: existing.length,
      });
    },
  );
}
