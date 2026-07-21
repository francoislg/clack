import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createFakeSdk, primeTriviaConfig } from "../testHelpers.fakeSdk.js";
import { createTriviaDataLayer, FIXTURE_GAME_NAME } from "../testHelpers.js";
import type { FakeScopedTriviaDataLayer, FakeTriviaDataLayer } from "../testHelpers.js";
import type { SubmittedAnswer, TriviaUser } from "../core/types.js";
import { createIndividualAnswering } from "./individual.js";

const NOW = 1_700_000_000_000;

describe("IndividualAnswering", () => {
  let dataLayer: FakeTriviaDataLayer;
  let scoped: FakeScopedTriviaDataLayer;
  let strategy: ReturnType<typeof createIndividualAnswering>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    dataLayer = createTriviaDataLayer(sdk).dataLayer;
    scoped = dataLayer.forGame(FIXTURE_GAME_NAME);
    strategy = createIndividualAnswering(scoped, dataLayer);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCurrentAnswerFor", () => {
    it("returns the row keyed by (userId, questionId)", async () => {
      const row: SubmittedAnswer = { userId: "U1", questionId: "Q1", answer: true, timestamp: 1 };
      scoped.loadAnswers.mockResolvedValue([
        { userId: "U2", questionId: "Q1", answer: false, timestamp: 1 },
        row,
      ]);
      expect(await strategy.getCurrentAnswerFor("U1", "Q1")).toEqual(row);
    });

    it("returns undefined when no row matches", async () => {
      scoped.loadAnswers.mockResolvedValue([]);
      expect(await strategy.getCurrentAnswerFor("U1", "Q1")).toBeUndefined();
    });
  });

  describe("answer", () => {
    it("appends a new row with join side effects on first write", async () => {
      scoped.loadAnswers.mockResolvedValue([]);

      await strategy.answer("U1", "Q1", { answer: true, correct: false }, { season: "s1" });

      expect(scoped.saveAnswer).toHaveBeenCalledWith({
        userId: "U1",
        questionId: "Q1",
        timestamp: NOW,
        answer: true,
        correct: false,
        season: "s1",
      });
      expect(scoped.updateAnswer).not.toHaveBeenCalled();
      expect(dataLayer.recordJoin).toHaveBeenCalledWith("U1");
      expect(dataLayer.refreshIdentities).toHaveBeenCalledWith(["U1"]);
    });

    it("omits the season tag when opts.season is absent", async () => {
      scoped.loadAnswers.mockResolvedValue([]);

      await strategy.answer("U1", "Q1", { answer: true, correct: true }, {});

      expect(scoped.saveAnswer).toHaveBeenCalledWith({
        userId: "U1",
        questionId: "Q1",
        timestamp: NOW,
        answer: true,
        correct: true,
      });
    });

    it("updates the existing row and bumps timestamp on re-answer, no join side effects", async () => {
      scoped.loadAnswers.mockResolvedValue([
        { userId: "U1", questionId: "Q1", answer: true, correct: true, timestamp: 1, season: "s1" },
      ]);

      await strategy.answer("U1", "Q1", { answer: false, correct: false }, { season: "s1" });

      expect(scoped.updateAnswer).toHaveBeenCalledWith("U1", "Q1", {
        answer: false,
        correct: false,
        timestamp: NOW,
      });
      expect(scoped.saveAnswer).not.toHaveBeenCalled();
      expect(dataLayer.recordJoin).not.toHaveBeenCalled();
      expect(dataLayer.refreshIdentities).not.toHaveBeenCalled();
    });
  });

  describe("projections", () => {
    it("getFinalAnswers returns only rows for the question", async () => {
      const q1a: SubmittedAnswer = { userId: "U1", questionId: "Q1", answer: true, timestamp: 1 };
      const q1b: SubmittedAnswer = { userId: "U2", questionId: "Q1", answer: false, timestamp: 1 };
      scoped.loadAnswers.mockResolvedValue([
        q1a,
        { userId: "U3", questionId: "Q2", answer: true, timestamp: 1 },
        q1b,
      ]);
      expect(await strategy.getFinalAnswers("Q1")).toEqual([q1a, q1b]);
    });

    it("getAllScoredAnswers returns every row unprojected", async () => {
      const rows: SubmittedAnswer[] = [
        { userId: "U1", questionId: "Q1", answer: true, timestamp: 1 },
        { userId: "U3", questionId: "Q2", answer: true, timestamp: 1 },
      ];
      scoped.loadAnswers.mockResolvedValue(rows);
      expect(await strategy.getAllScoredAnswers()).toEqual(rows);
    });
  });

  describe("applyVerdict", () => {
    it("merges the verdict patch onto the owner's row via updateAnswer", async () => {
      await strategy.applyVerdict("U1", "Q1", { correct: true, judgeReason: "typo" });
      expect(scoped.updateAnswer).toHaveBeenCalledWith("U1", "Q1", {
        correct: true,
        judgeReason: "typo",
      });
    });
  });

  describe("ownerLabel", () => {
    const users = new Map<string, TriviaUser>([["U1", { userId: "U1", displayName: "Alice" }]]);

    it("renders a Slack mention when tagPlayers is true", () => {
      expect(strategy.ownerLabel("U1", { tagPlayers: true, users })).toBe("<@U1>");
    });

    it("renders a plain @displayName when tagPlayers is false", () => {
      expect(strategy.ownerLabel("U1", { tagPlayers: false, users })).toBe("@Alice");
    });

    it("falls back to the ownerKey when the identity is unknown", () => {
      expect(strategy.ownerLabel("U9", { tagPlayers: false, users })).toBe("@U9");
    });
  });
});
