import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { reprocessThenRepaintHint } from "../../core/refreshHint.js";
import { isTeamOwnerKey, teamNameFromOwnerKey } from "../../answering/teamKey.js";
import type { TriviaDataLayer } from "../../core/types.js";

/**
 * The machine verdict to preserve before an override. Captured ONCE (a prior
 * override's `originalVerdict` is kept), so a repeat override never loses the
 * true original and `restore` works. Shared by the individual-row and team-slot
 * paths — both carry the same verdict fields.
 */
function captureOriginalVerdict(record: {
  originalVerdict?: { correct: boolean; judgeReason?: string };
  correct?: boolean;
  judgeReason?: string;
}): { correct: boolean; judgeReason?: string } {
  return (
    record.originalVerdict ?? {
      correct: record.correct ?? false,
      ...(record.judgeReason !== undefined ? { judgeReason: record.judgeReason } : {}),
    }
  );
}

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
        .describe(
          "Slack user ID of the player whose answer row is being corrected. For a shared-buzzer (byTeam) question, pass the team owner key `team:<TeamName>` (surfaced by get_question_history) to correct the team's slot instead.",
        ),
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

      const refreshHint = reprocessThenRepaintHint(args.questionId);

      // Shared-buzzer: a `team:<name>` key addresses the team's slot, not an
      // individual row. Same override/restore semantics, targeting team-answers.json.
      if (isTeamOwnerKey(args.userId)) {
        const teamName = teamNameFromOwnerKey(args.userId);
        // Distinguish "not a byTeam question / team not in roster" from "team hasn't
        // answered": the former means the key is wrong, the latter that there's no slot.
        const inRoster = (question.teamsStamp?.teams ?? []).some(
          (t) => t.name.toLowerCase() === teamName.toLowerCase(),
        );
        if (!inRoster) {
          return errorResult(
            `Team "${teamName}" is not in the stamped roster for question "${args.questionId}" — pass a valid team owner key (see get_question_history) or an individual userId.`,
          );
        }
        const slots = await scoped.loadTeamAnswers();
        const slot = slots.find((s) => s.teamName === teamName && s.questionId === args.questionId);
        if (!slot) {
          return errorResult(
            `Team "${teamName}" has not answered question "${args.questionId}" — there is no slot to override.`,
          );
        }
        if (isRestore) {
          if (slot.originalVerdict === undefined) {
            return errorResult("This team answer has not been overridden — nothing to restore.");
          }
          await scoped.upsertTeamAnswer({
            ...slot,
            correct: slot.originalVerdict.correct,
            judgeReason: slot.originalVerdict.judgeReason,
            originalVerdict: undefined,
          });
          return textResult({
            action: "restored",
            game: args.game,
            questionId: args.questionId,
            userId: args.userId,
            correct: slot.originalVerdict.correct,
            refreshHint,
          });
        }
        const teamOriginal = captureOriginalVerdict(slot);
        await scoped.upsertTeamAnswer({
          ...slot,
          correct: args.correct,
          judgeReason: args.reason,
          originalVerdict: teamOriginal,
        });
        return textResult({
          action: "overridden",
          game: args.game,
          questionId: args.questionId,
          userId: args.userId,
          correct: args.correct,
          originalVerdict: teamOriginal,
          refreshHint,
        });
      }

      const answers = await scoped.loadAnswers();
      const row = answers.find((a) => a.userId === args.userId && a.questionId === args.questionId);
      if (!row) {
        return errorResult(
          `No answer from <@${args.userId}> on question "${args.questionId}" was found.`,
        );
      }

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
