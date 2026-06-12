import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { validateChoiceEmojiStyle } from "./axes.js";
import { parseTriviaGames } from "./games.js";
import { validateSlotConfig } from "./format.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("validateChoiceEmojiStyle", () => {
  for (const style of ["numbers", "themed"] as const) {
    it(`accepts '${style}'`, () => {
      const r = validateChoiceEmojiStyle(style, "trivia.choiceEmojiStyle");
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.value, style);
    });
  }

  it("rejects an unknown style 'letters'", () => {
    const r = validateChoiceEmojiStyle("letters", "trivia.choiceEmojiStyle");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /trivia\.choiceEmojiStyle.*one of/);
  });

  it("rejects non-string values", () => {
    const r = validateChoiceEmojiStyle({ style: "themed" }, "trivia.choiceEmojiStyle");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /one of/);
  });
});

describe("parseTriviaGames — per-game choiceEmojiStyle", () => {
  it("accepts a valid style and stores it on the game", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, choiceEmojiStyle: "themed" }]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].choiceEmojiStyle, "themed");
  });

  it("drops the field with an issue when invalid", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, choiceEmojiStyle: "letters" }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].choiceEmojiStyle, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].choiceEmojiStyle");
  });

  it("preserves the game entry when choiceEmojiStyle is absent", () => {
    const { games, issues } = parseTriviaGames([validBase]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].choiceEmojiStyle, undefined);
  });
});

describe("validateSlotConfig — per-slot choiceEmojiStyle", () => {
  it("accepts a valid style on a slot", () => {
    const r = validateSlotConfig({ choiceEmojiStyle: "themed" }, "format.questions[0]");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.choiceEmojiStyle, "themed");
  });

  it("rejects the whole slot when invalid", () => {
    const r = validateSlotConfig({ choiceEmojiStyle: "rainbow" }, "format.questions[0]");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /format\.questions\[0\]\.choiceEmojiStyle/);
  });
});
