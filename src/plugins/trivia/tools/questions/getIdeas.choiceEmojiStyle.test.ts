import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { ChoiceEmojiStyle, TriviaConfig } from "../../core/configTypes.js";
import type { TriviaDataLayer } from "../../core/types.js";

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

async function seedSeason(data: TriviaDataLayer): Promise<void> {
  const now = Date.now();
  await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
    seasons: [
      {
        slug: "active",
        startedAt: now - 10 * DAY,
        expectedEndAt: now + 20 * DAY,
        categories: ["Science", "History", "Geography", "Sports", "Art"],
      },
    ],
  });
}

describe("get_ideas — choiceEmojiStyle axis", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Baseline-1", "Baseline-2"]);
    await seedSeason(data);
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
