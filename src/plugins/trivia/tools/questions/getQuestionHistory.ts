import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import type { TriviaDataLayer } from "../../core/types.js";

const DESCRIPTION = `Return the answer key, the list of users caught cheating, and the list of submitted answers for a single trivia question within a specific game.

INTERNAL DATA — DO NOT SURFACE:
- \`cheaterUserIds\` is admin-only context. NEVER name caught cheaters in any user-facing message unless an admin has explicitly asked for the list.
- Use this tool to silently exclude cheaters from reveal-time voter categorization and scoring; the user-facing reveal must not mention, allude to, or stylistically signal the exclusion.
- The answer-key fields (\`isTrue\` for boolean questions, \`correctIndex\` for choice questions) reflect what was stored when the question was created; the canonical reveal-time truth is established by independent research (see process_responses_instructions).

Returns one of:
- Boolean question: \`{ type: "boolean", isTrue, cheaterUserIds, responses: Array<{ userId, displayName, answer, correct }> }\`
- Choice question: \`{ type: "choice", choices, correctIndex, cheaterUserIds, responses: Array<{ userId, displayName, answerIndex, correct }> }\``;

interface BooleanResponseEntry {
  userId: string;
  displayName: string;
  answer: boolean;
  correct: boolean;
}

interface ChoiceResponseEntry {
  userId: string;
  displayName: string;
  answerIndex: number;
  correct: boolean;
}

export function createGetQuestionHistoryTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "get_question_history",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[]). Question, cheats, and responses are looked up in this game's directory only.",
        ),
      questionId: z.string().describe("ID of the trivia question to look up"),
    },
    async (args) => {
      try {
        requireGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const scoped = data.forGame(args.game);
      const [questions, cheats, answers, users] = await Promise.all([
        scoped.loadQuestions(),
        scoped.loadCheats(),
        scoped.loadAnswers(),
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

      const matching = answers.filter((a) => a.questionId === args.questionId);
      const answersFormat = question.answersFormat ?? "boolean";
      const isChoice = answersFormat === "choice";
      const questionType = question.questionType ?? "fact";

      const extras: Record<string, string | undefined> = {};
      if (question.context !== undefined) extras.context = question.context;
      if (question.sourceUrl !== undefined) extras.sourceUrl = question.sourceUrl;
      if (question.eventDate !== undefined) extras.eventDate = question.eventDate;

      if (isChoice) {
        const responses: ChoiceResponseEntry[] = matching.map((a) => ({
          userId: a.userId,
          displayName: users.get(a.userId)?.displayName ?? a.userId,
          answerIndex: a.answerIndex ?? -1,
          correct: a.correct,
        }));
        return textResult({
          answersFormat: "choice",
          questionType,
          choices: question.choices ?? [],
          correctIndex: question.correctIndex ?? -1,
          cheaterUserIds: cheaterOrder,
          responses,
          ...extras,
        });
      }

      const responses: BooleanResponseEntry[] = matching.map((a) => ({
        userId: a.userId,
        displayName: users.get(a.userId)?.displayName ?? a.userId,
        answer: a.answer ?? false,
        correct: a.correct,
      }));
      return textResult({
        answersFormat: "boolean",
        questionType,
        isTrue: question.isTrue ?? false,
        cheaterUserIds: cheaterOrder,
        responses,
        ...extras,
      });
    },
  );
}
