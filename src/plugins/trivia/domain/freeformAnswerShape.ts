import type { Config, TriviaFreeformAnswerShapeWeights } from "../../../config.js";
import { DEFAULT_FREEFORM_ANSWER_SHAPE_WEIGHTS } from "../../../config.js";
import type { SeasonEntry } from "../core/types.js";

/**
 * Pure resolver for the freeform answer-shape axis. Mirrors `resolveQuestionType` /
 * `resolveAnswersFormat`:
 *
 *   1. Slot's `freeformAnswerShape` (when the season has a format and the slot defines it).
 *   2. Season's `freeformAnswerShape`.
 *   3. `config.trivia.freeformAnswerShape`.
 *   4. `DEFAULT_FREEFORM_ANSWER_SHAPE_WEIGHTS` (uniform 1's across all shapes).
 *
 * Only consulted on the freeform branch in `get_ideas`; boolean/choice ignore it.
 */
export function resolveFreeformAnswerShape(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  config: Config | null,
): TriviaFreeformAnswerShapeWeights {
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    if (slot?.freeformAnswerShape !== undefined) {
      return slot.freeformAnswerShape;
    }
  }
  if (currentSeason?.freeformAnswerShape !== undefined) {
    return currentSeason.freeformAnswerShape;
  }
  if (config?.trivia?.freeformAnswerShape !== undefined) {
    return config.trivia.freeformAnswerShape;
  }
  return DEFAULT_FREEFORM_ANSWER_SHAPE_WEIGHTS;
}
