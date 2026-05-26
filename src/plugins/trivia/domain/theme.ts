import type { SeasonEntry } from "../core/types.js";
import type { TriviaGame } from "../core/configTypes.js";

/**
 * Pure resolver for the narrative `theme` axis. Cascade:
 *   `season.theme → game.theme → null`.
 *
 * Returns `null` when neither tier supplies a theme — opener/finale prompts
 * render with no theme line.
 */
export function resolveTheme(
  currentSeason: SeasonEntry | null,
  game: TriviaGame | null,
): string | null {
  const seasonTheme = currentSeason?.theme;
  if (typeof seasonTheme === "string" && seasonTheme.length > 0) return seasonTheme;
  const gameTheme = game?.theme;
  if (typeof gameTheme === "string" && gameTheme.length > 0) return gameTheme;
  return null;
}
