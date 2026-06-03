import type { CascadeContext } from "../core/cascadeAxes.js";
import type { SeasonEntry } from "../core/types.js";
import type { TriviaGame, TriviaConfig, SeasonFormatSlot } from "../core/configTypes.js";

/**
 * Build the `CascadeContext` for a `(game, slot)` coordinate — the single place that
 * decides slot-tier sourcing for every consumer (`get_ideas`, `save_question`,
 * `post_questions`, `process_reveal_answers`, `explain_cascade`).
 *
 * GAME-BASE / SEASON-OVERRIDE model. The slot tier is split in two:
 *
 *   - `gameSlot` = `game.format.questions[slotIndex]` — the authoritative per-question
 *     BASE. It is read from the GAME format regardless of whether a season is active.
 *   - `seasonSlot` = the season's per-slot OVERRIDE for the same index, which wins over
 *     `gameSlot`. Two possible sources, in order:
 *       1. `season.slotOverrides[slotIndex]` — sparse, count-decoupled overrides.
 *       2. `season.format.questions[slotIndex]` — when the season declares its OWN
 *          structural format (which also drives the question count).
 *     `slotOverrides` and `format` are mutually exclusive on a season (enforced at parse
 *     time), so the builder never sees both and the precedence above is unambiguous.
 *
 * Neither slot is re-derived from `season.format` by any downstream resolver — this is
 * the only function that reads per-slot composition.
 */
export function buildCascadeContext(
  season: SeasonEntry | null,
  game: TriviaGame | null,
  slotIndex: number | null,
  config: TriviaConfig | null,
): CascadeContext {
  const gameSlot: SeasonFormatSlot | null =
    slotIndex !== null ? (game?.format?.questions[slotIndex] ?? null) : null;

  let seasonSlot: SeasonFormatSlot | null = null;
  if (slotIndex !== null && season !== null) {
    const override = season.slotOverrides?.[slotIndex];
    if (override !== undefined) {
      seasonSlot = override;
    } else if (season.format !== undefined) {
      seasonSlot = season.format.questions[slotIndex] ?? null;
    }
  }

  return { seasonSlot, gameSlot, slotIndex, season, game, config };
}
