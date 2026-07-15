import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validateTriviaPoints } from "./axes.js";
import { parseTriviaGames } from "./games.js";
import { validateFormat } from "./format.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("validateTriviaPoints", () => {
  it("accepts a bare cap", () => {
    const r = validateTriviaPoints({ max: 3 }, "points");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { max: 3 });
  });

  it("accepts a cap with guidance, trimming it", () => {
    const r = validateTriviaPoints({ max: 2, guidance: "  hard = 2  " }, "points");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { max: 2, guidance: "hard = 2" });
  });

  it("accepts the inert max: 1", () => {
    const r = validateTriviaPoints({ max: 1 }, "points");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { max: 1 });
  });

  it("accepts the absolute ceiling max: 10", () => {
    const r = validateTriviaPoints({ max: 10 }, "points");
    assert.equal(r.ok, true);
  });

  it("requires max — guidance alone would silently mask a lower tier's cap", () => {
    const r = validateTriviaPoints({ guidance: "hard = 2" }, "points");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /max/);
  });

  it("rejects max below 1", () => {
    const r = validateTriviaPoints({ max: 0 }, "points");
    assert.equal(r.ok, false);
  });

  it("rejects max above 10", () => {
    const r = validateTriviaPoints({ max: 11 }, "points");
    assert.equal(r.ok, false);
  });

  it("rejects a non-integer max", () => {
    const r = validateTriviaPoints({ max: 2.5 }, "points");
    assert.equal(r.ok, false);
  });

  it("rejects an empty / whitespace-only guidance", () => {
    assert.equal(validateTriviaPoints({ max: 2, guidance: "" }, "points").ok, false);
    assert.equal(validateTriviaPoints({ max: 2, guidance: "   " }, "points").ok, false);
  });

  it("rejects guidance beyond 500 characters", () => {
    const r = validateTriviaPoints({ max: 2, guidance: "x".repeat(501) }, "points");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /500/);
  });

  it("rejects a non-object", () => {
    assert.equal(validateTriviaPoints("3", "points").ok, false);
    assert.equal(validateTriviaPoints([{ max: 3 }], "points").ok, false);
  });
});

describe("parseTriviaGames — per-game points", () => {
  it("accepts a valid value and stores it on the game", () => {
    const { games, issues } = parseTriviaGames([
      { ...validBase, points: { max: 3, guidance: "hard = 3" } },
    ]);
    assert.equal(issues.length, 0);
    assert.deepEqual(games?.[0].points, { max: 3, guidance: "hard = 3" });
  });

  it("drops the field with an issue when invalid", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, points: { max: 99 } }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].points, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].points");
  });

  it("preserves the game entry when points is absent", () => {
    const { games, issues } = parseTriviaGames([validBase]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].points, undefined);
  });
});

describe("validateFormat — per-slot points", () => {
  it("accepts points on a format slot", () => {
    const r = validateFormat({ questions: [{ points: { max: 5 } }, {}] }, "format");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.value.questions[0].points, { max: 5 });
      assert.equal(r.value.questions[1].points, undefined);
    }
  });

  it("rejects an invalid cap on a format slot", () => {
    const r = validateFormat({ questions: [{ points: { max: 0 } }] }, "format");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /format\.questions\[0\]\.points/);
  });
});
