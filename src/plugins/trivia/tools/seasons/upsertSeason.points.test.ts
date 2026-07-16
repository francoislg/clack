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
    teams: undefined,
    teamsEnabled: undefined,
    teamsFinaleIndividuals: undefined,
    teamsScoring: undefined,
    ...overrides,
  };
}

describe("upsert_season — points argument", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("create stores season-tier points verbatim", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const parsed = parseToolResult(
      await tool.handler(
        makeArgs({
          slug: "stakes",
          startedAt: future,
          expectedEndAt: future + 30 * DAY,
          points: { max: 3, guidance: "hard = 3" },
        }),
        SESSION,
      ),
    );
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasPoints, true);
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.deepEqual(state?.seasons.find((s) => s.slug === "stakes")?.points, {
      max: 3,
      guidance: "hard = 3",
    });
  });

  it("create stores a bare cap — an allowance for admin reclassing", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      makeArgs({
        slug: "allowance",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        points: { max: 2 },
      }),
      SESSION,
    );
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.deepEqual(state?.seasons.find((s) => s.slug === "allowance")?.points, { max: 2 });
  });

  it("create rejects an out-of-range cap", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const parsed = parseToolResult(
      await tool.handler(
        makeArgs({
          slug: "bad",
          startedAt: future,
          expectedEndAt: future + 30 * DAY,
          points: { max: 0 },
        }),
        SESSION,
      ),
    );
    assert.ok(parsed.error || parsed.isError);
  });

  it("create stores per-slot points via format", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      makeArgs({
        slug: "paced",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        format: { questions: [{}, { points: { max: 5, guidance: "finale" } }] },
      }),
      SESSION,
    );
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "paced");
    assert.equal(entry?.format?.questions[0].points, undefined);
    assert.deepEqual(entry?.format?.questions[1].points, { max: 5, guidance: "finale" });
  });

  it("create stores per-slot points via slotOverrides", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      makeArgs({
        slug: "overridden",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        slotOverrides: { 1: { points: { max: 4 } } },
      }),
      SESSION,
    );
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "overridden");
    assert.deepEqual(entry?.slotOverrides?.[1]?.points, { max: 4 });
  });

  it("update replaces points wholesale, then clears it with null", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      makeArgs({
        slug: "s1",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        points: { max: 2, guidance: "old rule" },
      }),
      SESSION,
    );

    await tool.handler(makeArgs({ slug: "s1", points: { max: 4 } }), SESSION);
    const afterUpdate = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.deepEqual(
      afterUpdate?.seasons.find((s) => s.slug === "s1")?.points,
      { max: 4 },
      "whole-object replace — the old guidance does not survive",
    );

    const cleared = parseToolResult(
      await tool.handler(makeArgs({ slug: "s1", points: null }), SESSION),
    );
    assert.equal(cleared.hasPoints, false);
    const afterClear = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.equal(afterClear?.seasons.find((s) => s.slug === "s1")?.points, undefined);
  });

  it("update rejects an invalid cap and writes nothing", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      makeArgs({
        slug: "s1",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        points: { max: 2 },
      }),
      SESSION,
    );

    const parsed = parseToolResult(
      await tool.handler(makeArgs({ slug: "s1", points: { max: 11 } }), SESSION),
    );
    assert.ok(parsed.error || parsed.isError);
    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    assert.deepEqual(state?.seasons.find((s) => s.slug === "s1")?.points, { max: 2 });
  });
});
