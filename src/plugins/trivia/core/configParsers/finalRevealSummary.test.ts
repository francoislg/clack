import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validateFinalRevealSummary } from "./axes.js";
import { parseTriviaGames } from "./games.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("validateFinalRevealSummary", () => {
  for (const mode of ["yes", "no", "in-thread"] as const) {
    it(`accepts '${mode}'`, () => {
      const r = validateFinalRevealSummary(mode, "trivia.finalRevealSummary");
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.value, mode);
    });
  }

  it("rejects an unknown value", () => {
    const r = validateFinalRevealSummary("maybe", "trivia.finalRevealSummary");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /trivia\.finalRevealSummary/);
  });

  it("rejects a non-string value", () => {
    const r = validateFinalRevealSummary(true, "trivia.finalRevealSummary");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /must be one of/);
  });
});

describe("parseTriviaGames — per-game finalRevealSummary", () => {
  it("accepts a valid value and stores it on the game", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, finalRevealSummary: "in-thread" }]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].finalRevealSummary, "in-thread");
  });

  it("drops the field with an issue when invalid (reject-and-warn at load)", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, finalRevealSummary: "maybe" }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].finalRevealSummary, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].finalRevealSummary");
  });

  it("preserves the game entry when finalRevealSummary is absent", () => {
    const { games, issues } = parseTriviaGames([validBase]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].finalRevealSummary, undefined);
  });
});
