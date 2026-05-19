import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "./testHelpers.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import type { TriviaDataLayer } from "./types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

describe("upsert_season — questionTypes argument", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History"]);
  });

  it("create stores questionTypes verbatim", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "with-types",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        questionTypes: { boolean: 2, choice: 1 },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasQuestionTypes, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "with-types");
    assert.deepEqual(entry?.questionTypes, { boolean: 2, choice: 1 });
  });

  it("create omits questionTypes when not passed (hasQuestionTypes: false)", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "no-types",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        questionTypes: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.hasQuestionTypes, false);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "no-types");
    assert.equal(entry?.questionTypes, undefined);
  });

  it("update replaces questionTypes on the existing entry", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "to-update",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        questionTypes: { boolean: 1, choice: 1 },
      },
      SESSION,
    );
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "to-update",
        startedAt: undefined,
        expectedEndAt: undefined,
        endedAt: undefined,
        categories: undefined,
        questionTypes: { choice: 5 },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "updated");
    assert.equal(parsed.hasQuestionTypes, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "to-update");
    assert.deepEqual(entry?.questionTypes, { boolean: 0, choice: 5 });
  });

  it("update with questionTypes: null clears the field", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "clear-types",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        questionTypes: { boolean: 2, choice: 1 },
      },
      SESSION,
    );
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "clear-types",
        startedAt: undefined,
        expectedEndAt: undefined,
        endedAt: undefined,
        categories: undefined,
        questionTypes: null,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.hasQuestionTypes, false);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "clear-types");
    assert.equal(entry?.questionTypes, undefined);
  });

  it("update with questionTypes omitted keeps the existing value", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "preserve-types",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        questionTypes: { boolean: 3, choice: 2 },
      },
      SESSION,
    );
    // Update only the expectedEndAt; questionTypes is omitted.
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "preserve-types",
        startedAt: undefined,
        expectedEndAt: future + 60 * DAY,
        endedAt: undefined,
        categories: undefined,
        questionTypes: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.hasQuestionTypes, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "preserve-types");
    assert.deepEqual(entry?.questionTypes, { boolean: 3, choice: 2 });
  });

  it("rejects all-zero weight map", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "bad-weights",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        questionTypes: { boolean: 0, choice: 0 },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /at least one strictly positive weight/);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "bad-weights");
    assert.equal(entry, undefined);
  });

  it("mid-season questionTypes mutation is permitted (unlike startedAt)", async () => {
    // Create a season that is already active (startedAt in the past)
    const start = Date.now() - 10 * DAY;
    const end = Date.now() + 20 * DAY;
    const data2 = createInMemoryDataLayer();
    await data2.saveCategories(["Science"]);
    await data2.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
      seasons: [
        {
          slug: "active",
          startedAt: start,
          expectedEndAt: end,
          categories: ["Science"],
          questionTypes: { boolean: 1, choice: 0 },
        },
      ],
    });

    const t2 = createUpsertSeasonTool(data2, fixtureGetGames);
    const result = await t2.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "active",
        startedAt: undefined,
        expectedEndAt: undefined,
        endedAt: undefined,
        categories: undefined,
        questionTypes: { boolean: 0, choice: 5 },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "updated");

    const state = await data2.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "active");
    assert.deepEqual(entry?.questionTypes, { boolean: 0, choice: 5 });
  });
});
