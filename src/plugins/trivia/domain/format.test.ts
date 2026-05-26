import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveEffectiveFormat } from "./format.js";
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
  categories: ["History"],
};

const oneSlot: SeasonFormat = { questions: [{}] };
const twoSlot: SeasonFormat = { questions: [{}, {}] };

describe("resolveEffectiveFormat", () => {
  it("returns season.format when set", () => {
    const out = resolveEffectiveFormat(
      { ...baseSeason, format: twoSlot },
      { ...baseGame, format: oneSlot },
    );
    assert.equal(out, twoSlot);
  });

  it("returns game.format when season has none", () => {
    const out = resolveEffectiveFormat({ ...baseSeason }, { ...baseGame, format: oneSlot });
    assert.equal(out, oneSlot);
  });

  it("returns game.format when season is null", () => {
    const out = resolveEffectiveFormat(null, { ...baseGame, format: oneSlot });
    assert.equal(out, oneSlot);
  });

  it("returns null when neither tier supplies a format", () => {
    assert.equal(resolveEffectiveFormat(baseSeason, baseGame), null);
    assert.equal(resolveEffectiveFormat(null, null), null);
  });
});
