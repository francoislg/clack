import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveActiveCategories, resolveActiveCategoriesWithSource } from "./categories.js";
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
  categories: ["Season"],
};

const inheritingSeason: SeasonEntry = { slug: "s2", startedAt: 0, expectedEndAt: 1 };

const globalCats = ["Global"];

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

describe("resolveActiveCategories", () => {
  it("slot.categories wins when a slot supplies categories", () => {
    const ctx = makeCtx({ gameSlot: { categories: ["Slot"] }, season: baseSeason, game: baseGame });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["Slot"]);
  });

  it("falls through slot when slot has no categories", () => {
    const ctx = makeCtx({ gameSlot: {}, season: baseSeason, game: baseGame });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["Season"]);
  });

  it("phase.categories wins over season.categories", () => {
    const ctx = makeCtx({
      seasonPhase: { slug: "p1", categories: ["Phase"] },
      season: baseSeason,
      game: baseGame,
    });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["Phase"]);
  });

  it("slot.categories wins over phase.categories", () => {
    const ctx = makeCtx({
      gameSlot: { categories: ["Slot"] },
      seasonPhase: { slug: "p1", categories: ["Phase"] },
      season: baseSeason,
    });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["Slot"]);
  });

  it("empty phase categories falls through to season", () => {
    const ctx = makeCtx({ seasonPhase: { slug: "p1", categories: [] }, season: baseSeason });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["Season"]);
  });

  it("absent phase categories falls through to season", () => {
    const ctx = makeCtx({ seasonPhase: { slug: "p1" }, season: baseSeason });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["Season"]);
  });

  it("season.categories wins over game.categories", () => {
    const ctx = makeCtx({ season: baseSeason, game: { ...baseGame, categories: ["GameOnly"] } });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["Season"]);
  });

  it("game.categories used when season is null", () => {
    const ctx = makeCtx({ game: { ...baseGame, categories: ["GameOnly"] } });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["GameOnly"]);
  });

  it("falls through to globalCategories when no tier supplies", () => {
    const ctx = makeCtx({ game: baseGame });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["Global"]);
  });

  it("cascades through inheriting season to game when season has no categories", () => {
    const ctx = makeCtx({
      season: inheritingSeason,
      game: { ...baseGame, categories: ["GameOnly"] },
    });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["GameOnly"]);
  });

  it("cascades through inheriting season AND game to global", () => {
    const ctx = makeCtx({ season: inheritingSeason, game: baseGame });
    assert.deepEqual(resolveActiveCategories(ctx, globalCats), ["Global"]);
  });
});

describe("resolveActiveCategoriesWithSource", () => {
  it("returns source: 'slot' when slot wins", () => {
    const ctx = makeCtx({ gameSlot: { categories: ["Slot"] }, season: baseSeason, game: baseGame });
    assert.deepEqual(resolveActiveCategoriesWithSource(ctx, globalCats), {
      pool: ["Slot"],
      source: "slot",
    });
  });

  it("returns source: 'phase' when phase wins over season", () => {
    const ctx = makeCtx({
      seasonPhase: { slug: "p1", categories: ["Phase"] },
      season: baseSeason,
      game: baseGame,
    });
    assert.deepEqual(resolveActiveCategoriesWithSource(ctx, globalCats), {
      pool: ["Phase"],
      source: "phase",
    });
  });

  it("returns source: 'season' when an empty phase array falls through", () => {
    const ctx = makeCtx({ seasonPhase: { slug: "p1", categories: [] }, season: baseSeason });
    assert.deepEqual(resolveActiveCategoriesWithSource(ctx, globalCats), {
      pool: ["Season"],
      source: "season",
    });
  });

  it("returns source: 'season' when slot has no categories override", () => {
    const ctx = makeCtx({ gameSlot: {}, season: baseSeason, game: baseGame });
    assert.deepEqual(resolveActiveCategoriesWithSource(ctx, globalCats), {
      pool: ["Season"],
      source: "season",
    });
  });

  it("returns source: 'game' when season has no categories", () => {
    const ctx = makeCtx({
      season: inheritingSeason,
      game: { ...baseGame, categories: ["GameOnly"] },
    });
    assert.deepEqual(resolveActiveCategoriesWithSource(ctx, globalCats), {
      pool: ["GameOnly"],
      source: "game",
    });
  });

  it("returns source: 'global' when no tier supplies", () => {
    const ctx = makeCtx({ game: baseGame });
    assert.deepEqual(resolveActiveCategoriesWithSource(ctx, globalCats), {
      pool: ["Global"],
      source: "global",
    });
  });

  it("returns source: 'global' when inheriting all the way through", () => {
    const ctx = makeCtx({ season: inheritingSeason, game: baseGame });
    assert.deepEqual(resolveActiveCategoriesWithSource(ctx, globalCats), {
      pool: ["Global"],
      source: "global",
    });
  });
});
