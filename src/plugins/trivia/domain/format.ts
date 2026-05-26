import type { SeasonEntry } from "../core/types.js";
import type { SeasonFormat, TriviaGame } from "../core/configTypes.js";

/**
 * Pure resolver for the `format` field. Returns the first present tier's
 * format, or `null` when neither the season nor the game supplies one (in
 * which case the cron fire posts a single question, the pre-format behavior).
 *
 * Cascade: `season.format → game.format → null`.
 */
export function resolveEffectiveFormat(
  currentSeason: SeasonEntry | null,
  game: TriviaGame | null,
): SeasonFormat | null {
  if (currentSeason?.format !== undefined) return currentSeason.format;
  if (game?.format !== undefined) return game.format;
  return null;
}
