import { describe, it, expect } from "vitest";
import { computeTeamStandings } from "./computeTeamStandings.js";
import type { SubmittedAnswer } from "../../core/types.js";
import type { TeamDef } from "../../core/configTypes.js";

const ROSTER: TeamDef[] = [
  { name: "Red", userIds: ["U1", "U2"] },
  { name: "Blue", userIds: ["U3"] },
];

const NO_POINTS = new Map<string, number>();

function answer(
  overrides: Partial<SubmittedAnswer> & Pick<SubmittedAnswer, "userId" | "questionId">,
): SubmittedAnswer {
  return { timestamp: 0, ...overrides };
}

describe("computeTeamStandings", () => {
  it("one-right-is-right pays a question's worth at most once per team", () => {
    const answers = [
      answer({ userId: "U1", questionId: "q1", correct: true }),
      answer({ userId: "U2", questionId: "q1", correct: true }),
      answer({ userId: "U3", questionId: "q1", correct: true }),
    ];
    const standings = computeTeamStandings(answers, ROSTER, "one-right-is-right", null, NO_POINTS);
    expect(standings).toEqual([
      { name: "Blue", points: 1, answeredQuestions: 1 },
      { name: "Red", points: 1, answeredQuestions: 1 },
    ]);
  });

  it("total-points sums each correct member answer through the strategy", () => {
    const answers = [
      answer({ userId: "U1", questionId: "q1", correct: true }),
      answer({ userId: "U2", questionId: "q1", correct: true }),
      answer({ userId: "U2", questionId: "q2", correct: false }),
      answer({ userId: "U3", questionId: "q1", correct: true }),
    ];
    const standings = computeTeamStandings(answers, ROSTER, "total-points", null, NO_POINTS);
    expect(standings[0]).toEqual({ name: "Red", points: 2, answeredQuestions: 2 });
    expect(standings[1]).toEqual({ name: "Blue", points: 1, answeredQuestions: 1 });
  });

  it("pays a worth-N question through the points join", () => {
    const answers = [
      answer({ userId: "U1", questionId: "q3", correct: true }),
      answer({ userId: "U2", questionId: "q3", correct: true }),
    ];
    const points = new Map([["q3", 3]]);
    const one = computeTeamStandings(answers, ROSTER, "one-right-is-right", null, points);
    expect(one.find((s) => s.name === "Red")?.points).toBe(3);
    const total = computeTeamStandings(answers, ROSTER, "total-points", null, points);
    expect(total.find((s) => s.name === "Red")?.points).toBe(6);
  });

  it("recomputes retroactively: a new member's prior answers credit the team", () => {
    const answers = [
      answer({ userId: "U9", questionId: "q1", correct: true, season: "s1" }),
      answer({ userId: "U9", questionId: "q2", correct: true, season: "s1" }),
    ];
    const before = computeTeamStandings(answers, ROSTER, "total-points", "s1", NO_POINTS);
    expect(before.find((s) => s.name === "Red")?.points).toBe(0);

    const joined: TeamDef[] = [{ name: "Red", userIds: ["U1", "U2", "U9"] }];
    const after = computeTeamStandings(answers, joined, "total-points", "s1", NO_POINTS);
    expect(after).toEqual([{ name: "Red", points: 2, answeredQuestions: 2 }]);
  });

  it("free agents (users in no team) contribute to no team total", () => {
    const answers = [answer({ userId: "UFREE", questionId: "q1", correct: true })];
    const standings = computeTeamStandings(answers, ROSTER, "total-points", null, NO_POINTS);
    expect(standings.every((s) => s.points === 0)).toBe(true);
  });

  it("skips pending freeform rows and excluded users", () => {
    const answers = [
      answer({ userId: "U1", questionId: "q1" }),
      answer({ userId: "U2", questionId: "q1", correct: true }),
    ];
    const standings = computeTeamStandings(
      answers,
      ROSTER,
      "total-points",
      null,
      NO_POINTS,
      new Set(["U2"]),
    );
    expect(standings.find((s) => s.name === "Red")).toEqual({
      name: "Red",
      points: 0,
      answeredQuestions: 0,
    });
  });

  it("filters by season when filterSeason is set", () => {
    const answers = [
      answer({ userId: "U1", questionId: "q1", correct: true, season: "s1" }),
      answer({ userId: "U1", questionId: "q2", correct: true, season: "s2" }),
    ];
    const standings = computeTeamStandings(answers, ROSTER, "total-points", "s2", NO_POINTS);
    expect(standings.find((s) => s.name === "Red")?.points).toBe(1);
  });

  it("lists every roster team even when nobody answered", () => {
    const standings = computeTeamStandings([], ROSTER, "one-right-is-right", null, NO_POINTS);
    expect(standings.map((s) => s.name).sort()).toEqual(["Blue", "Red"]);
    expect(standings.every((s) => s.points === 0)).toBe(true);
  });
});
