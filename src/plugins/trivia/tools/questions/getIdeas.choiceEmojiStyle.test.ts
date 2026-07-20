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
import type { ChoiceEmojiStyle, TriviaConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

/** Force the choice roll so the choice handler's per-format suggestions surface. */
function makeConfig(choiceEmojiStyle?: ChoiceEmojiStyle): TriviaConfig {
  return {
    seasons: { enabled: true, prompt: "Monthly" },
    answersFormat: { boolean: 0, choice: 1, freeform: 0 },
    ...(choiceEmojiStyle !== undefined ? { choiceEmojiStyle } : {}),
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

describe("get_ideas — choiceEmojiStyle axis", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: createdData } = createTriviaDataLayer(sdk);
    data = createdData;
    data.loadCategories.mockResolvedValue(["Baseline-1", "Baseline-2"]);
    data.forGame(FIXTURE_GAME_NAME).loadSeasonsState.mockResolvedValue(mockSeason());
  });

  it("axis absent → suggestedChoiceEmojiStyle 'numbers', no guidance", async () => {
    const tool = createGetIdeasTool(data, () => makeConfig(), fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedAnswersFormat, "choice");
    assert.equal(parsed.suggestedChoiceEmojiStyle, "numbers");
    assert.equal(parsed.choiceEmojiGuidance, undefined);
  });

  it("workspace 'themed' → suggested 'themed' with guidance", async () => {
    const tool = createGetIdeasTool(data, () => makeConfig("themed"), fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedChoiceEmojiStyle, "themed");
    assert.equal(typeof parsed.choiceEmojiGuidance, "string");
    assert.match(parsed.choiceEmojiGuidance, /Unicode emoji/);
  });

  it("boolean roll carries no choice-emoji fields", async () => {
    const tool = createGetIdeasTool(
      data,
      () => ({ ...makeConfig("themed"), answersFormat: { boolean: 1, choice: 0, freeform: 0 } }),
      fixtureGetGames,
    );
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(parsed.suggestedAnswersFormat, "boolean");
    assert.equal(parsed.suggestedChoiceEmojiStyle, undefined);
    assert.equal(parsed.choiceEmojiGuidance, undefined);
  });
});
