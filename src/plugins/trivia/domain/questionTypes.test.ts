import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../../../config.js";
import {
  DEFAULT_ANSWERS_FORMAT_WEIGHTS,
  getActiveChoiceBounds,
  getActiveAnswersFormat,
  resolveAnswersFormat,
} from "./questionTypes.js";
import type { ScopedTriviaDataLayer, SeasonsState, SeasonEntry } from "../core/types.js";

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

function makeScopedDataLayer(state: SeasonsState | null): ScopedTriviaDataLayer {
  return {
    loadQuestions: async () => [],
    saveQuestion: async () => {},
    updateQuestion: async () => {},
    loadAnswers: async () => [],
    saveAnswer: async () => {},
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
    const weights = await getActiveAnswersFormat(data, cfg, NOW);
    assert.deepEqual(weights, DEFAULT_ANSWERS_FORMAT_WEIGHTS);
  });

  it("uses config.trivia.answersFormat when seasons disabled", async () => {
    const data = makeScopedDataLayer(null);
    const cfg = makeConfig({ answersFormat: { boolean: 2, choice: 1 } });
    const weights = await getActiveAnswersFormat(data, cfg, NOW);
    assert.deepEqual(weights, { boolean: 2, choice: 1 });
  });

  it("ignores season state when seasons.enabled is false", async () => {
    const state: SeasonsState = {
      seasons: [
        {
          slug: "current",
          startedAt: NOW - HOUR,
          expectedEndAt: NOW + HOUR,
          categories: ["A"],
          answersFormat: { boolean: 0, choice: 5 },
        },
      ],
    };
    const data = makeScopedDataLayer(state);
    const cfg = makeConfig({
      answersFormat: { boolean: 1, choice: 0 },
      // seasons block absent → seasons disabled
    });
    const weights = await getActiveAnswersFormat(data, cfg, NOW);
    assert.deepEqual(weights, { boolean: 1, choice: 0 });
  });

  it("uses current season's answersFormat when seasons enabled and field is set", async () => {
    const state: SeasonsState = {
      seasons: [
        {
          slug: "current",
          startedAt: NOW - HOUR,
          expectedEndAt: NOW + HOUR,
          categories: ["A"],
          answersFormat: { boolean: 0, choice: 5 },
        },
      ],
    };
    const data = makeScopedDataLayer(state);
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "monthly" },
      answersFormat: { boolean: 1, choice: 0 },
    });
    const weights = await getActiveAnswersFormat(data, cfg, NOW);
    assert.deepEqual(weights, { boolean: 0, choice: 5 });
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
      answersFormat: { boolean: 2, choice: 1 },
    });
    const weights = await getActiveAnswersFormat(data, cfg, NOW);
    assert.deepEqual(weights, { boolean: 2, choice: 1 });
  });

  it("falls back to config when seasons enabled but in a gap (no current entry)", async () => {
    const state: SeasonsState = {
      seasons: [
        {
          slug: "past",
          startedAt: NOW - 10 * HOUR,
          expectedEndAt: NOW - 5 * HOUR,
          categories: ["A"],
          answersFormat: { boolean: 0, choice: 1 },
        },
        {
          slug: "future",
          startedAt: NOW + 5 * HOUR,
          expectedEndAt: NOW + 10 * HOUR,
          categories: ["A"],
          answersFormat: { boolean: 0, choice: 1 },
        },
      ],
    };
    const data = makeScopedDataLayer(state);
    const cfg = makeConfig({
      seasons: { enabled: true, prompt: "monthly" },
      answersFormat: { boolean: 1, choice: 1 },
    });
    const weights = await getActiveAnswersFormat(data, cfg, NOW);
    assert.deepEqual(weights, { boolean: 1, choice: 1 });
  });

  it("falls back to default when seasons enabled but seasons.json is null", async () => {
    const data = makeScopedDataLayer(null);
    const cfg = makeConfig({ seasons: { enabled: true, prompt: "monthly" } });
    const weights = await getActiveAnswersFormat(data, cfg, NOW);
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
      answersFormat: { boolean: 1, choice: 0 },
      format: {
        questions: [
          { answersFormat: { boolean: 0, choice: 5 } },
          {}, // no answersFormat
        ],
      },
    };
    const cfg = makeConfig({ answersFormat: { boolean: 1, choice: 1 } });
    assert.deepEqual(resolveAnswersFormat(season, 0, cfg), { boolean: 0, choice: 5 });
  });

  it("slot without answersFormat falls back to season's answersFormat", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      answersFormat: { boolean: 0, choice: 3 },
      format: { questions: [{}] }, // slot 0 has no answersFormat
    };
    const cfg = makeConfig({ answersFormat: { boolean: 1, choice: 1 } });
    assert.deepEqual(resolveAnswersFormat(season, 0, cfg), { boolean: 0, choice: 3 });
  });

  it("season without answersFormat (slot also empty) falls back to config", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      format: { questions: [{}] },
    };
    const cfg = makeConfig({ answersFormat: { boolean: 2, choice: 1 } });
    assert.deepEqual(resolveAnswersFormat(season, 0, cfg), { boolean: 2, choice: 1 });
  });

  it("all sources absent → DEFAULT", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      format: { questions: [{}] },
    };
    const cfg = makeConfig(); // no answersFormat
    assert.deepEqual(resolveAnswersFormat(season, 0, cfg), DEFAULT_ANSWERS_FORMAT_WEIGHTS);
  });

  it("null season + null config defaults", () => {
    assert.deepEqual(resolveAnswersFormat(null, null, null), DEFAULT_ANSWERS_FORMAT_WEIGHTS);
  });

  it("slotIndex: null with no format uses season-level answersFormat", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      answersFormat: { boolean: 0, choice: 1 },
    };
    const cfg = makeConfig();
    assert.deepEqual(resolveAnswersFormat(season, null, cfg), { boolean: 0, choice: 1 });
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
