import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { DEFAULT_QUESTION_TYPE_WEIGHTS } from "../core/configTypes.js";
import { resolveQuestionType, getActiveQuestionType } from "./factTopical.js";
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

describe("resolveQuestionType", () => {
  const baseSeason: SeasonEntry = {
    slug: "active",
    startedAt: NOW - HOUR,
    expectedEndAt: NOW + HOUR,
    categories: ["X"],
  };

  it("returns DEFAULT_QUESTION_TYPE_WEIGHTS when no source set", () => {
    assert.deepEqual(resolveQuestionType(null, null, null, null), DEFAULT_QUESTION_TYPE_WEIGHTS);
    assert.deepEqual(
      resolveQuestionType(null, null, null, makeConfig()),
      DEFAULT_QUESTION_TYPE_WEIGHTS,
    );
  });

  it("slot.questionType wins over season + config", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      questionType: { fact: 1, topical: 0 },
      format: { questions: [{ questionType: { fact: 0, topical: 5 } }, {}] },
    };
    const cfg = makeConfig({ questionType: { fact: 1, topical: 1 } });
    assert.deepEqual(resolveQuestionType(season, 0, null, cfg), { fact: 0, topical: 5 });
  });

  it("slot without questionType falls back to season's questionType", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      questionType: { fact: 0, topical: 3 },
      format: { questions: [{}] },
    };
    const cfg = makeConfig({ questionType: { fact: 1, topical: 1 } });
    assert.deepEqual(resolveQuestionType(season, 0, null, cfg), { fact: 0, topical: 3 });
  });

  it("season without questionType falls back to config", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      format: { questions: [{}] },
    };
    const cfg = makeConfig({ questionType: { fact: 2, topical: 1 } });
    assert.deepEqual(resolveQuestionType(season, 0, null, cfg), { fact: 2, topical: 1 });
  });

  it("all sources absent → DEFAULT_QUESTION_TYPE_WEIGHTS", () => {
    assert.deepEqual(
      resolveQuestionType(baseSeason, null, null, makeConfig()),
      DEFAULT_QUESTION_TYPE_WEIGHTS,
    );
  });

  it("game.questionType wins over workspace config", () => {
    const game = makeGame({ questionType: { fact: 0, topical: 1 } });
    const cfg = makeConfig({ questionType: { fact: 1, topical: 0 } });
    assert.deepEqual(resolveQuestionType(null, null, game, cfg), { fact: 0, topical: 1 });
  });

  it("season.questionType wins over game.questionType", () => {
    const season: SeasonEntry = { ...baseSeason, questionType: { fact: 1, topical: 0 } };
    const game = makeGame({ questionType: { fact: 0, topical: 1 } });
    assert.deepEqual(resolveQuestionType(season, null, game, makeConfig()), {
      fact: 1,
      topical: 0,
    });
  });

  it("game without questionType falls through to workspace", () => {
    const game = makeGame(); // no questionType
    const cfg = makeConfig({ questionType: { fact: 2, topical: 1 } });
    assert.deepEqual(resolveQuestionType(null, null, game, cfg), { fact: 2, topical: 1 });
  });

  it("game=null is equivalent to no per-game override (skip tier)", () => {
    const cfg = makeConfig({ questionType: { fact: 2, topical: 1 } });
    assert.deepEqual(resolveQuestionType(null, null, null, cfg), { fact: 2, topical: 1 });
  });
});

describe("getActiveQuestionType", () => {
  it("returns DEFAULT when seasons disabled and no config override", async () => {
    const weights = await getActiveQuestionType(makeScopedDataLayer(null), makeConfig(), NOW, null);
    assert.deepEqual(weights, DEFAULT_QUESTION_TYPE_WEIGHTS);
  });

  it("uses config when seasons disabled and config provides questionType", async () => {
    const weights = await getActiveQuestionType(
      makeScopedDataLayer(null),
      makeConfig({ questionType: { fact: 3, topical: 1 } }),
      NOW,
      null,
    );
    assert.deepEqual(weights, { fact: 3, topical: 1 });
  });

  it("per-game questionType wins over workspace when seasons disabled", async () => {
    const game = makeGame({ questionType: { fact: 0, topical: 1 } });
    const weights = await getActiveQuestionType(
      makeScopedDataLayer(null),
      makeConfig({ questionType: { fact: 1, topical: 0 } }),
      NOW,
      game,
    );
    assert.deepEqual(weights, { fact: 0, topical: 1 });
  });

  it("uses current season's questionType when seasons enabled", async () => {
    const state: SeasonsState = {
      seasons: [
        {
          slug: "current",
          startedAt: NOW - HOUR,
          expectedEndAt: NOW + HOUR,
          categories: ["A"],
          questionType: { fact: 0, topical: 1 },
        },
      ],
    };
    const weights = await getActiveQuestionType(
      makeScopedDataLayer(state),
      makeConfig({
        seasons: { enabled: true, prompt: "monthly" },
        questionType: { fact: 1, topical: 0 },
      }),
      NOW,
      null,
    );
    assert.deepEqual(weights, { fact: 0, topical: 1 });
  });
});
