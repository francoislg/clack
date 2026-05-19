import type { Config } from "../../config.js";
import { DEFAULT_TRIVIA_CHOICES } from "../../config.js";
import type { SeasonQuestionTypeWeights, SeasonsState, ScopedTriviaDataLayer } from "./types.js";
import { findCurrentSeason } from "./data.js";

/**
 * Built-in fallback when neither a current season nor workspace config provides
 * `questionsTypes`. Equivalent to pre-choice-questions behavior.
 */
export const DEFAULT_QUESTION_TYPE_WEIGHTS: SeasonQuestionTypeWeights = {
  boolean: 1,
  choice: 0,
};

/**
 * Resolves the active question-type weights for `get_ideas`.
 *
 * Priority order (first non-null source wins):
 *   1. `findCurrentSeason(state, now).questionTypes` — when seasons enabled, current
 *      entry exists (no gap), AND the field is set on that entry.
 *   2. `config.trivia.questionsTypes` — workspace default.
 *   3. `DEFAULT_QUESTION_TYPE_WEIGHTS` — pure-boolean fallback.
 *
 * Reads on every call by design (no caching) so mid-season `upsert_season` edits
 * take effect on the next `get_ideas` invocation.
 */
export async function getActiveQuestionTypes(
  scoped: ScopedTriviaDataLayer,
  config: Config,
  now: number,
): Promise<SeasonQuestionTypeWeights> {
  const seasonsEnabled = config.trivia?.seasons?.enabled ?? false;
  if (seasonsEnabled) {
    const state: SeasonsState | null = await scoped.loadSeasonsState();
    const current = findCurrentSeason(state, now);
    if (current?.questionTypes !== undefined) {
      return current.questionTypes;
    }
  }
  if (config.trivia?.questionsTypes !== undefined) {
    return config.trivia.questionsTypes;
  }
  return DEFAULT_QUESTION_TYPE_WEIGHTS;
}

/**
 * Resolves the active choice-count bounds. Workspace-only by design — `choices.{min,max}`
 * is a card-readability UX setting, not gameplay state, so it is never season-scoped.
 */
export function getActiveChoiceBounds(config: Config): { min: number; max: number } {
  return config.trivia?.choices ?? DEFAULT_TRIVIA_CHOICES;
}
