import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTheme } from "./theme.js";
import type { SeasonEntry } from "../core/types.js";
import type { TriviaGame } from "../core/configTypes.js";

const baseGame: TriviaGame = {
  name: "main",
  channel: "C1",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

const baseSeason: SeasonEntry = {
  slug: "s1",
  startedAt: 0,
  expectedEndAt: 1,
  categories: ["History"],
};

describe("resolveTheme", () => {
  it("season.theme wins over game.theme", () => {
    const out = resolveTheme(
      { ...baseSeason, theme: "Halloween" },
      { ...baseGame, theme: "Channel Lore" },
    );
    assert.equal(out, "Halloween");
  });

  it("game.theme used when season has none", () => {
    const out = resolveTheme(baseSeason, { ...baseGame, theme: "Channel Lore" });
    assert.equal(out, "Channel Lore");
  });

  it("game.theme used when season is null", () => {
    const out = resolveTheme(null, { ...baseGame, theme: "Channel Lore" });
    assert.equal(out, "Channel Lore");
  });

  it("returns null when neither tier supplies a theme", () => {
    assert.equal(resolveTheme(baseSeason, baseGame), null);
    assert.equal(resolveTheme(null, null), null);
  });
});
