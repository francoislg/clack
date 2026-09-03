import type { CascadeContext } from "../core/cascadeAxes.js";

/**
 * Tier of the cascade that produced the resolved category pool. Returned by
 * `resolveActiveCategoriesWithSource` so callers (`get_ideas`, `save_question`,
 * `list_seasons`) can surface inheritance state to admins without re-deriving
 * the cascade themselves.
 */
export type CategorySource = "slot" | "phase" | "season" | "game" | "global";

export interface ResolvedCategories {
  pool: string[];
  source: CategorySource;
}

/**
 * Resolver that returns BOTH the resolved pool and the tier that produced it.
 * Cascade:
 *   `slot.categories → phase.categories → season.categories → game.categories → globalCategories`.
 *
 * Takes a `CascadeContext` (built by `buildCascadeContext`): the slot is read
 * from `ctx.seasonSlot ?? ctx.gameSlot` (the season slot overrides the game
 * slot), the phase from `ctx.seasonPhase`, and the season/game from `ctx.season`
 * / `ctx.game`. An empty `categories` array on the phase or season tier counts
 * as absent and falls through to the next tier.
 *
 * `globalCategories` is the always-present floor (loaded from
 * `data/plugins/trivia/categories.json`). The function never returns an empty
 * pool unless that floor itself is empty.
 */
export function resolveActiveCategoriesWithSource(
  ctx: CascadeContext,
  globalCategories: string[],
): ResolvedCategories {
  const slot = ctx.seasonSlot ?? ctx.gameSlot;
  if (slot?.categories !== undefined) return { pool: slot.categories, source: "slot" };
  const phase = ctx.seasonPhase;
  if (phase?.categories !== undefined && phase.categories.length > 0) {
    return { pool: phase.categories, source: "phase" };
  }
  const season = ctx.season;
  if (season?.categories !== undefined && season.categories.length > 0) {
    return { pool: season.categories, source: "season" };
  }
  const game = ctx.game;
  if (game?.categories !== undefined) return { pool: game.categories, source: "game" };
  return { pool: globalCategories, source: "global" };
}

/**
 * Convenience wrapper that returns only the pool. Callers that don't need the
 * source tier can keep using this. New call sites that surface inheritance
 * state to Claude (or to admin UIs) should call
 * `resolveActiveCategoriesWithSource` directly.
 */
export function resolveActiveCategories(ctx: CascadeContext, globalCategories: string[]): string[] {
  return resolveActiveCategoriesWithSource(ctx, globalCategories).pool;
}
