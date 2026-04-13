import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

export function createGetPastTopicsTool(data: TriviaDataLayer) {
  return tool(
    "get_past_topics",
    "Retrieve recent trivia topics to avoid repetition. Call this before generating a new question to see what topics have been used recently.",
    {
      limit: z.number().optional().describe("Number of recent topics to return (default: 10)"),
    },
    async (args) => {
      const limit = args.limit ?? 10;
      const questions = await data.loadQuestions();
      const recent = questions.slice(-limit);
      const topics = recent.map((q) => q.topic);

      return textResult({
        topics,
        questionCount: questions.length,
      });
    },
  );
}
