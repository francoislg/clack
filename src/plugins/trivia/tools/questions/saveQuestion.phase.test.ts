import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";

const SESSION = { sessionId: "test" };
const DAY = 86_400_000;

type SaveArgs = Parameters<ReturnType<typeof createSaveQuestionTool>["handler"]>[0];

function args(overrides: Partial<SaveArgs> = {}): SaveArgs {
  return {
    game: FIXTURE_GAME_NAME,
    answersFormat: "boolean",
    questionType: "fact",
    promptMedium: undefined,
    media: undefined,
    category: "Science",
    statement: "Water boils at 100C at sea level",
    isTrue: true,
    sourceUrl: undefined,
    eventDate: undefined,
    context: undefined,
    choices: undefined,
    correctIndex: undefined,
    expectedAnswer: undefined,
    acceptableAnswers: undefined,
    gradingNotes: undefined,
    freeformAnswerShape: undefined,
    suggestedDifficulty: undefined,
    difficulty: undefined,
    points: undefined,
    slot: undefined,
    hint: undefined,
    emojis: ["💧"],
    choiceEmojis: undefined,
    ...overrides,
  };
}

describe("save_question — phase stamp", () => {
  let data: FakeTriviaDataLayer;
  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;
    await data.saveCategories(["Science"]);
  });

  it("stamps the active phase's slug when a phase is active at write time", async () => {
    const now = Date.now();
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
      seasons: [
        {
          slug: "s1",
          // `ramp` runs its first day; `now` sits half a day in → `ramp` is active.
          startedAt: now - DAY / 2,
          expectedEndAt: now + 20 * DAY,
          phases: [{ slug: "ramp", days: 1 }, { slug: "gauntlet" }],
        },
      ],
    });
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(args(), SESSION));
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.phase, "ramp");
  });

  it("writes no phase key when the current season declares no phases", async () => {
    const now = Date.now();
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
      seasons: [{ slug: "s1", startedAt: now - DAY, expectedEndAt: now + 20 * DAY }],
    });
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(args(), SESSION));
    assert.equal(parsed.saved, true);
    assert.equal("phase" in parsed.question, false);
    assert.equal(parsed.question.phase, undefined);
  });
});
