import type { Config, TriviaAnswerShapeWeights } from "../../../config.js";
import { DEFAULT_ANSWER_SHAPE_WEIGHTS } from "../../../config.js";
import type { SeasonEntry } from "../core/types.js";

/**
 * Pure resolver for the freeform answer-shape axis. Mirrors `resolveQuestionType` /
 * `resolveAnswersFormat`:
 *
 *   1. Slot's `answerShape` (when the season has a format and the slot defines it).
 *   2. Season's `answerShape`.
 *   3. `config.trivia.answerShape`.
 *   4. `DEFAULT_ANSWER_SHAPE_WEIGHTS` (uniform 1's across all five shapes).
 *
 * Only consulted on the freeform branch in `get_ideas`; boolean/choice ignore it.
 */
export function resolveAnswerShape(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  config: Config | null,
): TriviaAnswerShapeWeights {
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    if (slot?.answerShape !== undefined) {
      return slot.answerShape;
    }
  }
  if (currentSeason?.answerShape !== undefined) {
    return currentSeason.answerShape;
  }
  if (config?.trivia?.answerShape !== undefined) {
    return config.trivia.answerShape;
  }
  return DEFAULT_ANSWER_SHAPE_WEIGHTS;
}
