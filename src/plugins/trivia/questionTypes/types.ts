/**
 * Shape registry for the trivia question-type axis (`fact` / `topical`). This
 * axis is orthogonal to `answersFormat` (boolean/choice/freeform) and gates a
 * different slice of save_question fields (`sourceUrl`, `eventDate`).
 *
 * Mirrors `answerTypes/`: each tier contributes its own Zod field-fragment,
 * its positive validation, and its record-extras. The tool's `save_question`
 * spreads both axes' fragments + runs both axes' central collision checks +
 * delegates per-tier validation. Adding a 3rd question-type (e.g. `opinion`)
 * means writing one new handler module — no edits to siblings.
 */

import type { JsonValue } from "../core/configTypes.js";
import type { SaveQuestionArgs } from "../answerTypes/saveSchema.js";
import type {
  AnswerTypeHandler,
  GetSavedQuestionOutcome,
  SaveValidationContext,
  TriviaQuestionBase,
} from "../answerTypes/types.js";

/**
 * Per-tier outcome of `validate(args)`. On success, the handler returns the
 * record-extras it contributes (`sourceUrl` / `eventDate` for topical;
 * `{}` for fact). On failure, a Claude-readable error.
 */
export type QuestionTypeValidationOutcome =
  | { ok: true; recordExtras: Record<string, JsonValue> }
  | { ok: false; error: string };

export interface QuestionTypeHandler {
  /**
   * Validate the args slice that THIS tier owns (e.g. topical asserts
   * `sourceUrl` is present and well-formed; fact asserts nothing). The tool
   * runs cross-tier collision checks centrally — handlers only assert their
   * own positive requirements and produce the record-extras to merge onto
   * the base.
   */
  validate(args: SaveQuestionArgs): QuestionTypeValidationOutcome;

  /**
   * Compose the persistable record for this question type by delegating to the right
   * answersFormat save path: fact/topical use the keyed save (answer required now);
   * prediction defers (no key until `settle_question`). This is where "does my type
   * require an answer at save time" lives — `save_question` just calls it, never
   * branching on the type itself.
   */
  composeSavedQuestion(
    answerHandler: AnswerTypeHandler,
    base: TriviaQuestionBase,
    args: SaveQuestionArgs,
    ctx: SaveValidationContext,
  ): GetSavedQuestionOutcome;
}
