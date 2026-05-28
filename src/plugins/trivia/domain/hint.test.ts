import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { difficultyMeetsThreshold, resolveHintConfig } from "./hint.js";
import type { SeasonEntry } from "../core/types.js";
import type { TriviaConfig, TriviaGame, TriviaHintConfig } from "../core/configTypes.js";

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
};

const baseWorkspace: TriviaConfig = {};

const BUTTON: TriviaHintConfig = { mode: "button" };
const INLINE: TriviaHintConfig = { mode: "inline" };
const NONE: TriviaHintConfig = { mode: "none" };
const INLINE_HARD: TriviaHintConfig = { mode: "inline", minDifficulty: "hard" };

describe("resolveHintConfig", () => {
  it("falls through to { mode: 'none' } when no tier is set", () => {
    assert.deepEqual(resolveHintConfig(null, null, null, null), NONE);
    assert.deepEqual(resolveHintConfig(null, baseSeason, baseGame, baseWorkspace), NONE);
  });

  it("workspace tier wins when game/season unset", () => {
    assert.deepEqual(
      resolveHintConfig(null, baseSeason, baseGame, { ...baseWorkspace, hint: BUTTON }),
      BUTTON,
    );
  });

  it("game tier wins over workspace", () => {
    assert.deepEqual(
      resolveHintConfig(
        null,
        baseSeason,
        { ...baseGame, hint: INLINE_HARD },
        { ...baseWorkspace, hint: BUTTON },
      ),
      INLINE_HARD,
    );
  });

  it("season tier wins over game and workspace", () => {
    assert.deepEqual(
      resolveHintConfig(
        null,
        { ...baseSeason, hint: INLINE },
        { ...baseGame, hint: BUTTON },
        { ...baseWorkspace, hint: BUTTON },
      ),
      INLINE,
    );
  });

  it("slot tier wins when slotIndex matches a slot with hint", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      hint: BUTTON,
      format: { questions: [{}, { hint: INLINE_HARD }] },
    };
    assert.deepEqual(resolveHintConfig(1, season, baseGame, baseWorkspace), INLINE_HARD);
  });

  it("falls back to season when slot exists but has no hint", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      hint: BUTTON,
      format: { questions: [{}] },
    };
    assert.deepEqual(resolveHintConfig(0, season, baseGame, baseWorkspace), BUTTON);
  });

  it("ignores slot tier when slotIndex is null", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      hint: BUTTON,
      format: { questions: [{ hint: INLINE_HARD }] },
    };
    assert.deepEqual(resolveHintConfig(null, season, baseGame, baseWorkspace), BUTTON);
  });
});

describe("difficultyMeetsThreshold", () => {
  it("easy threshold passes for every bucket", () => {
    assert.equal(difficultyMeetsThreshold("easy", "easy"), true);
    assert.equal(difficultyMeetsThreshold("medium", "easy"), true);
    assert.equal(difficultyMeetsThreshold("hard", "easy"), true);
  });

  it("medium threshold suppresses easy", () => {
    assert.equal(difficultyMeetsThreshold("easy", "medium"), false);
    assert.equal(difficultyMeetsThreshold("medium", "medium"), true);
    assert.equal(difficultyMeetsThreshold("hard", "medium"), true);
  });

  it("hard threshold suppresses easy and medium", () => {
    assert.equal(difficultyMeetsThreshold("easy", "hard"), false);
    assert.equal(difficultyMeetsThreshold("medium", "hard"), false);
    assert.equal(difficultyMeetsThreshold("hard", "hard"), true);
  });
});
