import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validateTriviaChoicesConfig } from "./axes.js";
import { parseTriviaGames } from "./games.js";
import { validateFormat } from "./format.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("validateTriviaChoicesConfig", () => {
  it("accepts { min: 2, max: 4 }", () => {
    const r = validateTriviaChoicesConfig({ min: 2, max: 4 }, "choices");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { min: 2, max: 4 });
  });

  it("accepts { min: 3, max: 3 }", () => {
    const r = validateTriviaChoicesConfig({ min: 3, max: 3 }, "choices");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { min: 3, max: 3 });
  });

  it("rejects min below 2", () => {
    const r = validateTriviaChoicesConfig({ min: 1, max: 4 }, "choices");
    assert.equal(r.ok, false);
  });

  it("rejects max above 4", () => {
    const r = validateTriviaChoicesConfig({ min: 2, max: 5 }, "choices");
    assert.equal(r.ok, false);
  });

  it("rejects min > max", () => {
    const r = validateTriviaChoicesConfig({ min: 4, max: 2 }, "choices");
    assert.equal(r.ok, false);
  });

  it("rejects a non-object", () => {
    const r = validateTriviaChoicesConfig("4", "choices");
    assert.equal(r.ok, false);
  });
});

describe("parseTriviaGames — per-game choices", () => {
  it("accepts valid bounds and stores them on the game", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, choices: { min: 2, max: 2 } }]);
    assert.equal(issues.length, 0);
    assert.deepEqual(games?.[0].choices, { min: 2, max: 2 });
  });

  it("drops the field with an issue when invalid", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, choices: { min: 1, max: 4 } }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].choices, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].choices");
  });

  it("preserves the game entry when choices is absent", () => {
    const { games, issues } = parseTriviaGames([validBase]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].choices, undefined);
  });
});

describe("validateFormat — per-slot choices", () => {
  it("accepts choices on a format slot", () => {
    const r = validateFormat({ questions: [{ choices: { min: 2, max: 2 } }, {}] }, "format");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.value.questions[0].choices, { min: 2, max: 2 });
      assert.equal(r.value.questions[1].choices, undefined);
    }
  });

  it("rejects invalid bounds on a format slot", () => {
    const r = validateFormat({ questions: [{ choices: { min: 5, max: 5 } }] }, "format");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /format\.questions\[0\]\.choices/);
  });
});
