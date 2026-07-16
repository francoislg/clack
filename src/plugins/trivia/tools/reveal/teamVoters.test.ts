import { describe, it, expect } from "vitest";
import { groupVotersByTeam } from "./teamVoters.js";
import type { TeamDef } from "../../core/configTypes.js";
import type { Voter, VoterBuckets } from "./types.js";

const ROSTER: TeamDef[] = [
  { name: "Red", userIds: ["U1", "U2", "U3"] },
  { name: "Blue", userIds: ["U4", "U5"] },
];

function voter(userId: string, answerText?: string): Voter {
  return {
    userId,
    displayName: `name-${userId}`,
    ...(answerText !== undefined ? { answerText } : {}),
  };
}

function yesBuckets(
  overrides: Partial<Extract<VoterBuckets, { revealResponses: "yes" }>> = {},
): VoterBuckets {
  return {
    revealResponses: "yes",
    correct: [],
    incorrect: [],
    noAnswer: [],
    reactions: [],
    ...overrides,
  };
}

describe("groupVotersByTeam", () => {
  it("a mixed team lands once in Correct with no member names", () => {
    const grouped = groupVotersByTeam(
      yesBuckets({ correct: [voter("U1")], incorrect: [voter("U2"), voter("U3")] }),
      ROSTER,
    );
    expect(grouped?.correctTeams).toEqual([{ team: "Red" }]);
    expect(grouped?.incorrectTeams).toEqual([]);
  });

  it("a team whose members all missed lands in Incorrect", () => {
    const grouped = groupVotersByTeam(
      yesBuckets({ incorrect: [voter("U4"), voter("U5")] }),
      ROSTER,
    );
    expect(grouped?.incorrectTeams).toEqual([{ team: "Blue" }]);
    expect(grouped?.correctTeams).toEqual([]);
  });

  it("a team with no answers but a reactor lands in NoAnswer; a silent team lands nowhere", () => {
    const grouped = groupVotersByTeam(yesBuckets({ noAnswer: [voter("U4")] }), ROSTER);
    expect(grouped?.noAnswerTeams).toEqual(["Blue"]);
    expect(grouped?.correctTeams).toEqual([]);
    expect(grouped?.incorrectTeams).toEqual([]);
  });

  it("free agents pass through individually in every bucket", () => {
    const grouped = groupVotersByTeam(
      yesBuckets({
        correct: [voter("UFREE1"), voter("U1")],
        incorrect: [voter("UFREE2")],
        noAnswer: [voter("UFREE3")],
      }),
      ROSTER,
    );
    expect(grouped?.correctFreeAgents).toEqual([voter("UFREE1")]);
    expect(grouped?.incorrectFreeAgents).toEqual([voter("UFREE2")]);
    expect(grouped?.noAnswerFreeAgents).toEqual([voter("UFREE3")]);
  });

  it("collects member answer texts unattributed on the team entry", () => {
    const grouped = groupVotersByTeam(
      yesBuckets({
        correct: [voter("U1", "Napoleon")],
        incorrect: [voter("U2", "Wellington")],
      }),
      ROSTER,
    );
    expect(grouped?.correctTeams).toEqual([
      { team: "Red", answerTexts: ["Napoleon", "Wellington"] },
    ]);
  });

  it("just-winners groups only the correct bucket", () => {
    const grouped = groupVotersByTeam(
      {
        revealResponses: "just-winners",
        correct: [voter("U1", "42"), voter("UFREE")],
        incorrectCount: 3,
        noAnswerCount: 1,
        reactions: [],
      },
      ROSTER,
    );
    expect(grouped).toEqual({
      correctTeams: [{ team: "Red", answerTexts: ["42"] }],
      correctFreeAgents: [voter("UFREE")],
    });
  });

  it("returns undefined for the no variant", () => {
    expect(groupVotersByTeam({ revealResponses: "no", reactions: [] }, ROSTER)).toBeUndefined();
  });
});
