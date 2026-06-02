import type { CascadeContext } from "../core/cascadeAxes.js";
import type { SeasonEntry } from "../core/types.js";
import type { TriviaGame, TriviaConfig } from "../core/configTypes.js";
import { resolveEffectiveFormat } from "./format.js";

/**
 * Build the `CascadeContext` for a `(game, slot)` coordinate — the single place that
 * decides the slot-tier policy for every consumer (`get_ideas`, `post_questions`,
 * `explain_cascade`).
 *
 * The slot tier is read from the EFFECTIVE format (`resolveEffectiveFormat` =
 * `season.format ?? game.format`), so a game-format slot's per-question axis overrides
 * take effect when the game format is the active one — consistent with how per-slot
 * `categories`/`label` and the post-time axes already resolve. When a season format is
 * active it replaces the game format wholesale (the effective-format model is unchanged).
 */
export function buildCascadeContext(
  season: SeasonEntry | null,
  game: TriviaGame | null,
  slotIndex: number | null,
  config: TriviaConfig | null,
): CascadeContext {
  const effectiveFormat = resolveEffectiveFormat(season, game);
  const slot =
    slotIndex !== null && effectiveFormat !== null
      ? (effectiveFormat.questions[slotIndex] ?? null)
      : null;
  return { slot, slotIndex, season, game, config };
}
