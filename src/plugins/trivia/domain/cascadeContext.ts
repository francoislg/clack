import type { CascadeContext } from "../core/cascadeAxes.js";
import type { SeasonEntry, PhaseSlice } from "../core/types.js";
import type { TriviaGame, TriviaConfig, SeasonFormatSlot } from "../core/configTypes.js";
import { findPhaseBySlug, selectActivePhase } from "./seasonPhases.js";

/**
 * How to source the phase tier. `slug` (the reveal path, honouring a question's
 * stamp) wins over `at` (the time-selected path) when both are present; `{}`
 * selects no phase.
 */
export interface PhaseSelector {
  at?: number;
  slug?: string;
}

/**
 * Build the `CascadeContext` for a `(game, slot)` coordinate — the single place that
 * decides slot-tier and phase-tier sourcing for every consumer (`get_ideas`,
 * `save_question`, `post_questions`, `process_reveal_answers`, `explain_cascade`).
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
 * The `seasonPhase` tier (below `seasonSlot`, above `season`) is the season's active
 * temporal phase, sourced from `phase`: a `slug` selects the exact `PhaseSlice` a
 * question was posed under (the reveal path), otherwise an `at` timestamp selects the
 * slice whose derived window contains that instant; `{}` selects no phase.
 *
 * Neither slot nor the phase is re-derived by any downstream resolver — this is the
 * only function that reads per-slot composition and phase selection.
 */
export function buildCascadeContext(
  season: SeasonEntry | null,
  game: TriviaGame | null,
  slotIndex: number | null,
  config: TriviaConfig | null,
  phase: PhaseSelector,
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

  let seasonPhase: PhaseSlice | null = null;
  if (phase.slug !== undefined) {
    seasonPhase = findPhaseBySlug(season, phase.slug);
  } else if (phase.at !== undefined) {
    seasonPhase = selectActivePhase(season, phase.at);
  }

  return { seasonSlot, seasonPhase, gameSlot, slotIndex, season, game, config };
}
