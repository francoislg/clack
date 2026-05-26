import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import {
  DEFAULT_ANSWERS_FORMAT_WEIGHTS,
  getActiveChoiceBounds,
  getActiveAnswersFormat,
  resolveAnswersFormat,
} from "./questionTypes.js";
import type { ScopedTriviaDataLayer, SeasonsState, SeasonEntry } from "../core/types.js";

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

function makeScopedDataLayer(state: SeasonsState | null): ScopedTriviaDataLayer {
  return {
    loadQuestions: async () => [],
    saveQuestion: async () => {},
    updateQuestion: async () => {},
    loadAnswers: async () => [],
    saveAnswer: async () => {},
    updateAnswer: async () => {},
    deleteAnswersForQuestion: async () => 0,
    loadCheats: async () => [],
    saveCheat: async () => ({ totalAttempts: 0 }),
    loadSeasonsState: async () => state,
    saveSeasonsState: async () => {},
    getCurrentSeasonSlug: async () => null,
  };
}

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe("getActiveAnswersFormat", () => {
  it("defaults to pure boolean when no source is set", async () => {
    const data = makeScopedDataLayer(null);
    const cfg = makeConfig();
    const weights = await getActiveAnswersFormat(data, cfg, NOW, null);
    assert.deepEqual(weights, DEFAULT_ANSWERS_FORMAT_WEIGHTS);
  });

  it("uses config.trivia.answersFormat when seasons disabled", async () => {
    const data = makeScopedDataLayer(null);
    const cfg = makeConfig({ answersFormat: { boolean: 2, choice: 1, freeform: 0 } });
    const weights = await getActiveAnswersFormat(data, cfg, NOW, null);
    assert.deepEqual(weights, { boolean: 2, choice: 1, freeform: 0 });
  });

  it("ignores season state when seasons.enabled is false", async () => {
    const state: SeasonsState = {
      seasons: [
        {
          slug: "current",
          startedAt: NOW - HOUR,
          expectedEndAt: NOW + HOUR,
          categories: ["A"],
          answersFormat: { boolean: 0, choice: 5, freeform: 0 },
        },
      ],
    };
    const data = makeScopedDataLayer(state);
    const cfg = makeConfig({
      answersFormat: { boolean: 1, choice: 0, freeform: 0 },
      // seasons block absent → seasons disabled
    });
    const weights = await getActiveAnswersFormat(data, cfg, NOW, null);
    assert.deepEqual(weights, { boolean: 1, choice: 0, freeform: 0 });
  });

  it("uses current season's answersFormat when seasons enabled and field is set", async () => {
    const state: SeasonsState = {
      seasons: [
        {
          slug: "current",
          startedAt: NOW - HOUR,
          expectedEndAt: NOW + HOUR,
          categories: ["A"],
          answersFormat: { boolean: 0, choice: 5, freeform: 0 },
        },
      ],
    };
    const data = makeScopedDataLayer(state);
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "monthly" },
      answersFormat: { boolean: 1, choice: 0, freeform: 0 },
    });
    const weights = await getActiveAnswersFormat(data, cfg, NOW, null);
    assert.deepEqual(weights, { boolean: 0, choice: 5, freeform: 0 });
  });

  it("falls back to config when current season lacks answersFormat", async () => {
    const state: SeasonsState = {
      seasons: [
        {
          slug: "current",
          startedAt: NOW - HOUR,
          expectedEndAt: NOW + HOUR,
          categories: ["A"],
          // no answersFormat
        },
      ],
    };
    const data = makeScopedDataLayer(state);
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "monthly" },
      answersFormat: { boolean: 2, choice: 1, freeform: 0 },
    });
    const weights = await getActiveAnswersFormat(data, cfg, NOW, null);
    assert.deepEqual(weights, { boolean: 2, choice: 1, freeform: 0 });
  });

  it("falls back to config when seasons enabled but in a gap (no current entry)", async () => {
    const state: SeasonsState = {
      seasons: [
        {
          slug: "past",
          startedAt: NOW - 10 * HOUR,
          expectedEndAt: NOW - 5 * HOUR,
          categories: ["A"],
          answersFormat: { boolean: 0, choice: 1, freeform: 0 },
        },
        {
          slug: "future",
          startedAt: NOW + 5 * HOUR,
          expectedEndAt: NOW + 10 * HOUR,
          categories: ["A"],
          answersFormat: { boolean: 0, choice: 1, freeform: 0 },
        },
      ],
    };
    const data = makeScopedDataLayer(state);
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "monthly" },
      answersFormat: { boolean: 1, choice: 1, freeform: 0 },
    });
    const weights = await getActiveAnswersFormat(data, cfg, NOW, null);
    assert.deepEqual(weights, { boolean: 1, choice: 1, freeform: 0 });
  });

  it("falls back to default when seasons enabled but seasons.json is null", async () => {
    const data = makeScopedDataLayer(null);
    const cfg = makeConfig({ seasons: { enabled: true, prompt: "monthly" } });
    const weights = await getActiveAnswersFormat(data, cfg, NOW, null);
    assert.deepEqual(weights, DEFAULT_ANSWERS_FORMAT_WEIGHTS);
  });
});

describe("resolveAnswersFormat (slot-aware)", () => {
  const baseSeason: SeasonEntry = {
    slug: "active",
    startedAt: NOW - HOUR,
    expectedEndAt: NOW + HOUR,
    categories: ["X"],
  };

  it("slot.answersFormat wins over season + config", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      answersFormat: { boolean: 1, choice: 0, freeform: 0 },
      format: {
        questions: [
          { answersFormat: { boolean: 0, choice: 5, freeform: 0 } },
          {}, // no answersFormat
        ],
      },
    };
    const cfg = makeConfig({ answersFormat: { boolean: 1, choice: 1, freeform: 0 } });
    assert.deepEqual(resolveAnswersFormat(season, 0, null, cfg), {
      boolean: 0,
      choice: 5,
      freeform: 0,
    });
  });

  it("slot without answersFormat falls back to season's answersFormat", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      answersFormat: { boolean: 0, choice: 3, freeform: 0 },
      format: { questions: [{}] }, // slot 0 has no answersFormat
    };
    const cfg = makeConfig({ answersFormat: { boolean: 1, choice: 1, freeform: 0 } });
    assert.deepEqual(resolveAnswersFormat(season, 0, null, cfg), {
      boolean: 0,
      choice: 3,
      freeform: 0,
    });
  });

  it("season without answersFormat (slot also empty) falls back to config", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      format: { questions: [{}] },
    };
    const cfg = makeConfig({ answersFormat: { boolean: 2, choice: 1, freeform: 0 } });
    assert.deepEqual(resolveAnswersFormat(season, 0, null, cfg), {
      boolean: 2,
      choice: 1,
      freeform: 0,
    });
  });

  it("all sources absent → DEFAULT", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      format: { questions: [{}] },
    };
    const cfg = makeConfig(); // no answersFormat
    assert.deepEqual(resolveAnswersFormat(season, 0, null, cfg), DEFAULT_ANSWERS_FORMAT_WEIGHTS);
  });

  it("null season + null config defaults", () => {
    assert.deepEqual(resolveAnswersFormat(null, null, null, null), DEFAULT_ANSWERS_FORMAT_WEIGHTS);
  });

  it("slotIndex: null with no format uses season-level answersFormat", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      answersFormat: { boolean: 0, choice: 1, freeform: 0 },
    };
    const cfg = makeConfig();
    assert.deepEqual(resolveAnswersFormat(season, null, null, cfg), {
      boolean: 0,
      choice: 1,
      freeform: 0,
    });
  });

  it("game.answersFormat wins over workspace config", () => {
    const game = makeGame({ answersFormat: { boolean: 0, choice: 1, freeform: 0 } });
    const cfg = makeConfig({ answersFormat: { boolean: 1, choice: 0, freeform: 0 } });
    assert.deepEqual(resolveAnswersFormat(null, null, game, cfg), {
      boolean: 0,
      choice: 1,
      freeform: 0,
    });
  });

  it("season.answersFormat wins over game.answersFormat", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      answersFormat: { boolean: 1, choice: 0, freeform: 0 },
    };
    const game = makeGame({ answersFormat: { boolean: 0, choice: 1, freeform: 0 } });
    assert.deepEqual(resolveAnswersFormat(season, null, game, makeConfig()), {
      boolean: 1,
      choice: 0,
      freeform: 0,
    });
  });

  it("slot.answersFormat wins over game.answersFormat", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      format: { questions: [{ answersFormat: { boolean: 1, choice: 0, freeform: 0 } }] },
    };
    const game = makeGame({ answersFormat: { boolean: 0, choice: 0, freeform: 1 } });
    assert.deepEqual(resolveAnswersFormat(season, 0, game, makeConfig()), {
      boolean: 1,
      choice: 0,
      freeform: 0,
    });
  });

  it("game without answersFormat falls through to workspace", () => {
    const game = makeGame(); // no answersFormat
    const cfg = makeConfig({ answersFormat: { boolean: 1, choice: 1, freeform: 0 } });
    assert.deepEqual(resolveAnswersFormat(null, null, game, cfg), {
      boolean: 1,
      choice: 1,
      freeform: 0,
    });
  });
});

describe("getActiveChoiceBounds", () => {
  it("defaults to { min: 4, max: 4 } when not configured", () => {
    assert.deepEqual(getActiveChoiceBounds(makeConfig()), { min: 4, max: 4 });
  });

  it("returns workspace bounds when configured", () => {
    const cfg = makeConfig({ choices: { min: 3, max: 4 } });
    assert.deepEqual(getActiveChoiceBounds(cfg), { min: 3, max: 4 });
  });

  it("ignores season state — bounds are workspace-only", () => {
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "monthly" },
      choices: { min: 2, max: 3 },
    });
    assert.deepEqual(getActiveChoiceBounds(cfg), { min: 2, max: 3 });
  });
});
