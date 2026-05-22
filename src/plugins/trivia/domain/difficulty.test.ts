import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../../../config.js";
import { DEFAULT_DIFFICULTY_RANGES } from "../../../config.js";
import { resolveDifficultyRanges } from "./difficulty.js";
import type { SeasonEntry } from "../core/types.js";

function makeConfig(trivia?: Config["trivia"]): Config {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    repositories: [],
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "sonnet" },
    trivia,
  };
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
      resolveDifficultyRanges(null, null, null, "boolean"),
      DEFAULT_DIFFICULTY_RANGES.boolean,
    );
    assert.deepEqual(
      resolveDifficultyRanges(null, null, makeConfig(), "freeform"),
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
    const r = resolveDifficultyRanges(null, null, cfg, "freeform");
    assert.deepEqual(r.hard, [6, 8]);
    assert.deepEqual(r.easy, DEFAULT_DIFFICULTY_RANGES.freeform.easy);
    assert.deepEqual(r.medium, DEFAULT_DIFFICULTY_RANGES.freeform.medium);
    assert.equal(r.minimumThreshold, DEFAULT_DIFFICULTY_RANGES.freeform.minimumThreshold);
  });

  it("config override for one format does not affect another format", () => {
    const cfg = makeConfig({ difficulty: { freeform: { easy: [1, 3] } } });
    assert.deepEqual(
      resolveDifficultyRanges(null, null, cfg, "boolean"),
      DEFAULT_DIFFICULTY_RANGES.boolean,
    );
  });

  it("season override wins over config", () => {
    const cfg = makeConfig({ difficulty: { choice: { easy: [3, 4] } } });
    const season: SeasonEntry = {
      ...baseSeason,
      difficulty: { choice: { easy: [5, 6] } },
    };
    const r = resolveDifficultyRanges(season, null, cfg, "choice");
    assert.deepEqual(r.easy, [5, 6]);
  });

  it("slot override wins over season + config", () => {
    const cfg = makeConfig({ difficulty: { choice: { hard: [7, 8] } } });
    const season: SeasonEntry = {
      ...baseSeason,
      difficulty: { choice: { hard: [8, 9] } },
      format: { questions: [{ difficulty: { choice: { hard: [10, 10] } } }] },
    };
    const r = resolveDifficultyRanges(season, 0, cfg, "choice");
    assert.deepEqual(r.hard, [10, 10]);
  });

  it("slot without difficulty falls back through season → config → default", () => {
    const cfg = makeConfig({ difficulty: { freeform: { minimumThreshold: 3 } } });
    const season: SeasonEntry = {
      ...baseSeason,
      format: { questions: [{}] },
    };
    const r = resolveDifficultyRanges(season, 0, cfg, "freeform");
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
    const r = resolveDifficultyRanges(season, 0, cfg, "boolean");
    assert.deepEqual(r.easy, [2, 3]);
    assert.deepEqual(r.medium, [5, 6]);
    assert.deepEqual(r.hard, [9, 9]);
    assert.equal(r.minimumThreshold, DEFAULT_DIFFICULTY_RANGES.boolean.minimumThreshold);
  });
});
