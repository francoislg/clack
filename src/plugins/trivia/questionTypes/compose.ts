/**
 * Record-composition strategies a `QuestionTypeHandler` delegates to. The
 * questionType owns WHETHER the answer key is required at save time; the
 * answersFormat handler owns HOW the record is built. `composeWithKey` is the
 * answered path (fact / topical); `composeDeferred` is the deferred path
 * (prediction — no key until settle time).
 */

import type {
  AnswerTypeHandler,
  GetSavedQuestionOutcome,
  SaveValidationContext,
  TriviaQuestionBase,
} from "../answerTypes/types.js";
import type { SaveQuestionArgs } from "../answerTypes/saveSchema.js";

export function composeWithKey(
  answerHandler: AnswerTypeHandler,
  base: TriviaQuestionBase,
  args: SaveQuestionArgs,
  ctx: SaveValidationContext,
): GetSavedQuestionOutcome {
  const staticOutcome = answerHandler.composeStatic(base, args, ctx);
  if (!staticOutcome.ok) return staticOutcome;
  // Answered path: settle the answer immediately from the same save args.
  const settled = answerHandler.settleOutcome(
    staticOutcome.question,
    answerHandler.settleInputFromSaveArgs(args),
  );
  if (!settled.ok) return { ok: false, error: settled.error };
  return { ok: true, question: { ...staticOutcome.question, ...settled.keyPatch } };
}

export function composeDeferred(
  answerHandler: AnswerTypeHandler,
  base: TriviaQuestionBase,
  args: SaveQuestionArgs,
  ctx: SaveValidationContext,
): GetSavedQuestionOutcome {
  // A prediction must NOT carry an answer at save time — the key is deferred to settle.
  if (answerHandler.settleInputFromSaveArgs(args).outcome !== undefined) {
    return {
      ok: false,
      error:
        "Prediction questions are saved without an answer key — omit it (it is settled later).",
    };
  }
  return answerHandler.composeStatic(base, args, ctx);
}
