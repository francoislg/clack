import type { CascadeContext } from "../core/cascadeAxes.js";

/**
 * Pure resolver for the narrative `theme` axis. Cascade:
 *   `phase.theme → season.theme → game.theme → null`.
 *
 * Takes a `CascadeContext` (built by `buildCascadeContext`) and reads the phase
 * from `ctx.seasonPhase`, the season from `ctx.season`, and the game from
 * `ctx.game`. Returns `null` when no tier supplies a non-empty theme —
 * opener/finale prompts render with no theme line.
 */
export function resolveTheme(ctx: CascadeContext): string | null {
  const phaseTheme = ctx.seasonPhase?.theme;
  if (typeof phaseTheme === "string" && phaseTheme.length > 0) return phaseTheme;
  const seasonTheme = ctx.season?.theme;
  if (typeof seasonTheme === "string" && seasonTheme.length > 0) return seasonTheme;
  const gameTheme = ctx.game?.theme;
  if (typeof gameTheme === "string" && gameTheme.length > 0) return gameTheme;
  return null;
}
