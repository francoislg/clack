import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { DEFAULT_DIFFICULTY_RANGES } from "../core/configTypes.js";
import { resolveDifficultyRanges } from "./difficulty.js";
import type { SeasonEntry } from "../core/types.js";

function makeGame(overrides: Partial<TriviaGame> = {}): TriviaGame {
  return {
    name: "main",
    channel: "C1",
    questionCron: "0 9 * * *",
    revealCron: "0 17 * * *",
    timezone: "UTC",
    enabled: true,
    ...overrides,
  };
}

function makeConfig(trivia?: TriviaConfig): TriviaConfig {
  return trivia ?? {};
}

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

const baseSeason: SeasonEntry = {
  slug: "active",
  startedAt: NOW - HOUR,
  expectedEndAt: NOW + HOUR,
  categories: ["X"],
};

describe("resolveDifficultyRanges", () => {
  it("returns DEFAULT_DIFFICULTY_RANGES per format when no source set", () => {
    assert.deepEqual(
      resolveDifficultyRanges(null, null, null, null, "boolean"),
      DEFAULT_DIFFICULTY_RANGES.boolean,
    );
    assert.deepEqual(
      resolveDifficultyRanges(null, null, null, makeConfig(), "freeform"),
      DEFAULT_DIFFICULTY_RANGES.freeform,
    );
  });

  it("freeform default is shifted -2 across every bucket vs. boolean", () => {
    const b = DEFAULT_DIFFICULTY_RANGES.boolean;
    const f = DEFAULT_DIFFICULTY_RANGES.freeform;
    assert.deepEqual(f.easy, [b.easy[0] - 2, b.easy[1] - 2]);
    assert.deepEqual(f.medium, [b.medium[0] - 2, b.medium[1] - 2]);
    assert.deepEqual(f.hard, [b.hard[0] - 2, b.hard[1] - 2]);
    assert.equal(f.minimumThreshold, b.minimumThreshold - 2);
  });

  it("config override replaces only the fields it sets (per-field merge)", () => {
    const cfg = makeConfig({
      difficulty: { freeform: { hard: [6, 8] } },
    });
    const r = resolveDifficultyRanges(null, null, null, cfg, "freeform");
    assert.deepEqual(r.hard, [6, 8]);
    assert.deepEqual(r.easy, DEFAULT_DIFFICULTY_RANGES.freeform.easy);
    assert.deepEqual(r.medium, DEFAULT_DIFFICULTY_RANGES.freeform.medium);
    assert.equal(r.minimumThreshold, DEFAULT_DIFFICULTY_RANGES.freeform.minimumThreshold);
  });

  it("config override for one format does not affect another format", () => {
    const cfg = makeConfig({ difficulty: { freeform: { easy: [1, 3] } } });
    assert.deepEqual(
      resolveDifficultyRanges(null, null, null, cfg, "boolean"),
      DEFAULT_DIFFICULTY_RANGES.boolean,
    );
  });

  it("season override wins over config", () => {
    const cfg = makeConfig({ difficulty: { choice: { easy: [3, 4] } } });
    const season: SeasonEntry = {
      ...baseSeason,
      difficulty: { choice: { easy: [5, 6] } },
    };
    const r = resolveDifficultyRanges(season, null, null, cfg, "choice");
    assert.deepEqual(r.easy, [5, 6]);
  });

  it("slot override wins over season + config", () => {
    const cfg = makeConfig({ difficulty: { choice: { hard: [7, 8] } } });
    const season: SeasonEntry = {
      ...baseSeason,
      difficulty: { choice: { hard: [8, 9] } },
      format: { questions: [{ difficulty: { choice: { hard: [10, 10] } } }] },
    };
    const r = resolveDifficultyRanges(season, 0, null, cfg, "choice");
    assert.deepEqual(r.hard, [10, 10]);
  });

  it("slot without difficulty falls back through season → game → config → default", () => {
    const cfg = makeConfig({ difficulty: { freeform: { minimumThreshold: 3 } } });
    const season: SeasonEntry = {
      ...baseSeason,
      format: { questions: [{}] },
    };
    const r = resolveDifficultyRanges(season, 0, null, cfg, "freeform");
    assert.equal(r.minimumThreshold, 3);
    assert.deepEqual(r.easy, DEFAULT_DIFFICULTY_RANGES.freeform.easy);
  });

  it("layered overrides merge field-by-field across tiers", () => {
    const cfg = makeConfig({ difficulty: { boolean: { easy: [2, 3] } } });
    const season: SeasonEntry = {
      ...baseSeason,
      difficulty: { boolean: { medium: [5, 6] } },
      format: { questions: [{ difficulty: { boolean: { hard: [9, 9] } } }] },
    };
    const r = resolveDifficultyRanges(season, 0, null, cfg, "boolean");
    assert.deepEqual(r.easy, [2, 3]);
    assert.deepEqual(r.medium, [5, 6]);
    assert.deepEqual(r.hard, [9, 9]);
    assert.equal(r.minimumThreshold, DEFAULT_DIFFICULTY_RANGES.boolean.minimumThreshold);
  });

  it("game.difficulty merges per sub-field above workspace", () => {
    const cfg = makeConfig({
      difficulty: { freeform: { easy: [2, 4], medium: [5, 6], hard: [7, 8], minimumThreshold: 2 } },
    });
    const game = makeGame({ difficulty: { freeform: { hard: [8, 9] } } });
    const r = resolveDifficultyRanges(null, null, game, cfg, "freeform");
    assert.deepEqual(r.easy, [2, 4]);
    assert.deepEqual(r.medium, [5, 6]);
    assert.deepEqual(r.hard, [8, 9]);
    assert.equal(r.minimumThreshold, 2);
  });

  it("season.difficulty wins over game.difficulty per sub-field", () => {
    const game = makeGame({ difficulty: { freeform: { hard: [8, 9] } } });
    const season: SeasonEntry = {
      ...baseSeason,
      difficulty: { freeform: { hard: [9, 10] } },
    };
    const r = resolveDifficultyRanges(season, null, game, makeConfig(), "freeform");
    assert.deepEqual(r.hard, [9, 10]);
  });

  it("game.difficulty leaves other formats untouched", () => {
    const game = makeGame({ difficulty: { freeform: { hard: [8, 9] } } });
    assert.deepEqual(
      resolveDifficultyRanges(null, null, game, makeConfig(), "boolean"),
      DEFAULT_DIFFICULTY_RANGES.boolean,
    );
  });

  it("game=null skips the per-game tier", () => {
    const cfg = makeConfig({ difficulty: { boolean: { easy: [3, 5] } } });
    const r = resolveDifficultyRanges(null, null, null, cfg, "boolean");
    assert.deepEqual(r.easy, [3, 5]);
  });
});
