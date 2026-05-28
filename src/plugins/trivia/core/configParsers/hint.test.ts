import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validateHintConfig } from "./axes.js";
import { parseTriviaGames } from "./games.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("validateHintConfig", () => {
  it("accepts { mode: 'button' }", () => {
    const r = validateHintConfig({ mode: "button" }, "trivia.hint");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { mode: "button" });
  });

  it("accepts { mode: 'inline', minDifficulty: 'medium' }", () => {
    const r = validateHintConfig({ mode: "inline", minDifficulty: "medium" }, "trivia.hint");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { mode: "inline", minDifficulty: "medium" });
  });

  it("accepts { mode: 'none' }", () => {
    const r = validateHintConfig({ mode: "none" }, "trivia.hint");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { mode: "none" });
  });

  // Per the spec: "When mode === 'none', the parser SHALL accept minDifficulty
  // even though it has no runtime effect". The admin may opt-park a threshold
  // across enable/disable toggles.
  it("accepts no-op { mode: 'none', minDifficulty: 'hard' }", () => {
    const r = validateHintConfig({ mode: "none", minDifficulty: "hard" }, "trivia.hint");
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.value, { mode: "none", minDifficulty: "hard" });
  });

  it("rejects invalid mode 'popup'", () => {
    const r = validateHintConfig({ mode: "popup" }, "trivia.hint");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /trivia\.hint\.mode/);
  });

  it("rejects invalid minDifficulty 'trivial'", () => {
    const r = validateHintConfig({ mode: "button", minDifficulty: "trivial" }, "trivia.hint");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /minDifficulty/);
  });

  it("rejects non-object values", () => {
    const r = validateHintConfig("nope", "trivia.hint");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /must be an object/);
  });

  it("rejects unknown keys", () => {
    const r = validateHintConfig({ mode: "button", weird: 1 }, "trivia.hint");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /unknown key 'weird'/);
  });

  it("rejects missing mode", () => {
    const r = validateHintConfig({ minDifficulty: "medium" }, "trivia.hint");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /mode/);
  });
});

describe("parseTriviaGames — per-game hint", () => {
  it("accepts a valid hint config and stores it on the game", () => {
    const { games, issues } = parseTriviaGames([
      { ...validBase, hint: { mode: "button", minDifficulty: "medium" } },
    ]);
    assert.equal(issues.length, 0);
    assert.deepEqual(games?.[0].hint, { mode: "button", minDifficulty: "medium" });
  });

  it("drops the hint field with an issue when invalid", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, hint: { mode: "popup" } }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].hint, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].hint");
  });

  it("preserves the game entry when hint is absent", () => {
    const { games, issues } = parseTriviaGames([validBase]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].hint, undefined);
  });
});
