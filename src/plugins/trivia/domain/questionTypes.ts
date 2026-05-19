import type { Config } from "../../../config.js";
import { DEFAULT_TRIVIA_CHOICES } from "../../../config.js";
import type {
  SeasonQuestionTypeWeights,
  SeasonsState,
  SeasonEntry,
  ScopedTriviaDataLayer,
} from "../core/types.js";
import { findCurrentSeason } from "../core/seasonTimeline.js";

/**
 * Built-in fallback when neither a current season nor workspace config provides
 * `questionsTypes`. Equivalent to pre-choice-questions behavior.
 */
export const DEFAULT_QUESTION_TYPE_WEIGHTS: SeasonQuestionTypeWeights = {
  boolean: 1,
  choice: 0,
};

/**
 * Pure resolver for question-type weights given an already-resolved season entry
 * (possibly null) and optional slot index.
 *
 * Priority order (first non-null source wins):
 *   1. Slot's `questionTypes` — when `currentSeason.format` is present, `slotIndex`
 *      is in range, and that slot has a `questionTypes` field.
 *   2. Season's top-level `questionTypes`.
 *   3. `config.trivia.questionsTypes` — workspace default.
 *   4. `DEFAULT_QUESTION_TYPE_WEIGHTS` — pure-boolean fallback.
 */
export function resolveQuestionTypes(
  currentSeason: SeasonEntry | null,
  slotIndex: number | null,
  config: Config | null,
): SeasonQuestionTypeWeights {
  if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
    const slot = currentSeason.format.questions[slotIndex];
    if (slot?.questionTypes !== undefined) {
      return slot.questionTypes;
    }
  }
  if (currentSeason?.questionTypes !== undefined) {
    return currentSeason.questionTypes;
  }
  if (config?.trivia?.questionsTypes !== undefined) {
    return config.trivia.questionsTypes;
  }
  return DEFAULT_QUESTION_TYPE_WEIGHTS;
}

/**
 * Resolves the active question-type weights for `get_ideas` (no slot — pre-format
 * behavior). Loads the current season state on every call by design (no caching)
 * so mid-season `upsert_season` edits take effect on the next invocation.
 */
export async function getActiveQuestionTypes(
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
  return resolveQuestionTypes(current, null, config);
}

/**
 * Resolves the active choice-count bounds. Workspace-only by design — `choices.{min,max}`
 * is a card-readability UX setting, not gameplay state, so it is never season-scoped.
 */
export function getActiveChoiceBounds(config: Config): { min: number; max: number } {
  return config.trivia?.choices ?? DEFAULT_TRIVIA_CHOICES;
}
