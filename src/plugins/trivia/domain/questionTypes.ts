import type { Config, TriviaAnswersFormatWeights } from "../../../config.js";
import { DEFAULT_TRIVIA_CHOICES } from "../../../config.js";
import type { SeasonsState, SeasonEntry, ScopedTriviaDataLayer } from "../core/types.js";
import { findCurrentSeason } from "../core/seasonTimeline.js";

/**
 * Built-in fallback when neither a current season nor workspace config provides
 * `answersFormat`. Equivalent to pre-choice-questions behavior.
 */
export const DEFAULT_ANSWERS_FORMAT_WEIGHTS: TriviaAnswersFormatWeights = {
  boolean: 1,
  choice: 0,
  freeform: 0,
};

/**
 * Pure resolver for answers-format weights (boolean vs choice) given an already-resolved
 * season entry (possibly null) and optional slot index.
 *
 * Priority order (first non-null source wins):
 *   1. Slot's `answersFormat` — when `currentSeason.format` is present, `slotIndex`
 *      is in range, and that slot has an `answersFormat` field.
 *   2. Season's top-level `answersFormat`.
 *   3. `config.trivia.answersFormat` — workspace default.
 *   4. `DEFAULT_ANSWERS_FORMAT_WEIGHTS` — pure-boolean fallback.
 */
export function resolveAnswersFormat(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  config: Config | null,
): TriviaAnswersFormatWeights {
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    if (slot?.answersFormat !== undefined) {
      return slot.answersFormat;
    }
  }
  if (currentSeason?.answersFormat !== undefined) {
    return currentSeason.answersFormat;
  }
  if (config?.trivia?.answersFormat !== undefined) {
    return config.trivia.answersFormat;
  }
  return DEFAULT_ANSWERS_FORMAT_WEIGHTS;
}

/**
 * Resolves the active answers-format weights for `get_ideas` (no slot — pre-format
 * behavior). Loads the current season state on every call by design (no caching)
 * so mid-season `upsert_season` edits take effect on the next invocation.
 */
export async function getActiveAnswersFormat(
  scoped: ScopedTriviaDataLayer,
  config: Config,
  now: number,
): Promise<TriviaAnswersFormatWeights> {
  const seasonsEnabled = config.trivia?.seasons?.enabled ?? false;
  let current: SeasonEntry | null = null;
  if (seasonsEnabled) {
    const state: SeasonsState | null = await scoped.loadSeasonsState();
    current = findCurrentSeason(state, now);
  }
  return resolveAnswersFormat(current, null, config);
}

/**
 * Resolves the active choice-count bounds. Workspace-only by design — `choices.{min,max}`
 * is a card-readability UX setting, not gameplay state, so it is never season-scoped.
 */
export function getActiveChoiceBounds(config: Config): { min: number; max: number } {
  return config.trivia?.choices ?? DEFAULT_TRIVIA_CHOICES;
}
