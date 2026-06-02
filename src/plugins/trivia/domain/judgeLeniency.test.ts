import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveJudgeLeniency } from "./judgeLeniency.js";
import type { SeasonEntry } from "../core/types.js";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";

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

describe("resolveJudgeLeniency", () => {
  it("falls through to 'strict-with-typos' when no tier is set", () => {
    assert.equal(resolveJudgeLeniency(null, null, null, null), "strict-with-typos");
    assert.equal(
      resolveJudgeLeniency(null, baseSeason, baseGame, baseWorkspace),
      "strict-with-typos",
    );
  });

  it("workspace tier wins when game/season unset", () => {
    assert.equal(
      resolveJudgeLeniency(null, baseSeason, baseGame, {
        ...baseWorkspace,
        judgeLeniency: "strict",
      }),
      "strict",
    );
  });

  it("game tier wins over workspace", () => {
    assert.equal(
      resolveJudgeLeniency(
        null,
        baseSeason,
        { ...baseGame, judgeLeniency: "lenient" },
        { ...baseWorkspace, judgeLeniency: "strict" },
      ),
      "lenient",
    );
  });

  it("season tier wins over game and workspace", () => {
    assert.equal(
      resolveJudgeLeniency(
        null,
        { ...baseSeason, judgeLeniency: "strict" },
        { ...baseGame, judgeLeniency: "lenient" },
        { ...baseWorkspace, judgeLeniency: "lenient" },
      ),
      "strict",
    );
  });

  it("slot tier wins when slotIndex matches a slot with judgeLeniency", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      judgeLeniency: "lenient",
      format: { questions: [{}, { judgeLeniency: "strict" }] },
    };
    assert.equal(resolveJudgeLeniency(1, season, baseGame, baseWorkspace), "strict");
  });

  it("falls back to season when slot exists but has no judgeLeniency", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      judgeLeniency: "lenient",
      format: { questions: [{}, {}] },
    };
    assert.equal(resolveJudgeLeniency(1, season, baseGame, baseWorkspace), "lenient");
  });
});
