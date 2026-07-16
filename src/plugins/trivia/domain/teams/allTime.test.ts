import { describe, it, expect } from "vitest";
import { computeTeamAllTime } from "./allTime.js";
import type { SeasonEntry, SeasonsState, SubmittedAnswer } from "../../core/types.js";
import type { TeamDef } from "../../core/configTypes.js";

const NO_POINTS = new Map<string, number>();

function answer(
  userId: string,
  questionId: string,
  season: string,
  correct = true,
): SubmittedAnswer {
  return { userId, questionId, correct, timestamp: 0, season };
}

function endedSeason(slug: string, stampTeams?: TeamDef[]): SeasonEntry {
  return {
    slug,
    startedAt: 0,
    expectedEndAt: 10,
    endedAt: 10,
    ...(stampTeams !== undefined
      ? { teamsStamp: { teams: stampTeams, teamsScoring: "one-right-is-right" as const } }
      : {}),
  };
}

const LIVE_ROSTER: TeamDef[] = [
  { name: "Red", userIds: ["U1"] },
  { name: "Blue", userIds: ["U2"] },
];

describe("computeTeamAllTime", () => {
  it("a returning team accumulates prior stamped seasons plus the live season", () => {
    const state: SeasonsState = {
      seasons: [
        endedSeason("s1", [{ name: "Red", userIds: ["U5"] }]),
        { slug: "s2", startedAt: 11, expectedEndAt: 20 },
      ],
    };
    const answers = [answer("U5", "q1", "s1"), answer("U5", "q2", "s1"), answer("U1", "q3", "s2")];
    const allTime = computeTeamAllTime(
      answers,
      state,
      LIVE_ROSTER,
      "one-right-is-right",
      "s2",
      NO_POINTS,
    );
    expect(allTime.get("Red")).toBe(3);
    expect(allTime.has("Blue")).toBe(false);
  });

  it("matches team names case-insensitively (casing-only re-entry keeps history)", () => {
    const state: SeasonsState = {
      seasons: [endedSeason("s1", [{ name: "red", userIds: ["U1"] }])],
    };
    const answers = [answer("U1", "q1", "s1")];
    const allTime = computeTeamAllTime(
      answers,
      state,
      LIVE_ROSTER,
      "one-right-is-right",
      "s2",
      NO_POINTS,
    );
    expect(allTime.get("Red")).toBe(1);
  });

  it("a renamed team starts with no all-time history", () => {
    const state: SeasonsState = {
      seasons: [endedSeason("s1", [{ name: "Crimson", userIds: ["U1"] }])],
    };
    const answers = [answer("U1", "q1", "s1")];
    const allTime = computeTeamAllTime(
      answers,
      state,
      LIVE_ROSTER,
      "one-right-is-right",
      "s2",
      NO_POINTS,
    );
    expect(allTime.size).toBe(0);
  });

  it("ended seasons without a stamp contribute nothing (teams were off / legacy)", () => {
    const state: SeasonsState = { seasons: [endedSeason("s1")] };
    const answers = [answer("U1", "q1", "s1")];
    const allTime = computeTeamAllTime(
      answers,
      state,
      LIVE_ROSTER,
      "one-right-is-right",
      "s2",
      NO_POINTS,
    );
    expect(allTime.size).toBe(0);
  });

  it("each ended season scores with ITS stamped roster and mode, not the live ones", () => {
    const state: SeasonsState = {
      seasons: [
        {
          ...endedSeason("s1"),
          teamsStamp: {
            teams: [{ name: "Red", userIds: ["U7", "U8"] }],
            teamsScoring: "total-points",
          },
        },
      ],
    };
    const answers = [answer("U7", "q1", "s1"), answer("U8", "q1", "s1"), answer("U1", "q2", "s2")];
    const allTime = computeTeamAllTime(
      answers,
      state,
      LIVE_ROSTER,
      "one-right-is-right",
      "s2",
      NO_POINTS,
    );
    expect(allTime.get("Red")).toBe(3);
  });

  it("returns empty when seasons state is null", () => {
    const allTime = computeTeamAllTime(
      [],
      null,
      LIVE_ROSTER,
      "one-right-is-right",
      null,
      NO_POINTS,
    );
    expect(allTime.size).toBe(0);
  });
});
