/**
 * Cascade resolver for the `revealResponses` axis. Called by `post_questions`
 * at post-time to stamp the resolved enum value onto each question record.
 *
 * Cascade order: `slot → season → game → workspace → "yes" (default)`.
 *
 * The first defined value wins. Once stamped on the question record, this
 * value is read by `process_reveal_answers` when assembling the per-reveal
 * payload's `voters` field — the cascade is NOT re-resolved at reveal time.
 * Mid-round config edits do not retroactively affect questions already posted.
 */

import type {
  RevealResponsesMode,
  SeasonFormatSlot,
  TriviaConfig,
  TriviaGame,
} from "./configTypes.js";
import type { SeasonEntry } from "./types.js";

export interface ResolveRevealResponsesParams {
  slot?: Pick<SeasonFormatSlot, "revealResponses">;
  season?: Pick<SeasonEntry, "revealResponses">;
  game?: Pick<TriviaGame, "revealResponses">;
  config?: Pick<TriviaConfig, "revealResponses">;
}

/**
 * Resolve `revealResponses` for one question being posted. Returns the
 * highest-precedence defined value, or `"yes"` when nothing overrides.
 */
export function resolveRevealResponses(params: ResolveRevealResponsesParams): RevealResponsesMode {
  if (params.slot?.revealResponses !== undefined) return params.slot.revealResponses;
  if (params.season?.revealResponses !== undefined) return params.season.revealResponses;
  if (params.game?.revealResponses !== undefined) return params.game.revealResponses;
  if (params.config?.revealResponses !== undefined) return params.config.revealResponses;
  return "yes";
}
