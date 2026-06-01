import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { DEFAULT_PROMPT_MEDIUM_WEIGHTS } from "../core/configTypes.js";
import { resolvePromptMedium, getActivePromptMedium } from "./promptMediums.js";
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

describe("resolvePromptMedium", () => {
  const baseSeason: SeasonEntry = {
    slug: "active",
    startedAt: NOW - HOUR,
    expectedEndAt: NOW + HOUR,
    categories: ["X"],
  };

  it("returns DEFAULT_PROMPT_MEDIUM_WEIGHTS when no source set", () => {
    assert.deepEqual(resolvePromptMedium(null, null, null, null), DEFAULT_PROMPT_MEDIUM_WEIGHTS);
    assert.deepEqual(
      resolvePromptMedium(null, null, null, makeConfig()),
      DEFAULT_PROMPT_MEDIUM_WEIGHTS,
    );
  });

  it("slot.promptMedium wins over season + game + config", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      promptMedium: { text: 1, image: 0 },
      format: { questions: [{ promptMedium: { text: 0, image: 5 } }, {}] },
    };
    const game = makeGame({ promptMedium: { text: 1, image: 1 } });
    const cfg = makeConfig({ promptMedium: { text: 1, image: 1 } });
    assert.deepEqual(resolvePromptMedium(season, 0, game, cfg), { text: 0, image: 5 });
  });

  it("slot without promptMedium falls back to season's promptMedium", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      promptMedium: { text: 0, image: 3 },
      format: { questions: [{}] },
    };
    const cfg = makeConfig({ promptMedium: { text: 1, image: 1 } });
    assert.deepEqual(resolvePromptMedium(season, 0, null, cfg), { text: 0, image: 3 });
  });

  it("season without promptMedium falls back to game then config", () => {
    const game = makeGame({ promptMedium: { text: 1, image: 2 } });
    const cfg = makeConfig({ promptMedium: { text: 2, image: 1 } });
    assert.deepEqual(resolvePromptMedium(baseSeason, null, game, cfg), { text: 1, image: 2 });
  });

  it("game.promptMedium wins over workspace config", () => {
    const game = makeGame({ promptMedium: { text: 0, image: 1 } });
    const cfg = makeConfig({ promptMedium: { text: 1, image: 0 } });
    assert.deepEqual(resolvePromptMedium(null, null, game, cfg), { text: 0, image: 1 });
  });

  it("season.promptMedium wins over game.promptMedium", () => {
    const season: SeasonEntry = { ...baseSeason, promptMedium: { text: 1, image: 0 } };
    const game = makeGame({ promptMedium: { text: 0, image: 1 } });
    assert.deepEqual(resolvePromptMedium(season, null, game, makeConfig()), { text: 1, image: 0 });
  });

  it("all sources absent → DEFAULT_PROMPT_MEDIUM_WEIGHTS", () => {
    assert.deepEqual(
      resolvePromptMedium(baseSeason, null, null, makeConfig()),
      DEFAULT_PROMPT_MEDIUM_WEIGHTS,
    );
  });

  it("game=null is equivalent to no per-game override (skip tier)", () => {
    const cfg = makeConfig({ promptMedium: { text: 2, image: 1 } });
    assert.deepEqual(resolvePromptMedium(null, null, null, cfg), { text: 2, image: 1 });
  });
});

describe("getActivePromptMedium", () => {
  it("returns DEFAULT when seasons disabled and no config override", async () => {
    const weights = await getActivePromptMedium(makeScopedDataLayer(null), makeConfig(), NOW, null);
    assert.deepEqual(weights, DEFAULT_PROMPT_MEDIUM_WEIGHTS);
  });

  it("uses config when seasons disabled and config provides promptMedium", async () => {
    const weights = await getActivePromptMedium(
      makeScopedDataLayer(null),
      makeConfig({ promptMedium: { text: 3, image: 1 } }),
      NOW,
      null,
    );
    assert.deepEqual(weights, { text: 3, image: 1 });
  });

  it("per-game promptMedium wins over workspace when seasons disabled", async () => {
    const game = makeGame({ promptMedium: { text: 0, image: 1 } });
    const weights = await getActivePromptMedium(
      makeScopedDataLayer(null),
      makeConfig({ promptMedium: { text: 1, image: 0 } }),
      NOW,
      game,
    );
    assert.deepEqual(weights, { text: 0, image: 1 });
  });

  it("uses current season's promptMedium when seasons enabled", async () => {
    const state: SeasonsState = {
      seasons: [
        {
          slug: "current",
          startedAt: NOW - HOUR,
          expectedEndAt: NOW + HOUR,
          categories: ["A"],
          promptMedium: { text: 0, image: 1 },
        },
      ],
    };
    const weights = await getActivePromptMedium(
      makeScopedDataLayer(state),
      makeConfig({
        seasons: { enabled: true, prompt: "monthly" },
        promptMedium: { text: 1, image: 0 },
      }),
      NOW,
      null,
    );
    assert.deepEqual(weights, { text: 0, image: 1 });
  });
});
