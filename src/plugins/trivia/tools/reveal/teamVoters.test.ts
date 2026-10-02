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

  describe("alternate solves", () => {
    const alternate = (userId: string, answerText?: string): Voter => ({
      ...voter(userId, answerText),
      alternateSolve: true,
    });

    it("flags a correct team and lists its accepted alternate texts, unattributed", () => {
      const grouped = groupVotersByTeam(
        yesBuckets({
          correct: [alternate("U1", "Credit"), voter("U2", "hole")],
          incorrect: [voter("U3", "shadow")],
        }),
        ROSTER,
      );
      expect(grouped?.correctTeams).toEqual([
        {
          team: "Red",
          answerTexts: ["Credit", "hole", "shadow"],
          alternateSolve: true,
          alternateAnswerTexts: ["Credit"],
        },
      ]);
    });

    it("leaves a team whose correct answers were all on-key unflagged", () => {
      const grouped = groupVotersByTeam(
        yesBuckets({ correct: [voter("U1", "hole"), alternate("U4", "Credit")] }),
        ROSTER,
      );
      expect(grouped?.correctTeams).toEqual([
        { team: "Red", answerTexts: ["hole"] },
        {
          team: "Blue",
          answerTexts: ["Credit"],
          alternateSolve: true,
          alternateAnswerTexts: ["Credit"],
        },
      ]);
    });

    it("keeps the flag without any text in just-correctness mode", () => {
      const grouped = groupVotersByTeam(
        {
          revealResponses: "just-correctness",
          correct: [alternate("U1")],
          incorrect: [],
          noAnswer: [],
          reactions: [],
        },
        ROSTER,
      );
      expect(grouped?.correctTeams).toEqual([{ team: "Red", alternateSolve: true }]);
    });

    it("keeps the flag and the text in just-winners mode", () => {
      const grouped = groupVotersByTeam(
        {
          revealResponses: "just-winners",
          correct: [alternate("U1", "Credit")],
          incorrectCount: 0,
          noAnswerCount: 0,
          reactions: [],
        },
        ROSTER,
      );
      expect(grouped).toEqual({
        correctTeams: [
          {
            team: "Red",
            answerTexts: ["Credit"],
            alternateSolve: true,
            alternateAnswerTexts: ["Credit"],
          },
        ],
        correctFreeAgents: [],
      });
    });

    it("passes a free agent's flag through on the individual voter", () => {
      const grouped = groupVotersByTeam(
        yesBuckets({ correct: [alternate("UFREE", "Credit")] }),
        ROSTER,
      );
      expect(grouped?.correctFreeAgents).toEqual([alternate("UFREE", "Credit")]);
      expect(grouped?.correctTeams).toEqual([]);
    });
  });

  it("returns undefined for the no variant", () => {
    expect(groupVotersByTeam({ revealResponses: "no", reactions: [] }, ROSTER)).toBeUndefined();
  });
});
