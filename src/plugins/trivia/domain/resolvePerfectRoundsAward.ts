import type { SeasonEntry } from "../core/types.js";
import type { TriviaConfig, TriviaGame, PerfectRoundsAward } from "../core/configTypes.js";
import { DEFAULT_PERFECT_ROUNDS_AWARD } from "../core/configTypes.js";

/**
 * Pure resolver for the `perfectRoundsAward` knob. Cascade (first tier that
 * supplies a value wins, whole-value replace):
 *   season → game → workspace → { enabled: false }.
 * Structural-special (no slot tier), like `tagPlayers` / `answeringType`.
 */
export function resolvePerfectRoundsAward(
  season: SeasonEntry | null,
  game: TriviaGame | null,
  workspace: TriviaConfig | null,
): PerfectRoundsAward {
  if (season?.perfectRoundsAward !== undefined) return season.perfectRoundsAward;
  if (game?.perfectRoundsAward !== undefined) return game.perfectRoundsAward;
  if (workspace?.perfectRoundsAward !== undefined) return workspace.perfectRoundsAward;
  return DEFAULT_PERFECT_ROUNDS_AWARD;
}
