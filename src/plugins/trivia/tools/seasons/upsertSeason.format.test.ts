import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

describe("upsert_season — format argument", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History", "Geography"]);
  });

  it("create stores format verbatim and returns hasFormat: true", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "with-format",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: {
          questions: [
            { label: "Q1" },
            { label: "Q2", categories: ["History"], answersFormat: { choice: 1 } },
          ],
        },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasFormat, true);
    assert.equal(parsed.slotCount, 2);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "with-format");
    assert.equal(entry?.format?.questions.length, 2);
    assert.equal(entry?.format?.questions[0].label, "Q1");
    assert.deepEqual(entry?.format?.questions[1].categories, ["History"]);
    assert.deepEqual(entry?.format?.questions[1].answersFormat, {
      boolean: 0,
      choice: 1,
      freeform: 0,
    });
  });

  it("create omits format when not passed (hasFormat: false, slotCount: 0)", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "no-format",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.hasFormat, false);
    assert.equal(parsed.slotCount, 0);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "no-format");
    assert.equal(entry?.format, undefined);
  });

  it("update replaces format wholesale", async () => {
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
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: { questions: [{ label: "old" }] },
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
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: { questions: [{ label: "new-1" }, { label: "new-2" }] },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "updated");
    assert.equal(parsed.slotCount, 2);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "to-update");
    assert.equal(entry?.format?.questions.length, 2);
    assert.equal(entry?.format?.questions[0].label, "new-1");
  });

  it("update with format: null clears the field", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "clear-format",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: { questions: [{ label: "to-remove" }] },
      },
      SESSION,
    );
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "clear-format",
        startedAt: undefined,
        expectedEndAt: undefined,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: null,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.hasFormat, false);
    assert.equal(parsed.slotCount, 0);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "clear-format");
    assert.equal(entry?.format, undefined);
  });

  it("update with format omitted keeps the existing value", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "preserve-format",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: { questions: [{ label: "keep-me" }] },
      },
      SESSION,
    );
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "preserve-format",
        startedAt: undefined,
        expectedEndAt: future + 60 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.hasFormat, true);
    assert.equal(parsed.slotCount, 1);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "preserve-format");
    assert.equal(entry?.format?.questions[0].label, "keep-me");
  });

  it("rejects empty format.questions", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "empty-fmt",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: { questions: [] },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /non-empty/);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "empty-fmt");
    assert.equal(entry, undefined);
  });

  it("rejects invalid slot questionTypes", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "bad-slot",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: { questions: [{ questionType: { fact: 0, topical: 0 } }] },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /positive weight/);
  });

  it("mid-season format mutation is permitted (unlike startedAt)", async () => {
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
        },
      ],
    });

    const tool = createUpsertSeasonTool(data2, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "active",
        startedAt: undefined,
        expectedEndAt: undefined,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        answerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        theme: undefined,
        format: { questions: [{ label: "added-mid-season" }] },
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "updated");
    assert.equal(parsed.hasFormat, true);

    const state = await data2.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "active");
    assert.equal(entry?.format?.questions[0].label, "added-mid-season");
  });
});
