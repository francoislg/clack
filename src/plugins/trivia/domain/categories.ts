import type { SeasonEntry } from "../core/types.js";
import type { SeasonFormat, SeasonFormatSlot, TriviaGame } from "../core/configTypes.js";

/**
 * Tier of the cascade that produced the resolved category pool. Returned by
 * `resolveActiveCategoriesWithSource` so callers (`get_ideas`, `save_question`,
 * `list_seasons`) can surface inheritance state to admins without re-deriving
 * the cascade themselves.
 */
export type CategorySource = "slot" | "season" | "game" | "global";

export interface ResolvedCategories {
  pool: string[];
  source: CategorySource;
}

/**
 * Resolver that returns BOTH the resolved pool and the tier that produced it.
 * Cascade:
 *   `slot.categories → season.categories → game.categories → globalCategories`.
 *
 * `slotIndex` is consulted only when an effective format is present (either the
 * season's or the game's, resolved via `resolveEffectiveFormat`).
 *
 * `globalCategories` is the always-present floor (loaded from
 * `data/plugins/trivia/categories.json`). The function never returns an empty
 * pool unless that floor itself is empty.
 */
export function resolveActiveCategoriesWithSource(
  effectiveFormat: SeasonFormat | null,
  slotIndex: number | null,
  currentSeason: SeasonEntry | null,
  game: TriviaGame | null,
  globalCategories: string[],
): ResolvedCategories {
  if (effectiveFormat !== null && slotIndex !== null) {
    const slot: SeasonFormatSlot | undefined = effectiveFormat.questions[slotIndex];
    if (slot?.categories !== undefined) return { pool: slot.categories, source: "slot" };
  }
  if (currentSeason?.categories !== undefined && currentSeason.categories.length > 0) {
    return { pool: currentSeason.categories, source: "season" };
  }
  if (game?.categories !== undefined) return { pool: game.categories, source: "game" };
  return { pool: globalCategories, source: "global" };
}

/**
 * Convenience wrapper that returns only the pool. Callers that don't need the
 * source tier can keep using this. New call sites that surface inheritance
 * state to Claude (or to admin UIs) should call
 * `resolveActiveCategoriesWithSource` directly.
 */
export function resolveActiveCategories(
  effectiveFormat: SeasonFormat | null,
  slotIndex: number | null,
  currentSeason: SeasonEntry | null,
  game: TriviaGame | null,
  globalCategories: string[],
): string[] {
  return resolveActiveCategoriesWithSource(
    effectiveFormat,
    slotIndex,
    currentSeason,
    game,
    globalCategories,
  ).pool;
}
