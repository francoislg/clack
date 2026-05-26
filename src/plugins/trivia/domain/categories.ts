import type { SeasonEntry } from "../core/types.js";
import type { SeasonFormat, SeasonFormatSlot, TriviaGame } from "../core/configTypes.js";

/**
 * Pure resolver for the active category pool. Cascade:
 *   `slot.categories → season.categories → game.categories → globalCategories`.
 *
 * `slotIndex` is consulted only when an effective format is present (either the
 * season's or the game's, resolved via `resolveEffectiveFormat`).
 *
 * `globalCategories` is the always-present floor (loaded from
 * `data/plugins/trivia/categories.json`). The function never returns an empty
 * array unless that floor itself is empty.
 */
export function resolveActiveCategories(
  effectiveFormat: SeasonFormat | null,
  slotIndex: number | null,
  currentSeason: SeasonEntry | null,
  game: TriviaGame | null,
  globalCategories: string[],
): string[] {
  if (effectiveFormat !== null && slotIndex !== null) {
    const slot: SeasonFormatSlot | undefined = effectiveFormat.questions[slotIndex];
    if (slot?.categories !== undefined) return slot.categories;
  }
  if (currentSeason?.categories !== undefined && currentSeason.categories.length > 0) {
    return currentSeason.categories;
  }
  if (game?.categories !== undefined) return game.categories;
  return globalCategories;
}
