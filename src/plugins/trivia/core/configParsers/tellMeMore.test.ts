import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validateTellMeMore } from "./axes.js";
import { parseTriviaGames } from "./games.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("validateTellMeMore", () => {
  it("accepts { enabled: true }", () => {
    const r = validateTellMeMore({ enabled: true }, "trivia.tellMeMore");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { enabled: true });
  });

  it("accepts { enabled: false }", () => {
    const r = validateTellMeMore({ enabled: false }, "trivia.tellMeMore");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { enabled: false });
  });

  it("rejects a non-object value", () => {
    const r = validateTellMeMore("yes", "trivia.tellMeMore");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /trivia\.tellMeMore/);
  });

  it("rejects a missing/non-boolean enabled", () => {
    assert.equal(validateTellMeMore({}, "trivia.tellMeMore").ok, false);
    assert.equal(validateTellMeMore({ enabled: "true" }, "trivia.tellMeMore").ok, false);
  });

  it("rejects unknown extra keys (strict)", () => {
    const r = validateTellMeMore({ enabled: true, extra: 1 }, "trivia.tellMeMore");
    assert.equal(r.ok, false);
  });
});

describe("parseTriviaGames — per-game tellMeMore", () => {
  it("accepts a valid value and stores it on the game", () => {
    const { games, issues } = parseTriviaGames([
      { ...validBase, tellMeMore: { enabled: true } },
    ]);
    assert.equal(issues.length, 0);
    assert.deepEqual(games?.[0].tellMeMore, { enabled: true });
  });

  it("drops the field with an issue when invalid (reject-and-warn at load)", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, tellMeMore: "yes" }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].tellMeMore, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].tellMeMore");
  });

  it("preserves the game entry when tellMeMore is absent", () => {
    const { games, issues } = parseTriviaGames([validBase]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].tellMeMore, undefined);
  });
});
