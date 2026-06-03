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
    ...overrides,
  };
}

describe("upsert_season — slotOverrides argument", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History", "Geography"]);
  });

  it("create persists slotOverrides verbatim and reports hasSlotOverrides", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = parseToolResult(
      await tool.handler(
        makeArgs({
          slug: "img-q3",
          startedAt: future,
          expectedEndAt: future + 30 * DAY,
          slotOverrides: { 2: { promptMedium: { text: 0, image: 1 } } },
        }),
        SESSION,
      ),
    );
    assert.equal(result.action, "created");
    assert.equal(result.hasSlotOverrides, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.deepEqual(state?.seasons[0]?.slotOverrides, {
      2: { promptMedium: { text: 0, image: 1 } },
    });
  });

  it("rejects a season that sets both format and slotOverrides", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = parseToolResult(
      await tool.handler(
        makeArgs({
          slug: "both",
          startedAt: future,
          expectedEndAt: future + 30 * DAY,
          format: { questions: [{ label: "Q1" }] },
          slotOverrides: { 0: { promptMedium: { text: 0, image: 1 } } },
        }),
        SESSION,
      ),
    );
    assert.ok(result.error || result.isError);
    assert.match(JSON.stringify(result), /mutually|both `format` and `slotOverrides`/i);
  });

  it("update clears slotOverrides with null", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      makeArgs({
        slug: "clearme",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        slotOverrides: { 1: { answersFormat: { boolean: 0, choice: 1, freeform: 0 } } },
      }),
      SESSION,
    );

    const cleared = parseToolResult(
      await tool.handler(makeArgs({ slug: "clearme", slotOverrides: null }), SESSION),
    );
    assert.equal(cleared.action, "updated");
    assert.equal(cleared.hasSlotOverrides, false);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(state?.seasons[0]?.slotOverrides, undefined);
  });

  it("rejects an invalid per-slot axis bag", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = parseToolResult(
      await tool.handler(
        makeArgs({
          slug: "bad-axis",
          startedAt: future,
          expectedEndAt: future + 30 * DAY,
          // all-zero weight map is invalid (needs ≥1 positive)
          slotOverrides: { 0: { answersFormat: { boolean: 0, choice: 0, freeform: 0 } } },
        }),
        SESSION,
      ),
    );
    assert.ok(result.error || result.isError);
  });
});
