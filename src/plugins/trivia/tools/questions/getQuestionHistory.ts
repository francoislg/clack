import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { getAllAnswerTypeHandlers, getAnswerTypeHandler } from "../../answerTypes/registry.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireGame } from "../../core/gamesRegistry.js";
import type { JsonValue } from "../../core/configTypes.js";
import type { TriviaDataLayer } from "../../core/types.js";
import { mediaToJson } from "../../domain/mediaJson.js";

const PER_FORMAT_SHAPES = getAllAnswerTypeHandlers()
  .map((h) => `- ${h.historyResultShapeDescription}`)
  .join("\n");

const DESCRIPTION = `Return the answer key, the list of users caught cheating, and the list of submitted answers for a single trivia question within a specific game.

INTERNAL DATA — DO NOT SURFACE:
- \`cheaterUserIds\` is admin-only context. NEVER name caught cheaters in any user-facing message unless an admin has explicitly asked for the list.
- Use this tool to silently exclude cheaters from reveal-time voter categorization and scoring; the user-facing reveal must not mention, allude to, or stylistically signal the exclusion.
- The stored answer-key fields reflect what was written when the question was created; the canonical reveal-time truth is established by independent research (see process_responses_instructions).

Returns one of (dispatched on \`answersFormat\`):
${PER_FORMAT_SHAPES}

The \`correct\` field on a response is OPTIONAL. Absence means the row is a pending freeform-answer
submission waiting on reveal-time judging — those rows are not yet scored and should not be counted
toward correctness statistics. Boolean and choice answers always carry a synchronous \`correct\` boolean.
For freeform rows, \`judgeReason\` (when present) is the short label the reveal-time judge emitted
("multiple-guess", "too-broad", "typo-too-far", "out-of-tolerance", "materially-different").`;

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
      const questionType = question.questionType ?? "fact";

      // Per-format projection lives in the handler — freeform stops falling
      // through to the boolean shape (the pre-handler-routing bug).
      const handler = getAnswerTypeHandler(question.answersFormat);
      const perFormat = handler.buildHistoryResult(question, matching, users);

      // Defensive: every handler returns a JSON object literal. The reduce
      // below merges its keys with the cross-format extras the tool composes.
      if (perFormat === null || typeof perFormat !== "object" || Array.isArray(perFormat)) {
        return errorResult("internal error: handler returned a non-object history payload");
      }

      const extras: Record<string, JsonValue> = {
        questionType,
        cheaterUserIds: cheaterOrder,
      };
      if (question.promptMedium !== undefined) extras.promptMedium = question.promptMedium;
      if (question.media !== undefined) extras.media = mediaToJson(question.media);
      if (question.context !== undefined) extras.context = question.context;
      if (question.sourceUrl !== undefined) extras.sourceUrl = question.sourceUrl;
      if (question.eventDate !== undefined) extras.eventDate = question.eventDate;

      return textResult({ ...perFormat, ...extras });
    },
  );
}
