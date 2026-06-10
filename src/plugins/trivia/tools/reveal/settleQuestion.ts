import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { textResult, errorResult } from "../../../../tools/helpers.js";
import { defaultGetGames, type GetGamesFn } from "../../core/configBridge.js";
import { requireWritableGame } from "../../core/gamesRegistry.js";
import { getAnswerTypeHandler } from "../../answerTypes/registry.js";
import type { TriviaDataLayer } from "../../core/types.js";

const DESCRIPTION = `Decide a question's fate: ANSWER a pending prediction with its now-known result, OR SKIP a question — marking it INVALIDATED (worth 0 points, shown as "invalidated, no result"). Use at reveal time for predictions whose outcome is known (answer) or unknowable (skip); skipping also works any time, before OR after a reveal, to drop a bad question.

ANSWER (pass \`outcome\`): stamps the answer key + \`resolved: true\` + \`resolvedOutcome\` onto a PREDICTION saved without a key. Then run compute_answers — it scores the settled prediction like any other question.
- boolean → the boolean truth value (\`true\` / \`false\`).
- choice → the winning option's 0-based index (number) OR its exact text (string).
- freeform → the canonical answer text (string). Optionally also pass \`acceptableAnswers\` / \`gradingNotes\` to give the reveal judge the full spec.

SKIP (pass \`skip: true\` + \`skippedReason\`): marks the question INVALIDATED — sets \`skipped: true\` + the reason — and clears any verdicts on its answers so it scores 0 for everyone. Works for ANY format/type, even an already-answered or already-revealed question. A skipped prediction counts as decided for the reveal gate. After skipping a revealed question, re-run update_answers_block to repaint its card.

Pass EXACTLY ONE of \`outcome\` or \`skip\`. Errors when: the question is missing; \`outcome\` targets a question that already has an answer key; or the outcome does not match the answer format. On error, makes NO change.`;

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
          "ANSWER mode (mutually exclusive with `skip`). The real-world result. boolean → true/false. choice → the winning option's 0-based index or exact text. freeform → the canonical answer text.",
        ),
      invalidate: z
        .boolean()
        .optional()
        .describe(
          "SKIP mode (mutually exclusive with `outcome`). Pass `true` to mark the question invalidated (0 points).",
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

      const invalidating = args.invalidate === true;
      if (invalidating === (args.outcome !== undefined)) {
        return errorResult("Pass EXACTLY ONE of `outcome` (answer) or `invalidate`.");
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
        // answers so no leaderboard surface counts them. Raw picks are preserved.
        const rows = (await scoped.loadAnswers()).filter((a) => a.questionId === question.id);
        let cleared = 0;
        for (const row of rows) {
          if (row.correct === undefined) continue;
          await scoped.updateAnswer(row.userId, question.id, { correct: undefined });
          cleared++;
        }
        return textResult({
          invalidated: true,
          questionId: question.id,
          invalidatedReason: reason,
          cleared,
        });
      }

      const handler = getAnswerTypeHandler(question.answersFormat);
      // Answering applies only to a question still awaiting its key (a pending prediction).
      if (handler.hasAnswerKey(question)) {
        return errorResult(
          `Question "${args.questionId}" already has an answer key — nothing to answer (skip it instead to drop it).`,
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
      return textResult({
        settled: true,
        questionId: question.id,
        resolvedOutcome: settled.resolvedOutcome,
      });
    },
  );
}
