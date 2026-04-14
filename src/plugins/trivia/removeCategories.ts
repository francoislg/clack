import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

export function createRemoveCategoriesTool(data: TriviaDataLayer) {
  return tool(
    "remove_categories",
    "Remove categories from the trivia category pool",
    { categories: z.array(z.string()).describe("Categories to remove from the pool") },
    async (args) => {
      const existing = await data.loadCategories();
      const existingLower = existing.map((c) => c.toLowerCase());

      const removed: string[] = [];
      const notFound: string[] = [];

      for (const category of args.categories) {
        const categoryLower = category.toLowerCase();
        const index = existingLower.indexOf(categoryLower);

        if (index >= 0) {
          removed.push(existing[index]);
          existing.splice(index, 1);
          existingLower.splice(index, 1);
        } else {
          notFound.push(category);
        }
      }

      if (removed.length > 0) {
        await data.saveCategories(existing);
      }

      return textResult({
        removed,
        notFound,
        total: existing.length,
      });
    },
  );
}
