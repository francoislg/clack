import type { SeasonEntry } from "../../core/types.js";
import type {
  TeamDef,
  TeamsScoringMode,
  TriviaConfig,
  TriviaGame,
} from "../../core/configTypes.js";
import {
  DEFAULT_TEAMS_ENABLED,
  DEFAULT_TEAMS_FINALE_INDIVIDUALS,
  DEFAULT_TEAMS_SCORING,
} from "../../core/configTypes.js";

/** The fully-resolved teams config for one game at one instant. */
export interface EffectiveTeamsConfig {
  /**
   * Teams mode is ON: some tier explicitly enabled it AND the effective roster
   * is non-empty. An enabled config with an empty roster resolves to OFF
   * (`inertEnabled` carries the misconfiguration signal).
   */
  enabled: boolean;
  roster: TeamDef[];
  scoring: TeamsScoringMode;
  finaleIndividuals: boolean;
  /**
   * True when some tier set `teamsEnabled: true` but the effective roster is
   * empty — teams mode is inert. Surfaced as a `list_games` warning.
   */
  inertEnabled: boolean;
}

function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
  for (const v of values) if (v !== undefined) return v;
  return undefined;
}

/**
 * Pure resolver for the four teams fields. Each field cascades INDEPENDENTLY
 * first-wins `season → game → workspace → built-in default` — a season that
 * sets only `teamsEnabled` still inherits a lower-tier roster. Structural-
 * special (like `theme` / `allTimeRow` / `tagPlayers`): no slot tier, not a
 * `CascadeAxes` member.
 */
export function resolveTeamsConfig(
  season: SeasonEntry | null,
  game: TriviaGame | null,
  workspace: TriviaConfig | null,
): EffectiveTeamsConfig {
  const roster = firstDefined(season?.teams, game?.teams, workspace?.teams) ?? [];
  const enabledRequested =
    firstDefined(season?.teamsEnabled, game?.teamsEnabled, workspace?.teamsEnabled) ??
    DEFAULT_TEAMS_ENABLED;
  const scoring =
    firstDefined(season?.teamsScoring, game?.teamsScoring, workspace?.teamsScoring) ??
    DEFAULT_TEAMS_SCORING;
  const finaleIndividuals =
    firstDefined(
      season?.teamsFinaleIndividuals,
      game?.teamsFinaleIndividuals,
      workspace?.teamsFinaleIndividuals,
    ) ?? DEFAULT_TEAMS_FINALE_INDIVIDUALS;

  return {
    enabled: enabledRequested && roster.length > 0,
    roster,
    scoring,
    finaleIndividuals,
    inertEnabled: enabledRequested && roster.length === 0,
  };
}
