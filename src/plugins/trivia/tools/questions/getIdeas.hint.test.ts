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
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

/** Force boolean roll + a specific difficulty bucket by config. */
function makeConfig(
  forcedBucket: "easy" | "medium" | "hard",
  hint?: TriviaConfig["hint"],
): TriviaConfig {
  return {
    seasons: { enabled: true, prompt: "Monthly" },
    answersFormat: { boolean: 1, choice: 0, freeform: 0 },
    difficultyRatio: {
      boolean: {
        easy: forcedBucket === "easy" ? 1 : 0,
        medium: forcedBucket === "medium" ? 1 : 0,
        hard: forcedBucket === "hard" ? 1 : 0,
      },
    },
    ...(hint !== undefined ? { hint } : {}),
  };
}

function mockSeason() {
  const now = Date.now();
  return {
    seasons: [
      {
        slug: "active",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["Science", "History", "Geography", "Sports", "Art"],
      },
    ],
  };
}

describe("get_ideas — hint axis", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Baseline-1", "Baseline-2"]);
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue(mockSeason());
  });

  it("workspace hint absent → suggestedHintMode 'none', no hintGuidance", async () => {
    const tool = createGetIdeasTool(data, () => makeConfig("medium"), fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedHintMode, "none");
    assert.equal(parsed.hintGuidance, undefined);
  });

  it("workspace hint { mode: 'button' } no threshold → suggested 'button' with guidance", async () => {
    const tool = createGetIdeasTool(
      data,
      () => makeConfig("medium", { mode: "button" }),
      fixtureGetGames,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedHintMode, "button");
    assert.equal(typeof parsed.hintGuidance, "string");
    assert.match(parsed.hintGuidance, /140 chars/);
  });

  it("threshold suppresses hint on easy when min is 'medium'", async () => {
    const tool = createGetIdeasTool(
      data,
      () => makeConfig("easy", { mode: "inline", minDifficulty: "medium" }),
      fixtureGetGames,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedDifficulty, "Easy");
    assert.equal(parsed.suggestedHintMode, "none");
    assert.equal(parsed.hintGuidance, undefined);
  });

  it("threshold passes on medium when min is 'medium'", async () => {
    const tool = createGetIdeasTool(
      data,
      () => makeConfig("medium", { mode: "inline", minDifficulty: "medium" }),
      fixtureGetGames,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedDifficulty, "Medium");
    assert.equal(parsed.suggestedHintMode, "inline");
    assert.equal(typeof parsed.hintGuidance, "string");
  });

  it("threshold passes on hard when min is 'medium'", async () => {
    const tool = createGetIdeasTool(
      data,
      () => makeConfig("hard", { mode: "button", minDifficulty: "medium" }),
      fixtureGetGames,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedDifficulty, "Hard");
    assert.equal(parsed.suggestedHintMode, "button");
  });
});
