/**
 * Regressions tied to the unification of axis zod schemas across upsert_game,
 * upsert_season, and set_workspace_config. Before unification:
 *
 *   1. `freeformAnswerShape` zod still listed `number` instead of `countable`
 *      (the type was renamed in commit ef53bab). The tool path could neither
 *      accept the new key nor write it — passing `countable` was rejected by
 *      zod, passing `number` slipped past zod but was dropped by the validator.
 *
 *   2. The `answersFormat` sparse builder enumerated `boolean` and `choice` but
 *      forgot `freeform`, so `freeform` weights silently never reached storage.
 *
 * Both bugs disappear by construction when the tool imports the shared zod
 * schemas + a generic `compactNumberMap` instead of hand-listing keys. These
 * tests are the safety net to keep them from regressing.
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createUpsertSeasonTool } from "./upsertSeason.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";

const SESSION = { sessionId: "test" };
const DAY = 24 * 60 * 60 * 1000;

describe("upsert_season — schema unification regressions", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const result = createTriviaDataLayer(sdk);
    data = result.dataLayer;
    await data.saveCategories(["Science", "History"]);
  });

  it("accepts and persists freeformAnswerShape.countable (post-rename key)", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "countable-shape",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: undefined,
        questionType: undefined,
        promptMedium: undefined,
        freeformAnswerShape: { name: 1, countable: 3, other: 0 },
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
        answeringType: undefined,
        perfectRoundsAward: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasFreeformAnswerShape, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "countable-shape");
    assert.equal(entry?.freeformAnswerShape?.countable, 3);
    assert.equal(entry?.freeformAnswerShape?.name, 1);
    // Unspecified keys normalize to 0 (per validateFreeformAnswerShapeMap).
    assert.equal(entry?.freeformAnswerShape?.date, 0);
  });

  it("persists answersFormat.freeform weight (was previously dropped by the sparse builder)", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "freeform-heavy",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: { boolean: 0, choice: 1, freeform: 5 },
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
        answeringType: undefined,
        perfectRoundsAward: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.action, "created");
    assert.equal(parsed.hasAnswersFormat, true);

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "freeform-heavy");
    assert.deepEqual(entry?.answersFormat, { boolean: 0, choice: 1, freeform: 5 });
  });

  it("update path persists answersFormat.freeform on an existing season", async () => {
    const tool = createUpsertSeasonTool(data, fixtureGetGames);
    const future = Date.now() + 30 * DAY;
    // First create with a different distribution.
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "shift-to-freeform",
        startedAt: future,
        expectedEndAt: future + 30 * DAY,
        endedAt: undefined,
        categories: undefined,
        answersFormat: { boolean: 1, choice: 1, freeform: 0 },
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
        answeringType: undefined,
        perfectRoundsAward: undefined,
      },
      SESSION,
    );
    // Then update to a freeform-only distribution.
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        slug: "shift-to-freeform",
        startedAt: undefined,
        expectedEndAt: undefined,
        endedAt: undefined,
        categories: undefined,
        answersFormat: { boolean: 0, choice: 0, freeform: 3 },
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
        answeringType: undefined,
        perfectRoundsAward: undefined,
      },
      SESSION,
    );

    const state = await data.forGame(FIXTURE_GAME_NAME).loadSeasonsState();
    const entry = state?.seasons.find((s) => s.slug === "shift-to-freeform");
    assert.deepEqual(entry?.answersFormat, { boolean: 0, choice: 0, freeform: 3 });
  });
});
