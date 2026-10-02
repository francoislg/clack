import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validateJudgeLeniency } from "./axes.js";
import { parseTriviaGames } from "./games.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/New_York",
};

describe("validateJudgeLeniency", () => {
  for (const preset of ["strict", "strict-with-typos", "lenient", "evaluate"] as const) {
    it(`accepts '${preset}'`, () => {
      const r = validateJudgeLeniency(preset, "trivia.judgeLeniency");
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.value, preset);
    });
  }

  it("rejects an unknown preset 'loose'", () => {
    const r = validateJudgeLeniency("loose", "trivia.judgeLeniency");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /trivia\.judgeLeniency.*one of/);
  });

  it("lists the four presets in the rejection error", () => {
    const r = validateJudgeLeniency("loose", "trivia.judgeLeniency");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /one of strict, strict-with-typos, lenient, evaluate/);
  });

  it("rejects non-string values", () => {
    const r = validateJudgeLeniency({ mode: "strict" }, "trivia.judgeLeniency");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /one of/);
  });
});

describe("parseTriviaGames — per-game judgeLeniency", () => {
  it("accepts a valid preset and stores it on the game", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, judgeLeniency: "lenient" }]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].judgeLeniency, "lenient");
  });

  it("accepts the evaluate preset and stores it on the game", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, judgeLeniency: "evaluate" }]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].judgeLeniency, "evaluate");
  });

  it("drops the field with an issue when invalid", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, judgeLeniency: "loose" }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].judgeLeniency, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].judgeLeniency");
  });

  it("preserves the game entry when judgeLeniency is absent", () => {
    const { games, issues } = parseTriviaGames([validBase]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].judgeLeniency, undefined);
  });
});
