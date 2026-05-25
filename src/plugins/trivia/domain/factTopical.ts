import type { TriviaConfig, TriviaQuestionTypeWeights, TriviaGame } from "../core/configTypes.js";
import { DEFAULT_QUESTION_TYPE_WEIGHTS } from "../core/configTypes.js";
import type { SeasonsState, SeasonEntry, ScopedTriviaDataLayer } from "../core/types.js";
import { findCurrentSeason } from "../core/seasonTimeline.js";

/**
 * Pure resolver for the fact-vs-topical axis given an already-resolved season entry
 * (possibly null), optional slot index, and optional per-game entry.
 *
 * Priority order (first non-null source wins):
 *   1. Slot's `questionType` — when the season has a format, slot index is in range,
 *      and the slot defines `questionType`.
 *   2. Season's `questionType`.
 *   3. Game's `questionType` — per-game tier between season and workspace.
 *   4. `config.trivia.questionType` — workspace default.
 *   5. `DEFAULT_QUESTION_TYPE_WEIGHTS` (`{ fact: 1, topical: 0 }`) — pre-topical fallback.
 */
export function resolveQuestionType(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  game: TriviaGame | null,
  triviaConfig: TriviaConfig | null,
): TriviaQuestionTypeWeights {
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    if (slot?.questionType !== undefined) {
      return slot.questionType;
    }
  }
  if (currentSeason?.questionType !== undefined) {
    return currentSeason.questionType;
  }
  if (game?.questionType !== undefined) {
    return game.questionType;
  }
  if (triviaConfig?.questionType !== undefined) {
    return triviaConfig.questionType;
  }
  return DEFAULT_QUESTION_TYPE_WEIGHTS;
}

/**
 * Resolves the active question-type weights for `get_ideas` (no slot). Re-reads
 * season state on every call so mid-season edits take effect on the next invocation.
 */
export async function getActiveQuestionType(
  scoped: ScopedTriviaDataLayer,
  triviaConfig: TriviaConfig | null,
  now: number,
  game: TriviaGame | null,
): Promise<TriviaQuestionTypeWeights> {
  const seasonsEnabled = triviaConfig?.seasons?.enabled ?? false;
  let current: SeasonEntry | null = null;
  if (seasonsEnabled) {
    const state: SeasonsState | null = await scoped.loadSeasonsState();
    current = findCurrentSeason(state, now);
  }
  return resolveQuestionType(current, null, game, triviaConfig);
}
