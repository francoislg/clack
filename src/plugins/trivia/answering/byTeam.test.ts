import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createFakeSdk, primeTriviaConfig } from "../testHelpers.fakeSdk.js";
import { createTriviaDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import type { FakeScopedTriviaDataLayer, FakeTriviaDataLayer } from "../testHelpers.js";
import type { SubmittedAnswer, TeamAnswerSlot, TriviaUser } from "../core/types.js";
import type { TeamDef } from "../core/configTypes.js";
import { createByTeamAnswering } from "./byTeam.js";

const NOW = 1_700_000_000_000;
const ROSTER: TeamDef[] = [
  { name: "Red", userIds: ["U1", "U2"] },
  { name: "Blue", userIds: ["U3"] },
];

describe("ByTeamAnswering", () => {
  let dataLayer: FakeTriviaDataLayer;
  let scoped: FakeScopedTriviaDataLayer;
  let strategy: ReturnType<typeof createByTeamAnswering>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    dataLayer = createTriviaDataLayer(sdk).dataLayer;
    scoped = dataLayer.forGame(FIXTURE_GAME_NAME);
    strategy = createByTeamAnswering(scoped, dataLayer, ROSTER);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCurrentAnswerFor", () => {
    it("projects the team slot for a roster member (userId → team:<name>)", async () => {
      const slot: TeamAnswerSlot = {
        teamName: "Red",
        questionId: "Q1",
        answer: true,
        correct: true,
        lastAnsweredBy: "U2",
        timestamp: 5,
      };
      scoped.loadTeamAnswers.mockResolvedValue([slot]);
      // U1 and U2 are both on Red — either sees the team's current slot.
      expect(await strategy.getCurrentAnswerFor("U1", "Q1")).toEqual({
        userId: "team:Red",
        questionId: "Q1",
        answer: true,
        correct: true,
        timestamp: 5,
      });
    });

    it("returns undefined when the team has no slot yet", async () => {
      scoped.loadTeamAnswers.mockResolvedValue([]);
      expect(await strategy.getCurrentAnswerFor("U1", "Q1")).toBeUndefined();
    });

    it("delegates to the individual row for a free agent", async () => {
      const row: SubmittedAnswer = { userId: "U9", questionId: "Q1", answer: false, timestamp: 3 };
      scoped.loadAnswers.mockResolvedValue([row]);
      scoped.loadTeamAnswers.mockResolvedValue([]);
      expect(await strategy.getCurrentAnswerFor("U9", "Q1")).toEqual(row);
    });
  });

  describe("answer — override semantics", () => {
    it("writes the team slot with lastAnsweredBy and NO identity side effects", async () => {
      scoped.loadTeamAnswers.mockResolvedValue([]);

      await strategy.answer("U1", "Q1", { answer: true, correct: true }, { season: "s1" });

      expect(scoped.upsertTeamAnswer).toHaveBeenCalledWith({
        teamName: "Red",
        questionId: "Q1",
        answer: true,
        correct: true,
        lastAnsweredBy: "U1",
        timestamp: NOW,
        season: "s1",
      });
      expect(dataLayer.recordJoin).not.toHaveBeenCalled();
      expect(dataLayer.refreshIdentities).not.toHaveBeenCalled();
      expect(scoped.saveAnswer).not.toHaveBeenCalled();
    });

    it("a second member's click overwrites the slot (last-click-wins, lastAnsweredBy swaps)", async () => {
      // The real store is faked, so drive the actual upsert to observe the overwrite.
      await strategy.answer("U1", "Q1", { answer: true, correct: true }, {});
      await strategy.answer("U2", "Q1", { answer: false, correct: false }, {});

      const slots = await scoped.loadTeamAnswers();
      expect(slots).toHaveLength(1);
      expect(slots[0]).toMatchObject({
        teamName: "Red",
        answer: false,
        correct: false,
        lastAnsweredBy: "U2",
      });
    });

    it("a free agent's answer falls through to individual semantics (join side effects)", async () => {
      scoped.loadAnswers.mockResolvedValue([]);

      await strategy.answer("U9", "Q1", { answer: true, correct: true }, { season: "s1" });

      expect(scoped.saveAnswer).toHaveBeenCalledWith({
        userId: "U9",
        questionId: "Q1",
        timestamp: NOW,
        answer: true,
        correct: true,
        season: "s1",
      });
      expect(dataLayer.recordJoin).toHaveBeenCalledWith("U9");
      expect(scoped.upsertTeamAnswer).not.toHaveBeenCalled();
    });
  });

  describe("projections", () => {
    it("getFinalAnswers merges free-agent rows with synthetic team rows", async () => {
      scoped.loadAnswers.mockResolvedValue([
        { userId: "U9", questionId: "Q1", answer: true, correct: true, timestamp: 2 },
        // A stray member raw row is filtered out — members answer via the slot.
        { userId: "U1", questionId: "Q1", answer: false, correct: false, timestamp: 2 },
      ]);
      scoped.loadTeamAnswers.mockResolvedValue([
        {
          teamName: "Red",
          questionId: "Q1",
          answer: true,
          correct: true,
          lastAnsweredBy: "U2",
          timestamp: 4,
        },
      ]);

      const rows = await strategy.getFinalAnswers("Q1");
      expect(rows).toEqual([
        { userId: "U9", questionId: "Q1", answer: true, correct: true, timestamp: 2 },
        { userId: "team:Red", questionId: "Q1", answer: true, correct: true, timestamp: 4 },
      ]);
    });

    it("getAllScoredAnswers returns raw rows plus every slot projected", async () => {
      scoped.loadAnswers.mockResolvedValue([
        { userId: "U9", questionId: "Q1", answer: true, timestamp: 1 },
      ]);
      scoped.loadTeamAnswers.mockResolvedValue([
        {
          teamName: "Blue",
          questionId: "Q1",
          answerIndex: 2,
          correct: false,
          lastAnsweredBy: "U3",
          timestamp: 3,
        },
      ]);
      expect(await strategy.getAllScoredAnswers()).toEqual([
        { userId: "U9", questionId: "Q1", answer: true, timestamp: 1 },
        { userId: "team:Blue", questionId: "Q1", answerIndex: 2, correct: false, timestamp: 3 },
      ]);
    });
  });

  describe("applyVerdict", () => {
    it("patches the team slot for a team owner key", async () => {
      scoped.loadTeamAnswers.mockResolvedValue([
        {
          teamName: "Red",
          questionId: "Q1",
          answerText: "paris",
          lastAnsweredBy: "U1",
          timestamp: 4,
        },
      ]);

      await strategy.applyVerdict("team:Red", "Q1", { correct: true, judgeReason: "exact" });

      expect(scoped.upsertTeamAnswer).toHaveBeenCalledWith({
        teamName: "Red",
        questionId: "Q1",
        answerText: "paris",
        lastAnsweredBy: "U1",
        timestamp: 4,
        correct: true,
        judgeReason: "exact",
      });
    });

    it("delegates to the individual row for a plain user key", async () => {
      await strategy.applyVerdict("U9", "Q1", { correct: false });
      expect(scoped.updateAnswer).toHaveBeenCalledWith("U9", "Q1", { correct: false });
      expect(scoped.upsertTeamAnswer).not.toHaveBeenCalled();
    });
  });

  describe("ownerLabel", () => {
    const users = new Map<string, TriviaUser>([["U1", { userId: "U1", displayName: "Alice" }]]);

    it("renders a bold team name for a team owner key (never a mention)", () => {
      expect(strategy.ownerLabel("team:Red", { tagPlayers: true, users })).toBe("*Red*");
      expect(strategy.ownerLabel("team:Red", { tagPlayers: false, users })).toBe("*Red*");
    });

    it("delegates to the player reference for an individual key", () => {
      expect(strategy.ownerLabel("U1", { tagPlayers: true, users })).toBe("<@U1>");
      expect(strategy.ownerLabel("U1", { tagPlayers: false, users })).toBe("@Alice");
    });
  });
});
