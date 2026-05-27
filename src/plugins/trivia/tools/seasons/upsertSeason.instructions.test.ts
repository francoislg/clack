import { describe, it, beforeEach, expect } from "vitest";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function baseArgs(slug: string, startedAt: number) {
  return {
    game: FIXTURE_GAME_NAME,
    slug,
    startedAt,
    expectedEndAt: startedAt + 30 * DAY,
    endedAt: undefined,
    categories: undefined,
    theme: undefined,
    answersFormat: undefined,
    questionType: undefined,
    freeformAnswerShape: undefined,
    contexts: undefined,
    difficulty: undefined,
    difficultyRatio: undefined,
    format: undefined,
    liveAnswersVisible: undefined,
    revealResponses: undefined,
    instructions: undefined,
    additionalInstructions: undefined,
  };
}

describe("upsert_season — instructions and additionalInstructions", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History"]);
  });

  it("create persists both fields and surfaces presence booleans", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = parseToolResult(
      await tool.handler(
        {
          ...baseArgs("with-both", future),
          instructions: "  Halloween-themed.  ",
          additionalInstructions: "Favor spooky angles.",
        },
        SESSION,
      ),
    );
    expect(result.action).toBe("created");
    expect(result.hasInstructions).toBe(true);
    expect(result.hasAdditionalInstructions).toBe(true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "with-both");
    expect(entry?.instructions).toBe("Halloween-themed.");
    expect(entry?.additionalInstructions).toBe("Favor spooky angles.");
  });

  it("update with null clears the named field but preserves the other", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      {
        ...baseArgs("with-both", future),
        instructions: "Halloween-themed.",
        additionalInstructions: "Favor spooky angles.",
      },
      SESSION,
    );
    await tool.handler(
      { ...baseArgs("with-both", future), startedAt: undefined, instructions: null },
      SESSION,
    );
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "with-both");
    expect(entry?.instructions).toBeUndefined();
    expect(entry?.additionalInstructions).toBe("Favor spooky angles.");
  });

  it("update with omitted fields preserves both", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      {
        ...baseArgs("preserve", future),
        instructions: "Halloween-themed.",
        additionalInstructions: "Favor spooky angles.",
      },
      SESSION,
    );
    // Update only the expectedEndAt.
    await tool.handler(
      {
        ...baseArgs("preserve", future),
        startedAt: undefined,
        expectedEndAt: future + 60 * DAY,
      },
      SESSION,
    );
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "preserve");
    expect(entry?.instructions).toBe("Halloween-themed.");
    expect(entry?.additionalInstructions).toBe("Favor spooky angles.");
  });

  it("rejects empty / whitespace-only strings", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = parseToolResult(
      await tool.handler({ ...baseArgs("blank", future), instructions: "   " }, SESSION),
    );
    expect(result.error ?? result.isError).toBeTruthy();
  });

  it("trims input on the way in", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      {
        ...baseArgs("trim", future),
        additionalInstructions: "\n  Stack me. \n",
      },
      SESSION,
    );
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "trim");
    expect(entry?.additionalInstructions).toBe("Stack me.");
  });
});
