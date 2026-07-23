import { describe, it, expect } from "vitest";
import { resolveTeamsConfig } from "./resolveTeamsConfig.js";
import type { SeasonEntry } from "../../core/types.js";
import type { TeamDef, TriviaGame } from "../../core/configTypes.js";

const ROSTER_A: TeamDef[] = [{ name: "Red", userIds: ["U1", "U2"] }];
const ROSTER_B: TeamDef[] = [{ name: "Blue", userIds: ["U3"] }];

function season(overrides: Partial<SeasonEntry> = {}): SeasonEntry {
  return { slug: "season-2026-07", startedAt: 0, expectedEndAt: 10, ...overrides };
}

function game(overrides: Partial<TriviaGame> = {}): TriviaGame {
  return {
    name: "g",
    channel: "C1",
    questionCron: "0 9 * * *",
    revealCron: "0 17 * * *",
    timezone: "UTC",
    ...overrides,
  };
}

describe("resolveTeamsConfig", () => {
  it("returns built-in defaults when no tier sets anything", () => {
    const r = resolveTeamsConfig(null, null, null);
    expect(r).toEqual({
      enabled: false,
      roster: [],
      scoring: "one-right-is-right",
      finaleIndividuals: false,
      inertEnabled: false,
      answeringType: "individual",
      inertAnsweringType: false,
    });
  });

  it("season tier wins over game and workspace for every field", () => {
    const r = resolveTeamsConfig(
      season({
        teams: ROSTER_A,
        teamsEnabled: true,
        teamsScoring: "total-points",
        teamsFinaleIndividuals: true,
      }),
      game({ teams: ROSTER_B, teamsEnabled: false, teamsScoring: "one-right-is-right" }),
      { teams: ROSTER_B, teamsEnabled: false, teamsFinaleIndividuals: false },
    );
    expect(r.enabled).toBe(true);
    expect(r.roster).toEqual(ROSTER_A);
    expect(r.scoring).toBe("total-points");
    expect(r.finaleIndividuals).toBe(true);
  });

  it("game tier wins over workspace", () => {
    const r = resolveTeamsConfig(null, game({ teams: ROSTER_A, teamsEnabled: true }), {
      teams: ROSTER_B,
      teamsEnabled: false,
    });
    expect(r.enabled).toBe(true);
    expect(r.roster).toEqual(ROSTER_A);
  });

  it("workspace tier applies when higher tiers are silent", () => {
    const r = resolveTeamsConfig(null, game(), {
      teams: ROSTER_B,
      teamsEnabled: true,
      teamsScoring: "total-points",
    });
    expect(r.enabled).toBe(true);
    expect(r.roster).toEqual(ROSTER_B);
    expect(r.scoring).toBe("total-points");
  });

  it("fields cascade independently: season enables, workspace supplies the roster", () => {
    const r = resolveTeamsConfig(season({ teamsEnabled: true }), game(), { teams: ROSTER_B });
    expect(r.enabled).toBe(true);
    expect(r.roster).toEqual(ROSTER_B);
  });

  it("roster presence never activates: workspace roster with no enablement stays off", () => {
    const r = resolveTeamsConfig(null, null, { teams: ROSTER_A });
    expect(r.enabled).toBe(false);
    expect(r.inertEnabled).toBe(false);
  });

  it("enabled with an empty effective roster resolves to OFF and flags inertEnabled", () => {
    const r = resolveTeamsConfig(season({ teamsEnabled: true }), game(), null);
    expect(r.enabled).toBe(false);
    expect(r.inertEnabled).toBe(true);
  });

  it("an explicit empty season roster masks a lower-tier roster (whole-roster replace)", () => {
    const r = resolveTeamsConfig(season({ teams: [], teamsEnabled: true }), game(), {
      teams: ROSTER_B,
    });
    expect(r.enabled).toBe(false);
    expect(r.inertEnabled).toBe(true);
    expect(r.roster).toEqual([]);
  });

  it("a season disabling teams wins over an enabling lower tier", () => {
    const r = resolveTeamsConfig(
      season({ teamsEnabled: false }),
      game({ teams: ROSTER_A, teamsEnabled: true }),
      null,
    );
    expect(r.enabled).toBe(false);
    expect(r.inertEnabled).toBe(false);
  });
});

describe("resolveTeamsConfig — answeringType (shared buzzer)", () => {
  it("defaults to individual, not inert", () => {
    const r = resolveTeamsConfig(null, null, null);
    expect(r.answeringType).toBe("individual");
    expect(r.inertAnsweringType).toBe(false);
  });

  it("resolves byTeam when teams are effectively on", () => {
    const r = resolveTeamsConfig(
      null,
      game({ teams: ROSTER_A, teamsEnabled: true, answeringType: "byTeam" }),
      null,
    );
    expect(r.answeringType).toBe("byTeam");
    expect(r.inertAnsweringType).toBe(false);
  });

  it("byTeam with teams disabled is inert → falls back to individual", () => {
    const r = resolveTeamsConfig(
      null,
      game({ teams: ROSTER_A, teamsEnabled: false, answeringType: "byTeam" }),
      null,
    );
    expect(r.answeringType).toBe("individual");
    expect(r.inertAnsweringType).toBe(true);
  });

  it("byTeam with an empty roster is inert → falls back to individual", () => {
    const r = resolveTeamsConfig(null, game({ teamsEnabled: true, answeringType: "byTeam" }), null);
    expect(r.answeringType).toBe("individual");
    expect(r.inertAnsweringType).toBe(true);
  });

  it("cascades independently: season sets byTeam, game supplies the enabled roster", () => {
    const r = resolveTeamsConfig(
      season({ answeringType: "byTeam" }),
      game({ teams: ROSTER_A, teamsEnabled: true }),
      null,
    );
    expect(r.answeringType).toBe("byTeam");
    expect(r.inertAnsweringType).toBe(false);
  });

  it("season individual masks a lower-tier byTeam", () => {
    const r = resolveTeamsConfig(
      season({ answeringType: "individual" }),
      game({ teams: ROSTER_A, teamsEnabled: true, answeringType: "byTeam" }),
      null,
    );
    expect(r.answeringType).toBe("individual");
    expect(r.inertAnsweringType).toBe(false);
  });
});
