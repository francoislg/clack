import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createGetIdeasTool } from "./getIdeas.js";
import { createUpsertSeasonTool } from "../seasons/upsertSeason.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaConfig } from "../../core/configTypes.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

function makeConfig(triviaSeasonsEnabled: boolean): TriviaConfig {
  return triviaSeasonsEnabled ? { seasons: { enabled: true, prompt: "Test prompt" } } : {};
}

describe("get_ideas + upsert_season cross-tool flow", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History", "Geography"]);
  });

  it("theme set via upsert_season surfaces on the next get_ideas call", async () => {
    const past = Date.now() - 1 * DAY;
    // Seed an active season directly (upsert_season can't create one started in the past).
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
      seasons: [
        {
          slug: "active-2026",
          startedAt: past,
          expectedEndAt: past + 60 * DAY,
          categories: ["Science", "History"],
        },
      ],
    });

    const upsert = createUpsertSeasonTool(data, fixtureGetGames);
    const upsertRes = parseToolResult(
      await upsert.handler(
        {
          game: FIXTURE_GAME_NAME,
          slug: "active-2026",
          startedAt: undefined,
          expectedEndAt: undefined,
          endedAt: undefined,
          categories: undefined,
          theme: "Halloween Spooktacular",
          answersFormat: undefined,
          questionType: undefined,
          promptMedium: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
          difficultyRatio: undefined,
          format: undefined,
          slotOverrides: undefined,
          liveAnswersVisible: undefined,
          revealResponses: undefined,
          instructions: undefined,
          additionalInstructions: undefined,
          hint: undefined,
          judgeLeniency: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(upsertRes.action, "updated");
    assert.equal(upsertRes.hasTheme, true);

    const ideas = createGetIdeasTool(data, () => makeConfig(true), fixtureGetGames);
    const result = await ideas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION);
    const parsed = parseToolResult(result);
    assert.equal(parsed.theme, "Halloween Spooktacular");
    assert.equal(parsed.firstFireOfSeason, true);
  });
});
