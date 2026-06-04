import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validateIncludeRevealInQuestions } from "./axes.js";
import { parseTriviaGames } from "./games.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("validateIncludeRevealInQuestions", () => {
  for (const mode of ["yes", "no"] as const) {
    it(`accepts '${mode}'`, () => {
      const r = validateIncludeRevealInQuestions(mode, "trivia.includeRevealInQuestions");
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.value, mode);
    });
  }

  it("rejects an unknown value", () => {
    const r = validateIncludeRevealInQuestions("maybe", "trivia.includeRevealInQuestions");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /trivia\.includeRevealInQuestions/);
  });

  it("rejects a non-string value", () => {
    const r = validateIncludeRevealInQuestions(true, "trivia.includeRevealInQuestions");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /must be one of/);
  });
});

describe("parseTriviaGames — per-game includeRevealInQuestions", () => {
  it("accepts a valid value and stores it on the game", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, includeRevealInQuestions: "yes" }]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].includeRevealInQuestions, "yes");
  });

  it("drops the field with an issue when invalid (reject-and-warn at load)", () => {
    const { games, issues } = parseTriviaGames([
      { ...validBase, includeRevealInQuestions: "maybe" },
    ]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].includeRevealInQuestions, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].includeRevealInQuestions");
  });

  it("preserves the game entry when includeRevealInQuestions is absent", () => {
    const { games, issues } = parseTriviaGames([validBase]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].includeRevealInQuestions, undefined);
  });
});
