import type { TriviaAnswersFormatWeights, TriviaConfig } from "../core/configTypes.js";
import { DEFAULT_TRIVIA_CHOICES } from "../core/configTypes.js";

/**
 * Built-in fallback when no tier provides `answersFormat`. Equivalent to pre-choice
 * behavior. Used as the `answersFormat` axis default in `AXIS_REGISTRY`.
 */
export const DEFAULT_ANSWERS_FORMAT_WEIGHTS: TriviaAnswersFormatWeights = {
  boolean: 1,
  choice: 0,
  freeform: 0,
};

/**
 * Resolves the active choice-count bounds. Workspace-only by design — `choices.{min,max}`
 * is a card-readability UX setting, not gameplay state, so it is never season-scoped.
 */
export function getActiveChoiceBounds(triviaConfig: TriviaConfig | null): {
  min: number;
  max: number;
} {
  return triviaConfig?.choices ?? DEFAULT_TRIVIA_CHOICES;
}
