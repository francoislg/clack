import { randomUUID } from "node:crypto";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

const TOPIC_DEDUP_WINDOW = 5;

export function createGenerateQuestionTool(data: TriviaDataLayer) {
  return tool(
    "generate_question",
    "Save a new trivia question. The question should be a true/false statement with topic-relevant emojis. Call get_past_topics first to avoid repeating recent topics.",
    {
      topic: z.string().describe("The topic category (e.g., science, history, geography)"),
      statement: z
        .string()
        .describe(
          "The trivia statement that is either true or false (e.g., 'Shrimp hearts are located in their heads')",
        ),
      isTrue: z.boolean().describe("Whether the statement is true or false"),
      emojis: z.array(z.string()).describe("1-4 topic-relevant emojis (e.g., ['🦐', '❤️'])"),
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

      const questions = await data.loadQuestions();
      const recentTopics = questions.slice(-TOPIC_DEDUP_WINDOW).map((q) => q.topic.toLowerCase());
      if (recentTopics.includes(args.topic.toLowerCase())) {
        return errorResult(
          `Topic "${args.topic}" was used in the last ${TOPIC_DEDUP_WINDOW} questions. Choose a different topic.`,
        );
      }

      const question = {
        id: randomUUID(),
        topic: args.topic,
        statement: args.statement,
        isTrue: args.isTrue,
        emojis: args.emojis,
        createdAt: Date.now(),
      };

      await data.saveQuestion(question);

      return textResult({
        saved: true,
        question,
      });
    },
  );
}
