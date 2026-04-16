import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import type { TriviaDataLayer, TriviaQuestion } from "./types.js";

// The response intentionally omits `isTrue` — the answer key is not search-safe
// and is reachable only via the admin-tier `get_question_history` tool.
type SearchResultQuestion = Pick<
  TriviaQuestion,
  "id" | "category" | "statement" | "emojis" | "createdAt" | "postedAt" | "messageLink"
>;

function toSearchResult(q: TriviaQuestion): SearchResultQuestion {
  const result: SearchResultQuestion = {
    id: q.id,
    category: q.category,
    statement: q.statement,
    emojis: q.emojis,
    createdAt: q.createdAt,
  };
  if (q.postedAt !== undefined) result.postedAt = q.postedAt;
  if (q.messageLink !== undefined) result.messageLink = q.messageLink;
  return result;
}

export function createFindPreviousQuestionsTool(data: TriviaDataLayer) {
  return tool(
    "find_previous_questions",
    "Search past trivia questions by category and/or statement text to check what has been asked before.",
    {
      category: z
        .string()
        .optional()
        .describe("Filter by category (exact match, case-insensitive)"),
      text: z
        .string()
        .optional()
        .describe("Search in statement text (case-insensitive substring match)"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of questions to return (default 20, most recent first)"),
    },
    async (args) => {
      const limit = args.limit ?? 20;
      const questions = await data.loadQuestions();

      const filtered = questions.filter((q) => {
        if (args.category && q.category.toLowerCase() !== args.category.toLowerCase()) return false;
        if (args.text && !q.statement.toLowerCase().includes(args.text.toLowerCase())) return false;
        return true;
      });

      const sorted = filtered
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map(toSearchResult);

      return textResult({ questions: sorted, count: sorted.length, total: filtered.length });
    },
  );
}
