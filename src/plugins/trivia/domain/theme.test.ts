import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveTheme } from "./theme.js";
import type { CascadeContext } from "../core/cascadeAxes.js";
import type { SeasonEntry } from "../core/types.js";
import type { TriviaGame } from "../core/configTypes.js";

const baseGame: TriviaGame = {
  name: "main",
  channel: "C1",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/New_York",
};

const baseSeason: SeasonEntry = {
  slug: "s1",
  startedAt: 0,
  expectedEndAt: 1,
  categories: ["History"],
};

function makeCtx(overrides: Partial<CascadeContext>): CascadeContext {
  return {
    seasonSlot: null,
    seasonPhase: null,
    gameSlot: null,
    slotIndex: null,
    season: null,
    game: null,
    config: null,
    ...overrides,
  };
}

describe("resolveTheme", () => {
  it("phase.theme wins over season.theme", () => {
    const ctx = makeCtx({
      seasonPhase: { slug: "p1", theme: "Phase Week" },
      season: { ...baseSeason, theme: "Halloween" },
      game: { ...baseGame, theme: "Channel Lore" },
    });
    assert.equal(resolveTheme(ctx), "Phase Week");
  });

  it("season.theme wins over game.theme", () => {
    const ctx = makeCtx({
      season: { ...baseSeason, theme: "Halloween" },
      game: { ...baseGame, theme: "Channel Lore" },
    });
    assert.equal(resolveTheme(ctx), "Halloween");
  });

  it("empty phase theme falls through to season", () => {
    const ctx = makeCtx({
      seasonPhase: { slug: "p1", theme: "" },
      season: { ...baseSeason, theme: "Halloween" },
    });
    assert.equal(resolveTheme(ctx), "Halloween");
  });

  it("game.theme used when season has none", () => {
    const ctx = makeCtx({ season: baseSeason, game: { ...baseGame, theme: "Channel Lore" } });
    assert.equal(resolveTheme(ctx), "Channel Lore");
  });

  it("game.theme used when season is null", () => {
    const ctx = makeCtx({ game: { ...baseGame, theme: "Channel Lore" } });
    assert.equal(resolveTheme(ctx), "Channel Lore");
  });

  it("returns null when neither tier supplies a theme", () => {
    assert.equal(resolveTheme(makeCtx({ season: baseSeason, game: baseGame })), null);
    assert.equal(resolveTheme(makeCtx({})), null);
  });
});
