import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

type UpsertArgs = Parameters<ReturnType<typeof createUpsertSeasonTool>["handler"]>[0];

function makeArgs(overrides: Partial<UpsertArgs>): UpsertArgs {
  return {
    game: FIXTURE_GAME_NAME,
    slug: "s1",
    startedAt: undefined,
    expectedEndAt: undefined,
    endedAt: undefined,
    categories: undefined,
    answersFormat: undefined,
    questionType: undefined,
    promptMedium: undefined,
    freeformAnswerShape: undefined,
    contexts: undefined,
    difficulty: undefined,
    difficultyRatio: undefined,
    theme: undefined,
    format: undefined,
    slotOverrides: undefined,
    liveAnswersVisible: undefined,
    revealResponses: undefined,
    instructions: undefined,
    additionalInstructions: undefined,
    hint: undefined,
    judgeLeniency: undefined,
    choices: undefined,
    choiceEmojiStyle: undefined,
    points: undefined,
    ...overrides,
  };
}

describe("upsert_season — choices argument", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("create stores season-tier choices verbatim", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const parsed = parseToolResult(
      await tool.handler(
        makeArgs({
          slug: "narrow",
          startedAt: future,
          expectedEndAt: future + 30 * DAY,
          choices: { min: 3, max: 3 },
        }),
        SESSION,
      ),
    );
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasChoices, true);
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.deepEqual(state?.seasons.find((s) => s.slug === "narrow")?.choices, { min: 3, max: 3 });
  });

  it("create rejects out-of-range bounds", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const parsed = parseToolResult(
      await tool.handler(
        makeArgs({
          slug: "bad",
          startedAt: future,
          expectedEndAt: future + 30 * DAY,
          choices: { min: 2, max: 5 },
        }),
        SESSION,
      ),
    );
    assert.ok(parsed.error || parsed.isError);
  });

  it("create stores per-slot choices via format", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      makeArgs({
        slug: "paced",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        format: { questions: [{ choices: { min: 2, max: 2 } }, { choices: { min: 4, max: 4 } }] },
      }),
      SESSION,
    );
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "paced");
    assert.deepEqual(entry?.format?.questions[0].choices, { min: 2, max: 2 });
    assert.deepEqual(entry?.format?.questions[1].choices, { min: 4, max: 4 });
  });

  it("update clears choices with null", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      makeArgs({
        slug: "clearme",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        choices: { min: 2, max: 2 },
      }),
      SESSION,
    );
    const cleared = parseToolResult(
      await tool.handler(makeArgs({ slug: "clearme", choices: null }), SESSION),
    );
    assert.equal(cleared.hasChoices, false);
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(state?.seasons.find((s) => s.slug === "clearme")?.choices, undefined);
  });
});
