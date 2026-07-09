import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { reprocessThenRepaintHint } from "../../core/refreshHint.js";
import type { TriviaDataLayer } from "../../core/types.js";

const DESCRIPTION = `Hand-correct the verdict on ONE player's answer to a trivia question, or restore a previously-corrected answer to its machine verdict. Admin-only.

Two mutually-exclusive call shapes:
- OVERRIDE: pass \`correct\` (the verdict to set) and \`reason\` (a short explanation, stored on the row). Use when the reveal judge got a freeform answer wrong, or to grant a one-off exception.
- RESTORE: pass \`restore: true\` (omit \`correct\`/\`reason\`). Undoes a prior override — puts the machine's original verdict back and lets future reprocess re-derive this row normally.

The question MUST already be revealed (its reveal has been posted); there is nothing to override before that. Overriding stamps the original machine verdict onto the row so it survives reprocess and can be restored later. To make the already-posted reveal card reflect the new verdict, follow with the refresh flow: \`compute_answers\` reprocess → \`refresh_question_cards\`.

For BOOLEAN / CHOICE questions a wrong verdict is usually a wrong answer KEY — prefer fixing \`isTrue\` / \`correctIndex\` (via the question, then reprocess) so every player is corrected at once. Use override here only for a deliberate per-player exception.`;

export function createOverrideAnswerTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "override_answer",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe(
          "Game name (must be present in config.trivia.games[] and not disabled). The answer row is looked up in this game's directory only.",
        ),
      questionId: z.string().describe("ID of the trivia question whose answer is being corrected"),
      userId: z
        .string()
        .describe("Slack user ID of the player whose answer row is being corrected"),
      correct: z
        .boolean()
        .optional()
        .describe("Override mode: the verdict to set (true = correct). Required unless restore."),
      reason: z
        .string()
        .optional()
        .describe(
          "Override mode: a short human-readable explanation, stored as the row's judgeReason. Required (non-empty) unless restore.",
        ),
      restore: z
        .boolean()
        .optional()
        .describe(
          "Restore mode: when true, undo a prior override (put the machine verdict back and drop the lock). Ignores correct/reason.",
        ),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const isRestore = args.restore === true;
      if (!isRestore) {
        if (args.correct === undefined) {
          return errorResult("override mode requires `correct` (or pass `restore: true`).");
        }
        if (args.reason === undefined || args.reason.trim().length === 0) {
          return errorResult("override mode requires a non-empty `reason`.");
        }
      }

      const scoped = data.forGame(args.game);
      const questions = await scoped.loadQuestions();
      const question = questions.find((q) => q.id === args.questionId);
      if (!question) {
        return errorResult(`Question "${args.questionId}" not found.`);
      }
      if (question.processedAt === undefined) {
        return errorResult(
          `Question "${args.questionId}" has not been revealed yet — nothing to override.`,
        );
      }

      const answers = await scoped.loadAnswers();
      const row = answers.find((a) => a.userId === args.userId && a.questionId === args.questionId);
      if (!row) {
        return errorResult(
          `No answer from <@${args.userId}> on question "${args.questionId}" was found.`,
        );
      }

      const refreshHint = reprocessThenRepaintHint(args.questionId);

      if (isRestore) {
        if (row.originalVerdict === undefined) {
          return errorResult("This answer has not been overridden — nothing to restore.");
        }
        await scoped.updateAnswer(args.userId, args.questionId, {
          correct: row.originalVerdict.correct,
          judgeReason: row.originalVerdict.judgeReason,
          originalVerdict: undefined,
        });
        return textResult({
          action: "restored",
          game: args.game,
          questionId: args.questionId,
          userId: args.userId,
          correct: row.originalVerdict.correct,
          refreshHint,
        });
      }

      const originalVerdict = row.originalVerdict ?? {
        correct: row.correct ?? false,
        ...(row.judgeReason !== undefined ? { judgeReason: row.judgeReason } : {}),
      };
      await scoped.updateAnswer(args.userId, args.questionId, {
        correct: args.correct,
        judgeReason: args.reason,
        originalVerdict,
      });
      return textResult({
        action: "overridden",
        game: args.game,
        questionId: args.questionId,
        userId: args.userId,
        correct: args.correct,
        originalVerdict,
        refreshHint,
      });
    },
  );
}
