import type { CascadeAxes } from "../core/cascadeAxes.js";
import type { SeasonEntry } from "../core/types.js";
import type { TriviaGame } from "../core/configTypes.js";

/**
 * A field name an `upsert_game` call wrote: a cascading axis, the `format`
 * pseudo-field, or one of the season-tier-only teams fields.
 */
export type WrittenField = keyof CascadeAxes | "format" | TeamsWrittenField;

/** The teams-family fields cascade `season → game → workspace` with NO slot tier. */
const TEAMS_WRITTEN_FIELDS = [
  "teams",
  "teamsEnabled",
  "teamsFinaleIndividuals",
  "teamsScoring",
  "answeringType",
] as const;
export type TeamsWrittenField = (typeof TEAMS_WRITTEN_FIELDS)[number];

function isTeamsField(field: WrittenField): field is TeamsWrittenField {
  return (TEAMS_WRITTEN_FIELDS as readonly string[]).includes(field);
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
    if (season !== null && season[field] !== undefined) {
      seasonShadowed.push(field);
      continue;
    }
    // Teams fields have no slot tier — season shadowing is the only kind possible.
    if (isTeamsField(field)) continue;
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
