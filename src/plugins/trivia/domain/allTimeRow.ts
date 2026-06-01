import type { TriviaAllTimeRowMode, TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { DEFAULT_ALL_TIME_ROW } from "../core/configTypes.js";

/**
 * Pure resolver for the `allTimeRow` axis. Cascade:
 *   `game.allTimeRow → workspace.allTimeRow → "end-of-season-only"`.
 *
 * No season or slot tier (unlike the weighted axes). The first tier that
 * supplies a value wins; when no tier supplies one, returns the built-in
 * default `"end-of-season-only"`.
 */
export function resolveAllTimeRow(
  game: TriviaGame | null,
  workspace: TriviaConfig | null,
): TriviaAllTimeRowMode {
  if (game?.allTimeRow !== undefined) return game.allTimeRow;
  if (workspace?.allTimeRow !== undefined) return workspace.allTimeRow;
  return DEFAULT_ALL_TIME_ROW;
}

/**
 * Decide whether the All-Time leaderboard surface (the normal-reveal `All Time`
 * row and the season-finale All-Time table) should render, from the resolved
 * `allTimeRow` mode and whether this reveal is the season's last fire.
 *
 * - `"always"` → always show.
 * - `"never"` → never show.
 * - `"end-of-season-only"` → show only on the season's last fire.
 *
 * NOTE: the All-Time surface ALSO requires `seasonStatus.hasPriorSeasons` — that
 * gate is applied by the renderer, not here (a single season would make "All
 * Time" redundant with "Current Season").
 */
export function shouldShowAllTimeRow(
  mode: TriviaAllTimeRowMode,
  isLastFireOfSeason: boolean,
): boolean {
  switch (mode) {
    case "always":
      return true;
    case "never":
      return false;
    case "end-of-season-only":
      return isLastFireOfSeason;
  }
}
