import type { TriviaAnswersFormatWeights } from "../core/configTypes.js";

/**
 * Built-in fallback when no tier provides `answersFormat`. Equivalent to pre-choice
 * behavior. Used as the `answersFormat` axis default in `AXIS_REGISTRY`.
 */
export const DEFAULT_ANSWERS_FORMAT_WEIGHTS: TriviaAnswersFormatWeights = {
  boolean: 1,
  choice: 0,
  freeform: 0,
};
