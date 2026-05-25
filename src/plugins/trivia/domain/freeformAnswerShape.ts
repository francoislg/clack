import type {
  TriviaConfig,
  TriviaFreeformAnswerShapeWeights,
  TriviaGame,
} from "../core/configTypes.js";
import { DEFAULT_FREEFORM_ANSWER_SHAPE_WEIGHTS } from "../core/configTypes.js";
import type { SeasonEntry } from "../core/types.js";

/**
 * Pure resolver for the freeform answer-shape axis. Mirrors `resolveQuestionType` /
 * `resolveAnswersFormat`:
 *
 *   1. Slot's `freeformAnswerShape` (when the season has a format and the slot defines it).
 *   2. Season's `freeformAnswerShape`.
 *   3. Game's `freeformAnswerShape` — per-game tier between season and workspace.
 *   4. `config.trivia.freeformAnswerShape`.
 *   5. `DEFAULT_FREEFORM_ANSWER_SHAPE_WEIGHTS` (uniform 1's across all shapes).
 *
 * Only consulted on the freeform branch in `get_ideas`; boolean/choice ignore it.
 */
export function resolveFreeformAnswerShape(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  game: TriviaGame | null,
  triviaConfig: TriviaConfig | null,
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
  if (game?.freeformAnswerShape !== undefined) {
    return game.freeformAnswerShape;
  }
  if (triviaConfig?.freeformAnswerShape !== undefined) {
    return triviaConfig.freeformAnswerShape;
  }
  return DEFAULT_FREEFORM_ANSWER_SHAPE_WEIGHTS;
}
