import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../plugins-sdk/sdk.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { getAnswerTypeHandler } from "../../answerTypes/registry.js";
import { repaintHint, reprocessThenRepaintHint } from "../../core/refreshHint.js";
import type { ScopedTriviaDataLayer, TriviaDataLayer, TriviaQuestion } from "../../core/types.js";

// Drops `correct` verdicts so the next compute_answers rescores from scratch; raw picks kept.
async function clearVerdicts(scoped: ScopedTriviaDataLayer, questionId: string): Promise<number> {
  const rows = (await scoped.loadAnswers()).filter((a) => a.questionId === questionId);
  let cleared = 0;
  for (const row of rows) {
    if (row.correct === undefined) continue;
    await scoped.updateAnswer(row.userId, questionId, { correct: undefined });
    cleared++;
  }
  return cleared;
}

const DESCRIPTION = `Decide a question's fate. Pass EXACTLY ONE of \`outcome\` (answer), \`invalidate\` (drop), or \`reopen\` (undo a drop).

ANSWER (pass \`outcome\`): stamps the answer key + \`resolved: true\` + \`resolvedOutcome\` + \`resolvedAt\` onto a PREDICTION saved without a key. Then run compute_answers — it scores the settled prediction like any other question.
- boolean → the boolean truth value (\`true\` / \`false\`).
- choice → the winning option's 0-based index (number) OR its exact text (string).
- freeform → the canonical answer text (string). Optionally also pass \`acceptableAnswers\` / \`gradingNotes\` to give the reveal judge the full spec.

INVALIDATE (pass \`invalidate: true\` + \`invalidatedReason\`): marks the question INVALIDATED — sets \`invalidated: true\` + the reason — and clears any verdicts on its answers so it scores 0 for everyone. Works for ANY format/type, even an already-answered or already-revealed question. An invalidated prediction counts as decided for the reveal gate. The result carries a \`refreshHint\` — call exactly that to repaint the now-invalidated card.

REOPEN (pass \`reopen: true\`): reverses a prior invalidation (the inverse of INVALIDATE); errors if the question is not currently \`invalidated\`. Clears \`invalidated\` + \`invalidatedReason\`; if the question has NO answer key yet (a never-settled prediction) it also returns to pending (\`resolved: false\`, clears \`resolvedAt\`/\`resolvedOutcome\`), otherwise its settled key is kept. Leaves \`processedAt\`, \`answerLocked\`, and all answer rows untouched. The result carries a \`refreshHint\` to repaint the restored (live/locked) card. To finish recovering an already-revealed question: settle it (\`outcome\`), then compute_answers (reprocess this question), then repaint.

RE-SETTLE (pass \`outcome\` + \`override: true\`): fixes a question already answered with the WRONG outcome. Re-stamps the answer key and clears stale verdicts so the next compute_answers rescores everyone against the corrected result. Without \`override\`, answering an already-keyed question errors.

Errors when: not EXACTLY ONE of \`outcome\`/\`invalidate\`/\`reopen\` is provided; the question is missing; \`outcome\` targets a question that already has an answer key (unless \`override: true\`); \`reopen\` targets a question that is not invalidated; or the outcome does not match the answer format. On error, makes NO change.`;

export function createSettleQuestionTool(
  data: TriviaDataLayer,
  getGamesFn: GetGamesFn = defaultGetGames,
) {
  return tool(
    "settle_question",
    DESCRIPTION,
    {
      game: z
        .string()
        .describe("Game name (must be present in config.trivia.games[] and not disabled)."),
      questionId: z.string().describe("The id of the question to decide."),
      outcome: z
        .union([z.boolean(), z.number().int(), z.string()])
        .optional()
        .describe(
          "ANSWER mode (mutually exclusive with `invalidate` and `reopen`). The real-world result. boolean → true/false. choice → the winning option's 0-based index or exact text. freeform → the canonical answer text.",
        ),
      override: z
        .boolean()
        .optional()
        .describe(
          "ANSWER mode only. Pass `true` to RE-SETTLE a question that was already answered (e.g. settled with the wrong outcome). Re-stamps the answer key and clears stale verdicts so the next compute_answers rescores everyone. Ignored when the question has no key yet.",
        ),
      invalidate: z
        .boolean()
        .optional()
        .describe(
          "INVALIDATE mode (mutually exclusive with `outcome` and `reopen`). Pass `true` to mark the question invalidated (0 points).",
        ),
      reopen: z
        .boolean()
        .optional()
        .describe(
          "REOPEN mode (mutually exclusive with `outcome` and `invalidate`). Pass `true` to reverse a prior invalidation: clears `invalidated`/`invalidatedReason`, and returns a keyless prediction to pending. Errors if the question is not currently invalidated.",
        ),
      invalidatedReason: z
        .string()
        .optional()
        .describe(
          'Required when `invalidate` is true: short reason (e.g. "match postponed", "bad question").',
        ),
      acceptableAnswers: z
        .array(z.string())
        .optional()
        .describe(
          "ANSWER mode, freeform only: extra answer variants the reveal judge should also accept (each 1-200 chars). Ignored otherwise.",
        ),
      gradingNotes: z
        .string()
        .optional()
        .describe(
          "ANSWER mode, freeform only: one short sentence refining acceptance for the reveal judge (≤500 chars). Ignored otherwise.",
        ),
    },
    async (args) => {
      try {
        requireWritableGame(getGamesFn(), args.game);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }

      const answering = args.outcome !== undefined;
      const invalidating = args.invalidate === true;
      const reopening = args.reopen === true;
      if (Number(answering) + Number(invalidating) + Number(reopening) !== 1) {
        return errorResult("Pass EXACTLY ONE of `outcome` (answer), `invalidate`, or `reopen`.");
      }

      const scoped = data.forGame(args.game);
      const questions = await scoped.loadQuestions();
      const question = questions.find((q) => q.id === args.questionId);
      if (question === undefined) {
        return errorResult(`questionId "${args.questionId}" not found in game "${args.game}".`);
      }

      const resolvedAt = Date.now();

      if (invalidating) {
        const reason = args.invalidatedReason?.trim();
        if (reason === undefined || reason.length === 0) {
          return errorResult("`invalidatedReason` is required when invalidating a question.");
        }
        await scoped.updateQuestion(question.id, {
          resolved: true,
          invalidated: true,
          invalidatedReason: reason,
          resolvedAt,
        });
        // An invalidated question scores 0 for everyone — drop any verdict already on its
        // answers so no leaderboard surface counts them.
        const cleared = await clearVerdicts(scoped, question.id);
        return textResult({
          invalidated: true,
          questionId: question.id,
          invalidatedReason: reason,
          cleared,
          // The card needs repainting to show its invalidated state (whether mid-window
          // or after reveal). No posted card → nothing to refresh.
          ...(question.messageLink !== undefined ? { refreshHint: repaintHint(question.id) } : {}),
        });
      }

      if (reopening) {
        if (question.invalidated !== true) {
          return errorResult(
            `Question "${args.questionId}" is not invalidated — nothing to reopen.`,
          );
        }
        // A never-settled (keyless) prediction returns to pending so the undecided
        // gate applies to it again; a settled question keeps its key. `processedAt`,
        // `answerLocked`, and answer rows are deliberately untouched.
        const keyless = !getAnswerTypeHandler(question.answersFormat).hasAnswerKey(question);
        const patch: Partial<TriviaQuestion> = {
          invalidated: undefined,
          invalidatedReason: undefined,
          ...(keyless
            ? { resolved: false, resolvedAt: undefined, resolvedOutcome: undefined }
            : {}),
        };
        await scoped.updateQuestion(question.id, patch);
        return textResult({
          reopened: true,
          questionId: question.id,
          returnedToPending: keyless,
          ...(question.messageLink !== undefined ? { refreshHint: repaintHint(question.id) } : {}),
        });
      }

      const handler = getAnswerTypeHandler(question.answersFormat);
      // Answering normally applies only to a question still awaiting its key (a pending
      // prediction). `override` re-settles one that was already answered wrong.
      const alreadyKeyed = handler.hasAnswerKey(question);
      if (alreadyKeyed && args.override !== true) {
        return errorResult(
          `Question "${args.questionId}" already has an answer key — pass override:true to re-settle it with a corrected outcome, or invalidate to drop it.`,
        );
      }
      const settled = handler.settleOutcome(question, {
        outcome: args.outcome,
        acceptableAnswers: args.acceptableAnswers,
        gradingNotes: args.gradingNotes,
      });
      if (!settled.ok) {
        return errorResult(settled.error);
      }
      await scoped.updateQuestion(question.id, {
        ...settled.keyPatch,
        resolved: true,
        resolvedAt,
        resolvedOutcome: settled.resolvedOutcome,
      });
      // Re-settling leaves stale verdicts from the wrong key; clear them so the next
      // compute_answers rescores everyone against the corrected outcome.
      const rescored = alreadyKeyed ? await clearVerdicts(scoped, question.id) : 0;
      return textResult({
        settled: true,
        questionId: question.id,
        resolvedOutcome: settled.resolvedOutcome,
        ...(alreadyKeyed ? { reSettled: true, rescored } : {}),
        // Re-settling an already-revealed question clears its verdicts → reprocess, then
        // repaint. Answering a still-pending prediction posts no result yet, so no card.
        ...(alreadyKeyed && question.processedAt !== undefined
          ? { refreshHint: reprocessThenRepaintHint(question.id) }
          : {}),
      });
    },
  );
}
