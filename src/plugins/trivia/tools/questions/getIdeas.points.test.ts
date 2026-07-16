import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaConfig, TriviaGame, TriviaPointsConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function makeConfig(points?: TriviaPointsConfig): TriviaConfig {
  return {
    seasons: { enabled: true, prompt: "Monthly" },
    answersFormat: { boolean: 1, choice: 0, freeform: 0 },
    ...(points !== undefined ? { points } : {}),
  };
}

function mockSeason(points?: TriviaPointsConfig) {
  const now = Date.now();
  return {
    seasons: [
      {
        slug: "active",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["Science", "History", "Geography", "Sports", "Art"],
        ...(points !== undefined ? { points } : {}),
      },
    ],
  };
}

async function ideas(
  data: FakeTriviaDataLayer,
  config: TriviaConfig,
  games?: readonly TriviaGame[],
  slot?: number,
) {
  const tool = createGetIdeasTool(data, () => config, games ? () => games : fixtureGetGames);
  return parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME, slot }, SESSION));
}

describe("get_ideas — points axis", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Baseline-1", "Baseline-2"]);
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue(mockSeason());
  });

  it("no points configured → neither field surfaces", async () => {
    const parsed = await ideas(data, makeConfig());
    assert.equal(parsed.maxPoints, undefined);
    assert.equal(parsed.pointsGuidance, undefined);
  });

  it("cap + guidance → both fields surface", async () => {
    const parsed = await ideas(data, makeConfig({ max: 3, guidance: "hard questions pay 3" }));
    assert.equal(parsed.maxPoints, 3);
    assert.equal(parsed.pointsGuidance, "hard questions pay 3");
  });

  it("bare cap without guidance → neither field surfaces (allowance, not an instruction)", async () => {
    const parsed = await ideas(data, makeConfig({ max: 3 }));
    assert.equal(parsed.maxPoints, undefined);
    assert.equal(parsed.pointsGuidance, undefined);
  });

  it("guidance under a max of 1 → neither field surfaces (nothing above 1 is reachable)", async () => {
    const parsed = await ideas(data, makeConfig({ max: 1, guidance: "hard = 2" }));
    assert.equal(parsed.maxPoints, undefined);
    assert.equal(parsed.pointsGuidance, undefined);
  });

  it("game tier beats workspace", async () => {
    const games: readonly TriviaGame[] = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C1",
        questionCron: "0 9 * * *",
        revealCron: "0 17 * * *",
        timezone: "UTC",
        enabled: true,
        points: { max: 5, guidance: "game rule" },
      },
    ];
    const parsed = await ideas(data, makeConfig({ max: 2, guidance: "workspace rule" }), games);
    assert.equal(parsed.maxPoints, 5);
    assert.equal(parsed.pointsGuidance, "game rule");
  });

  it("season tier beats game and workspace", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Baseline-1", "Baseline-2"]);
    data
      .forGame(FIXTURE_GAME_NAME)
      .loadSeasonsState.mockResolvedValue(mockSeason({ max: 4, guidance: "season rule" }));
    const parsed = await ideas(data, makeConfig({ max: 2, guidance: "workspace rule" }));
    assert.equal(parsed.maxPoints, 4);
    assert.equal(parsed.pointsGuidance, "season rule");
  });

  it("a season tier with a bare cap masks the workspace guidance and turns the axis off", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Baseline-1", "Baseline-2"]);
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue(mockSeason({ max: 4 }));
    const parsed = await ideas(data, makeConfig({ max: 2, guidance: "workspace rule" }));
    assert.equal(parsed.maxPoints, undefined, "whole-object replace — no guidance survives");
    assert.equal(parsed.pointsGuidance, undefined);
  });

  it("game slot tier beats game", async () => {
    const games: readonly TriviaGame[] = [
      {
        name: FIXTURE_GAME_NAME,
        channel: "C1",
        questionCron: "0 9 * * *",
        revealCron: "0 17 * * *",
        timezone: "UTC",
        enabled: true,
        points: { max: 2, guidance: "game rule" },
        format: { questions: [{}, { points: { max: 6, guidance: "finale is high-stakes" } }] },
      },
    ];
    const slot0 = await ideas(data, makeConfig(), games, 0);
    assert.equal(slot0.maxPoints, 2);
    assert.equal(slot0.pointsGuidance, "game rule");

    const slot1 = await ideas(data, makeConfig(), games, 1);
    assert.equal(slot1.maxPoints, 6);
    assert.equal(slot1.pointsGuidance, "finale is high-stakes");
  });
});
