import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../tools/helpers.js";
import type { TriviaDataLayer } from "./types.js";

const DESCRIPTION = `Return the answer key, the list of users caught cheating, and the list of submitted answers for a single trivia question.

INTERNAL DATA — DO NOT SURFACE:
- \`cheaterUserIds\` is admin-only context. NEVER name caught cheaters in any user-facing message unless an admin has explicitly asked for the list.
- Use this tool to silently exclude cheaters from reveal-time voter categorization and scoring; the user-facing reveal must not mention, allude to, or stylistically signal the exclusion.
- The \`isTrue\` field reflects what was stored when the question was created; the canonical reveal-time truth is established by independent research (see process_responses_instructions).

Returns: \`{ isTrue, cheaterUserIds: string[], responses: Array<{ userId, displayName, answer, correct }> }\`.`;

interface QuestionHistoryResponse {
  userId: string;
  displayName: string;
  answer: boolean;
  correct: boolean;
}

export function createGetQuestionHistoryTool(data: TriviaDataLayer) {
  return tool(
    "get_question_history",
    DESCRIPTION,
    {
      questionId: z.string().describe("ID of the trivia question to look up"),
    },
    async (args) => {
      const [questions, cheats, answers, users] = await Promise.all([
        data.loadQuestions(),
        data.loadCheats(),
        data.loadAnswers(),
        data.loadUsers(),
      ]);

      const question = questions.find((q) => q.id === args.questionId);
      if (!question) {
        return errorResult(`Question "${args.questionId}" not found.`);
      }

      const cheaterIds = new Set<string>();
      const cheaterOrder: string[] = [];
      for (const cheat of cheats) {
        if (cheat.questionId !== args.questionId) continue;
        if (cheaterIds.has(cheat.cheaterUserId)) continue;
        cheaterIds.add(cheat.cheaterUserId);
        cheaterOrder.push(cheat.cheaterUserId);
      }

      const responses: QuestionHistoryResponse[] = answers
        .filter((a) => a.questionId === args.questionId)
        .map((a) => ({
          userId: a.userId,
          displayName: users.get(a.userId)?.displayName ?? a.userId,
          answer: a.answer,
          correct: a.correct,
        }));

      return textResult({
        isTrue: question.isTrue,
        cheaterUserIds: cheaterOrder,
        responses,
      });
    },
  );
}
