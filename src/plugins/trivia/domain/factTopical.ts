import type { Config } from "../../../config.js";
import { DEFAULT_QUESTION_TYPE_WEIGHTS } from "../../../config.js";
import type {
  SeasonQuestionTypeWeights,
  SeasonsState,
  SeasonEntry,
  ScopedTriviaDataLayer,
} from "../core/types.js";
import { findCurrentSeason } from "../core/seasonTimeline.js";

/**
 * Pure resolver for the fact-vs-topical axis given an already-resolved season entry
 * (possibly null) and optional slot index.
 *
 * Priority order (first non-null source wins):
 *   1. Slot's `questionType` — when the season has a format, slot index is in range,
 *      and the slot defines `questionType`.
 *   2. Season's `questionType`.
 *   3. `config.trivia.questionType` — workspace default.
 *   4. `DEFAULT_QUESTION_TYPE_WEIGHTS` (`{ fact: 1, topical: 0 }`) — pre-topical fallback.
 */
export function resolveQuestionType(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  config: Config | null,
): SeasonQuestionTypeWeights {
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    if (slot?.questionType !== undefined) {
      return slot.questionType;
    }
  }
  if (currentSeason?.questionType !== undefined) {
    return currentSeason.questionType;
  }
  if (config?.trivia?.questionType !== undefined) {
    return config.trivia.questionType;
  }
  return DEFAULT_QUESTION_TYPE_WEIGHTS;
}

/**
 * Resolves the active question-type weights for `get_ideas` (no slot). Re-reads
 * season state on every call so mid-season edits take effect on the next invocation.
 */
export async function getActiveQuestionType(
  scoped: ScopedTriviaDataLayer,
  config: Config,
  now: number,
): Promise<SeasonQuestionTypeWeights> {
  const seasonsEnabled = config.trivia?.seasons?.enabled ?? false;
  let current: SeasonEntry | null = null;
  if (seasonsEnabled) {
    const state: SeasonsState | null = await scoped.loadSeasonsState();
    current = findCurrentSeason(state, now);
  }
  return resolveQuestionType(current, null, config);
}
