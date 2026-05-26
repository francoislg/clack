import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveActiveCategories } from "./categories.js";
import type { SeasonEntry } from "../core/types.js";
import type { SeasonFormat, TriviaGame } from "../core/configTypes.js";

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
  categories: ["Season"],
};

const globalCats = ["Global"];

describe("resolveActiveCategories", () => {
  it("slot.categories wins when an effective format is present", () => {
    const format: SeasonFormat = { questions: [{ categories: ["Slot"] }] };
    const out = resolveActiveCategories(format, 0, baseSeason, baseGame, globalCats);
    assert.deepEqual(out, ["Slot"]);
  });

  it("falls through slot when slot has no categories", () => {
    const format: SeasonFormat = { questions: [{}] };
    const out = resolveActiveCategories(format, 0, baseSeason, baseGame, globalCats);
    assert.deepEqual(out, ["Season"]);
  });

  it("season.categories wins over game.categories", () => {
    const out = resolveActiveCategories(
      null,
      null,
      baseSeason,
      { ...baseGame, categories: ["GameOnly"] },
      globalCats,
    );
    assert.deepEqual(out, ["Season"]);
  });

  it("game.categories used when season is null", () => {
    const out = resolveActiveCategories(
      null,
      null,
      null,
      { ...baseGame, categories: ["GameOnly"] },
      globalCats,
    );
    assert.deepEqual(out, ["GameOnly"]);
  });

  it("falls through to globalCategories when no tier supplies", () => {
    const out = resolveActiveCategories(null, null, null, baseGame, globalCats);
    assert.deepEqual(out, ["Global"]);
  });
});
