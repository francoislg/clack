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
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaConfig, TriviaGame } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

const CHOICE_ARGS = {
  game: FIXTURE_GAME_NAME,
  answersFormat: "choice" as const,
  questionType: "fact" as const,
  promptMedium: undefined,
  media: undefined,
  category: "Science",
  statement: "Which planet is closest to the Sun?",
  isTrue: undefined,
  sourceUrl: undefined,
  eventDate: undefined,
  context: undefined,
  choices: ["Mercury", "Venus", "Earth", "Mars"],
  correctIndex: 0,
  expectedAnswer: undefined,
  acceptableAnswers: undefined,
  gradingNotes: undefined,
  freeformAnswerShape: undefined,
  suggestedDifficulty: undefined,
  difficulty: undefined,
  points: undefined,
  slot: undefined,
  hint: undefined,
  emojis: ["🪐"],
  choiceEmojis: undefined,
};

const gamesWithChoices = (choices: { min: number; max: number }) => {
  const game: TriviaGame = { ...FIXTURE_GAMES[0], choices };
  return () => [game];
};

describe("save_question — choice bounds resolve through the cascade", () => {
  let data: FakeTriviaDataLayer;
  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;
    await data.saveCategories(["Science"]);
  });

  it("accepts 4 choices under the built-in default { min: 4, max: 4 }", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(CHOICE_ARGS, SESSION));
    assert.equal(parsed.saved, true);
    assert.deepEqual(parsed.question.choices, ["Mercury", "Venus", "Earth", "Mars"]);
  });

  it("rejects 4 choices when the game tier narrows bounds to { min: 2, max: 2 }", async () => {
    const tool = createSaveQuestionTool(data, () => null, gamesWithChoices({ min: 2, max: 2 }));
    const parsed = parseToolResult(await tool.handler(CHOICE_ARGS, SESSION));
    assert.ok(parsed.error || parsed.isError, "expected a bounds error");
  });

  it("accepts 2 choices when the game tier narrows bounds to { min: 2, max: 2 }", async () => {
    const tool = createSaveQuestionTool(data, () => null, gamesWithChoices({ min: 2, max: 2 }));
    const parsed = parseToolResult(
      await tool.handler(
        { ...CHOICE_ARGS, choices: ["Mercury", "Venus"], correctIndex: 0 },
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.deepEqual(parsed.question.choices, ["Mercury", "Venus"]);
  });

  it("uses the workspace tier when no game-tier override is set", async () => {
    const config: TriviaConfig = { choices: { min: 2, max: 3 } };
    const tool = createSaveQuestionTool(data, () => config, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(CHOICE_ARGS, SESSION));
    assert.ok(parsed.error || parsed.isError, "4 choices exceeds workspace max 3");
  });
});
