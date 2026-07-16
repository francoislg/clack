import { describe, it, expect } from "vitest";
import { TEAM_SCORING_REGISTRY } from "./scoring.js";

describe("TEAM_SCORING_REGISTRY", () => {
  describe("one-right-is-right", () => {
    const strategy = TEAM_SCORING_REGISTRY["one-right-is-right"];

    it("pays the question's points once when at least one member is correct", () => {
      expect(
        strategy.scoreQuestion([{ correct: true }, { correct: true }, { correct: true }], 1),
      ).toBe(1);
      expect(strategy.scoreQuestion([{ correct: false }, { correct: true }], 1)).toBe(1);
    });

    it("pays 0 when no member is correct", () => {
      expect(strategy.scoreQuestion([{ correct: false }, { correct: false }], 1)).toBe(0);
    });

    it("pays 0 for an empty member-answer list", () => {
      expect(strategy.scoreQuestion([], 1)).toBe(0);
    });

    it("pays the stamped points on a worth-N question", () => {
      expect(strategy.scoreQuestion([{ correct: true }, { correct: true }], 3)).toBe(3);
    });
  });

  describe("total-points", () => {
    const strategy = TEAM_SCORING_REGISTRY["total-points"];

    it("sums correct member answers", () => {
      expect(
        strategy.scoreQuestion([{ correct: true }, { correct: true }, { correct: true }], 1),
      ).toBe(3);
      expect(strategy.scoreQuestion([{ correct: true }, { correct: false }], 1)).toBe(1);
    });

    it("pays 0 for an empty member-answer list", () => {
      expect(strategy.scoreQuestion([], 1)).toBe(0);
    });

    it("multiplies by the stamped points on a worth-N question", () => {
      expect(strategy.scoreQuestion([{ correct: true }, { correct: true }], 3)).toBe(6);
    });
  });
});
