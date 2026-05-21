import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../../../config.js";
import { DEFAULT_QUESTION_TYPE_WEIGHTS } from "../../../config.js";
import { resolveQuestionType, getActiveQuestionType } from "./factTopical.js";
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
    assert.deepEqual(resolveQuestionType(null, null, null), DEFAULT_QUESTION_TYPE_WEIGHTS);
    assert.deepEqual(resolveQuestionType(null, null, makeConfig()), DEFAULT_QUESTION_TYPE_WEIGHTS);
  });

  it("slot.questionType wins over season + config", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      questionType: { fact: 1, topical: 0 },
      format: { questions: [{ questionType: { fact: 0, topical: 5 } }, {}] },
    };
    const cfg = makeConfig({ questionType: { fact: 1, topical: 1 } });
    assert.deepEqual(resolveQuestionType(season, 0, cfg), { fact: 0, topical: 5 });
  });

  it("slot without questionType falls back to season's questionType", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      questionType: { fact: 0, topical: 3 },
      format: { questions: [{}] },
    };
    const cfg = makeConfig({ questionType: { fact: 1, topical: 1 } });
    assert.deepEqual(resolveQuestionType(season, 0, cfg), { fact: 0, topical: 3 });
  });

  it("season without questionType falls back to config", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      format: { questions: [{}] },
    };
    const cfg = makeConfig({ questionType: { fact: 2, topical: 1 } });
    assert.deepEqual(resolveQuestionType(season, 0, cfg), { fact: 2, topical: 1 });
  });

  it("all sources absent → DEFAULT_QUESTION_TYPE_WEIGHTS", () => {
    assert.deepEqual(
      resolveQuestionType(baseSeason, null, makeConfig()),
      DEFAULT_QUESTION_TYPE_WEIGHTS,
    );
  });
});

describe("getActiveQuestionType", () => {
  it("returns DEFAULT when seasons disabled and no config override", async () => {
    const weights = await getActiveQuestionType(makeScopedDataLayer(null), makeConfig(), NOW);
    assert.deepEqual(weights, DEFAULT_QUESTION_TYPE_WEIGHTS);
  });

  it("uses config when seasons disabled and config provides questionType", async () => {
    const weights = await getActiveQuestionType(
      makeScopedDataLayer(null),
      makeConfig({ questionType: { fact: 3, topical: 1 } }),
      NOW,
    );
    assert.deepEqual(weights, { fact: 3, topical: 1 });
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
    );
    assert.deepEqual(weights, { fact: 0, topical: 1 });
  });
});
