import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

describe("upsert_season — answersFormat argument", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science", "History"]);
  });

  it("create stores answersFormat verbatim", async () => {
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
        answersFormat: { boolean: 2, choice: 1, freeform: 0 },
        questionType: undefined,
        promptMedium: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
        instructions: undefined,
        additionalInstructions: undefined,
        hint: undefined,
        judgeLeniency: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasAnswersFormat, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "with-types");
    assert.deepEqual(entry?.answersFormat, { boolean: 2, choice: 1, freeform: 0 });
  });

  it("create omits answersFormat when not passed (hasAnswersFormat: false)", async () => {
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
        answersFormat: undefined,
        questionType: undefined,
        promptMedium: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
        instructions: undefined,
        additionalInstructions: undefined,
        hint: undefined,
        judgeLeniency: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.hasAnswersFormat, false);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "no-types");
    assert.equal(entry?.answersFormat, undefined);
  });

  it("update replaces answersFormat on the existing entry", async () => {
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
        questionType: { fact: 1, topical: 1 },
        promptMedium: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
        instructions: undefined,
        additionalInstructions: undefined,
        hint: undefined,
        judgeLeniency: undefined,
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
        answersFormat: { choice: 5 },
        questionType: undefined,
        promptMedium: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
        instructions: undefined,
        additionalInstructions: undefined,
        hint: undefined,
        judgeLeniency: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "updated");
    assert.equal(parsed.hasAnswersFormat, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "to-update");
    assert.deepEqual(entry?.answersFormat, { boolean: 0, choice: 5, freeform: 0 });
  });

  it("update with answersFormat: null clears the field", async () => {
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
        answersFormat: { boolean: 2, choice: 1, freeform: 0 },
        questionType: undefined,
        promptMedium: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
        instructions: undefined,
        additionalInstructions: undefined,
        hint: undefined,
        judgeLeniency: undefined,
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
        answersFormat: null,
        questionType: undefined,
        promptMedium: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
        instructions: undefined,
        additionalInstructions: undefined,
        hint: undefined,
        judgeLeniency: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.hasAnswersFormat, false);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "clear-types");
    assert.equal(entry?.answersFormat, undefined);
  });

  it("update with answersFormat omitted keeps the existing value", async () => {
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
        answersFormat: { boolean: 3, choice: 2, freeform: 0 },
        questionType: undefined,
        promptMedium: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
        instructions: undefined,
        additionalInstructions: undefined,
        hint: undefined,
        judgeLeniency: undefined,
      },
      SESSION,
    );
    // Update only the expectedEndAt; answersFormat is omitted.
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "preserve-types",
        startedAt: undefined,
        expectedEndAt: future + 60 * DAY,
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
        liveAnswersVisible: undefined,
        revealResponses: undefined,
        instructions: undefined,
        additionalInstructions: undefined,
        hint: undefined,
        judgeLeniency: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.hasAnswersFormat, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "preserve-types");
    assert.deepEqual(entry?.answersFormat, { boolean: 3, choice: 2, freeform: 0 });
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
        answersFormat: { boolean: 0, choice: 0 },
        questionType: undefined,
        promptMedium: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
        instructions: undefined,
        additionalInstructions: undefined,
        hint: undefined,
        judgeLeniency: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /at least one strictly positive weight/);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "bad-weights");
    assert.equal(entry, undefined);
  });

  it("mid-season answersFormat mutation is permitted (unlike startedAt)", async () => {
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
          answersFormat: { boolean: 1, choice: 0, freeform: 0 },
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
        answersFormat: { boolean: 0, choice: 5, freeform: 0 },
        questionType: undefined,
        promptMedium: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        theme: undefined,
        format: undefined,
        liveAnswersVisible: undefined,
        revealResponses: undefined,
        instructions: undefined,
        additionalInstructions: undefined,
        hint: undefined,
        judgeLeniency: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "updated");

    const state = await data2.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "active");
    assert.deepEqual(entry?.answersFormat, { boolean: 0, choice: 5, freeform: 0 });
  });
});
