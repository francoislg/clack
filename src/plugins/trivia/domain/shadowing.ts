import type { CascadeAxes } from "../core/cascadeAxes.js";
import type { SeasonEntry } from "../core/types.js";
import type { TriviaGame } from "../core/configTypes.js";

/**
 * A field name an `upsert_game` call wrote: a cascading axis, the `format`
 * pseudo-field, a structural-special field (season tier but no slot tier), or a
 * game-tier structural flag.
 */
export type WrittenField = keyof CascadeAxes | "format" | NoSlotTierField | "disableAfterRound";

// Structural-special fields: they cascade season → game → workspace with NO
// slot tier, so a game write can only ever be season-shadowed, never slot-shadowed.
const NO_SLOT_TIER_FIELDS = [
  "teams",
  "teamsEnabled",
  "teamsFinaleIndividuals",
  "teamsScoring",
  "answeringType",
  "perfectRoundsAward",
] as const;
export type NoSlotTierField = (typeof NO_SLOT_TIER_FIELDS)[number];

function isNoSlotTierField(field: WrittenField): field is NoSlotTierField {
  return (NO_SLOT_TIER_FIELDS as readonly string[]).includes(field);
}

/** Which higher-precedence tier masks the game-tier write, and the masked field names. */
export interface ShadowReport {
  tier: "season" | "slot";
  slug?: string;
  fields: string[];
}

/**
 * Detect whether a game-tier write is shadowed by a higher-precedence tier. `upsert_game`
 * writes the `game` tier, so a written field is shadowed when a tier ABOVE `game` supplies
 * a value for it: the active `season`, or — when no season format is active — a per-slot
 * override in the game's own `format` (a game masking its own top-level axis).
 *
 * Detection is by RAW field presence on the higher tier, which is exactly the
 * winning-tier-above-game condition (a higher tier setting the field is what makes it win)
 * and is uniform across first-wins and custom axes. Season shadowing takes priority and is
 * reported alone; slot shadowing is reported only when nothing is season-shadowed (i.e. no
 * season format is active). Returns `undefined` when nothing is shadowed.
 */
export function detectGameWriteShadowing(
  writtenFields: readonly WrittenField[],
  season: SeasonEntry | null,
  game: TriviaGame,
): ShadowReport | undefined {
  const seasonShadowed: string[] = [];
  const slotShadowed: string[] = [];

  for (const field of writtenFields) {
    if (field === "format") {
      // The game's format write is masked iff an active season format replaces it.
      if (season?.format !== undefined) seasonShadowed.push("format");
      continue;
    }
    // Game-tier-only structural flags have no higher-tier shadowing.
    if (field === "disableAfterRound") continue;
    if (season !== null && season[field] !== undefined) {
      seasonShadowed.push(field);
      continue;
    }
    // Structural-special fields have no slot tier — season shadowing is the only kind possible.
    if (isNoSlotTierField(field)) continue;
    if (
      season?.format === undefined &&
      game.format !== undefined &&
      game.format.questions.some((slot) => slot[field] !== undefined)
    ) {
      slotShadowed.push(field);
    }
  }

  if (seasonShadowed.length > 0 && season !== null) {
    return { tier: "season", slug: season.slug, fields: seasonShadowed };
  }
  if (slotShadowed.length > 0) {
    return { tier: "slot", fields: slotShadowed };
  }
  return undefined;
}
