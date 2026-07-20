/**
 * Teams-field validation shared by every tier that accepts them: the lenient
 * config-file parsers (games / workspace / season slices) and the strict
 * management tools (`upsert_game`, `upsert_season`, `set_workspace_config`).
 * One zod schema per concept = one source of truth for shape AND semantics.
 */

import { z } from "zod";
import { zodErrorToResult, type Result } from "../../../../plugins-sdk/sdk.js";
import { TEAMS_SCORING_KEYS } from "../configTypes.js";
import type { TeamDef, TeamsScoringMode } from "../configTypes.js";

const teamDefSchema = z.object({
  name: z.string().trim().min(1, "team name must be a non-empty string"),
  userIds: z
    .array(z.string().trim().min(1, "user id must be a non-empty string"))
    .min(1, "team must have at least one userId"),
});

const rosterSchema = z.array(teamDefSchema).superRefine((roster, ctx) => {
  // Team identity is the NAME, matched case-insensitively (both for duplicate
  // rejection here and for all-time history matching), so "Red" and "red" collide.
  const seenNames = new Map<string, string>();
  // A user in two teams would double-count under every scoring strategy.
  const userTeam = new Map<string, string>();
  roster.forEach((team, i) => {
    const lower = team.name.toLowerCase();
    const existingName = seenNames.get(lower);
    if (existingName !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [i, "name"],
        message: `duplicate team name "${team.name}" (collides case-insensitively with "${existingName}")`,
      });
    } else {
      seenNames.set(lower, team.name);
    }
    team.userIds.forEach((id, j) => {
      const owner = userTeam.get(id);
      if (owner !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [i, "userIds", j],
          message:
            owner === team.name
              ? `user "${id}" is listed twice in team "${team.name}"`
              : `user "${id}" appears in both "${owner}" and "${team.name}" — a user may belong to at most one team`,
        });
      } else {
        userTeam.set(id, team.name);
      }
    });
  });
});

/**
 * Validate a teams roster. Accepts an EMPTY array (an explicit "no teams" value
 * at that tier); rejects empty/duplicate (case-insensitive) team names, empty
 * `userIds`, and a user id appearing more than once across the roster.
 */
export function validateTeamsRoster(raw: unknown, fieldLabel: string): Result<TeamDef[]> {
  const r = rosterSchema.safeParse(raw);
  if (!r.success) return zodErrorToResult(r.error, fieldLabel);
  return { ok: true, value: r.data };
}

const scoringSchema = z.enum(TEAMS_SCORING_KEYS);

/**
 * Thin structural arg schemas for the MCP tool boundary (the `upsert_*` /
 * `set_workspace_config` schemas) — semantic depth (duplicate names,
 * overlapping membership) stays in `validateTeamsRoster`, which the handlers
 * re-run, same split as the `axes.ts` `*Zod` schemas.
 */
export const teamsRosterZod = z.array(
  z
    .object({
      name: z
        .string()
        .describe(
          "Team name — the team's identity across seasons (case-insensitive match; renaming severs all-time history).",
        ),
      userIds: z
        .array(z.string())
        .describe("Slack user IDs of the team's members. A user may belong to at most one team."),
    })
    .strict(),
);

export const teamsScoringZod = z.enum(TEAMS_SCORING_KEYS);

export function validateTeamsScoring(raw: unknown, fieldLabel: string): Result<TeamsScoringMode> {
  const r = scoringSchema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      error: `'${fieldLabel}' must be one of ${TEAMS_SCORING_KEYS.map((k) => `"${k}"`).join(", ")} (got ${JSON.stringify(raw)})`,
    };
  }
  return { ok: true, value: r.data };
}
