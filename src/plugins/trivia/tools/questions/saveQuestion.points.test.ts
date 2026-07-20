import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  FIXTURE_GAMES,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaGame, TriviaPointsConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

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

const gamesWithPoints = (points: TriviaPointsConfig) => {
  const game: TriviaGame = { ...FIXTURE_GAMES[0], points };
  return () => [game];
};

describe("save_question — points", () => {
  let data: FakeTriviaDataLayer;
  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;
    await data.saveCategories(["Science"]);
  });

  it("stamps a valid pick under the resolved cap", async () => {
    const tool = createSaveQuestionTool(
      data,
      () => null,
      gamesWithPoints({ max: 3, guidance: "hard = 3" }),
    );
    const parsed = parseToolResult(await tool.handler(args({ points: 2 }), SESSION));
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.points, 2);
  });

  it("accepts a pick equal to the cap", async () => {
    const tool = createSaveQuestionTool(
      data,
      () => null,
      gamesWithPoints({ max: 3, guidance: "hard = 3" }),
    );
    const parsed = parseToolResult(await tool.handler(args({ points: 3 }), SESSION));
    assert.equal(parsed.question.points, 3);
  });

  it("normalizes a pick of 1 to absence — 1-point rows match legacy rows on disk", async () => {
    const tool = createSaveQuestionTool(
      data,
      () => null,
      gamesWithPoints({ max: 3, guidance: "hard = 3" }),
    );
    const parsed = parseToolResult(await tool.handler(args({ points: 1 }), SESSION));
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.points, undefined);
  });

  it("omitting points saves nothing — the question is worth 1", async () => {
    const tool = createSaveQuestionTool(
      data,
      () => null,
      gamesWithPoints({ max: 3, guidance: "hard = 3" }),
    );
    const parsed = parseToolResult(await tool.handler(args(), SESSION));
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.points, undefined);
  });

  it("rejects a pick above the resolved cap", async () => {
    const tool = createSaveQuestionTool(
      data,
      () => null,
      gamesWithPoints({ max: 2, guidance: "g" }),
    );
    const parsed = parseToolResult(await tool.handler(args({ points: 3 }), SESSION));
    assert.ok(parsed.error || parsed.isError);
    assert.match(parsed.error ?? "", /\[1, 2\]/);
  });

  it("rejects a pick below 1", async () => {
    const tool = createSaveQuestionTool(
      data,
      () => null,
      gamesWithPoints({ max: 3, guidance: "g" }),
    );
    const parsed = parseToolResult(await tool.handler(args({ points: 0 }), SESSION));
    assert.ok(parsed.error || parsed.isError);
  });

  it("rejects any points when the axis is off (resolved max is 1)", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(args({ points: 2 }), SESSION));
    assert.ok(parsed.error || parsed.isError);
    assert.match(parsed.error ?? "", /not accepted/);
  });

  it("validates against the cap only — a bare cap with no guidance still bounds the pick", async () => {
    const tool = createSaveQuestionTool(data, () => null, gamesWithPoints({ max: 3 }));
    const accepted = parseToolResult(await tool.handler(args({ points: 2 }), SESSION));
    assert.equal(accepted.question.points, 2);

    const rejected = parseToolResult(await tool.handler(args({ points: 4 }), SESSION));
    assert.ok(rejected.error || rejected.isError);
  });
});
