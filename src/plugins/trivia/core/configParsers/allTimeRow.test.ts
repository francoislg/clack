import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validateAllTimeRowMode } from "./axes.js";
import { parseTriviaGames } from "./games.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("validateAllTimeRowMode", () => {
  for (const mode of ["always", "never", "end-of-season-only"] as const) {
    it(`accepts '${mode}'`, () => {
      const r = validateAllTimeRowMode(mode, "trivia.allTimeRow");
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.value, mode);
    });
  }

  it("rejects an unknown value", () => {
    const r = validateAllTimeRowMode("sometimes", "trivia.allTimeRow");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /trivia\.allTimeRow/);
  });

  it("rejects a non-string value", () => {
    const r = validateAllTimeRowMode(true, "trivia.allTimeRow");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /must be one of/);
  });
});

describe("parseTriviaGames — per-game allTimeRow", () => {
  it("accepts a valid value and stores it on the game", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, allTimeRow: "always" }]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].allTimeRow, "always");
  });

  it("drops the field with an issue when invalid (reject-and-warn at load)", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, allTimeRow: "sometimes" }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].allTimeRow, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].allTimeRow");
  });

  it("preserves the game entry when allTimeRow is absent", () => {
    const { games, issues } = parseTriviaGames([validBase]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].allTimeRow, undefined);
  });
});
