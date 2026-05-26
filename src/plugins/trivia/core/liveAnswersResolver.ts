/**
 * Cascade resolver for the `liveAnswersVisible` axis. Called by `post_questions`
 * at post-time to stamp the resolved boolean onto each question record.
 *
 * Cascade order: `slot → season → game → workspace → true (default)`.
 *
 * The first defined value wins. Once stamped on the question record, this
 * value is read by the live-roster-footer rebuild (`editRosterIntoCard`) — the
 * cascade is NOT re-resolved at rebuild time, so mid-round config edits do
 * not flip live behavior under questions that are already collecting answers.
 */

import type { SeasonFormatSlot, TriviaConfig, TriviaGame } from "./configTypes.js";
import type { SeasonEntry } from "./types.js";

export interface ResolveLiveAnswersVisibleParams {
  slot?: Pick<SeasonFormatSlot, "liveAnswersVisible">;
  season?: Pick<SeasonEntry, "liveAnswersVisible">;
  game?: Pick<TriviaGame, "liveAnswersVisible">;
  config?: Pick<TriviaConfig, "liveAnswersVisible">;
}

/**
 * Resolve `liveAnswersVisible` for one question being posted. Returns the
 * highest-precedence defined value, or `true` when nothing overrides.
 */
export function resolveLiveAnswersVisible(params: ResolveLiveAnswersVisibleParams): boolean {
  if (params.slot?.liveAnswersVisible !== undefined) return params.slot.liveAnswersVisible;
  if (params.season?.liveAnswersVisible !== undefined) return params.season.liveAnswersVisible;
  if (params.game?.liveAnswersVisible !== undefined) return params.game.liveAnswersVisible;
  if (params.config?.liveAnswersVisible !== undefined) return params.config.liveAnswersVisible;
  return true;
}
