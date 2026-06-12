import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };

type SaveArgs = Parameters<ReturnType<typeof createSaveQuestionTool>["handler"]>[0];

/** Full save_question arg bag, defaulted to a valid boolean prediction; override per case. */
function baseArgs(overrides: Partial<SaveArgs> & { emojis: string[] }): SaveArgs {
  return {
    game: FIXTURE_GAME_NAME,
    answersFormat: "boolean",
    questionType: "prediction",
    category: "Sports",
    statement: "Brazil will win their match tomorrow",
    isTrue: undefined,
    sourceUrl: "https://fifa.com/match/123",
    eventDate: undefined,
    context: undefined,
    expectedAnswer: undefined,
    acceptableAnswers: undefined,
    gradingNotes: undefined,
    freeformAnswerShape: undefined,
    choices: undefined,
    correctIndex: undefined,
    suggestedDifficulty: undefined,
    difficulty: undefined,
    slot: undefined,
    hint: undefined,
    promptMedium: undefined,
    media: undefined,
    choiceEmojis: undefined,
    ...overrides,
  };
}

describe("save_question — prediction (deferred answer)", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Sports"]);
  });

  it("saves a boolean prediction WITHOUT a key, resolved:false, with sourceUrl", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(baseArgs({ answersFormat: "boolean", emojis: ["⚽"] }), SESSION),
    );
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.questionType, "prediction");
    assert.equal(parsed.question.isTrue, undefined);
    assert.equal(parsed.question.resolved, false);
    assert.equal(parsed.question.sourceUrl, "https://fifa.com/match/123");
  });

  it("saves a choice prediction with choices but no correctIndex", async () => {
    const tool = createSaveQuestionTool(
      data,
      () => ({ choices: { min: 2, max: 4 } }),
      fixtureGetGames,
    );
    const parsed = parseToolResult(
      await tool.handler(
        baseArgs({
          answersFormat: "choice",
          statement: "Who wins tomorrow's final?",
          choices: ["Brazil", "Argentina", "Draw"],
          emojis: ["🏆"],
        }),
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.deepEqual(parsed.question.choices, ["Brazil", "Argentina", "Draw"]);
    assert.equal(parsed.question.correctIndex, undefined);
    assert.equal(parsed.question.resolved, false);
  });

  it("rejects a boolean prediction that smuggles in an answer key", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        baseArgs({ answersFormat: "boolean", isTrue: true, emojis: ["⚽"] }),
        SESSION,
      ),
    );
    assert.match(parsed.error, /without an answer key/i);
  });

  it("rejects a prediction with no sourceUrl", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        baseArgs({ answersFormat: "boolean", sourceUrl: undefined, emojis: ["⚽"] }),
        SESSION,
      ),
    );
    assert.match(parsed.error, /sourceUrl/);
  });

  it("saves a freeform prediction with static shape but no expectedAnswer", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        baseArgs({
          answersFormat: "freeform",
          statement: "What will the final score be?",
          freeformAnswerShape: "name",
          emojis: ["⚽"],
        }),
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.freeformAnswerShape, "name");
    assert.equal(parsed.question.expectedAnswer, undefined);
    assert.equal(parsed.question.resolved, false);
  });

  it("still requires a key for non-prediction (fact) boolean questions", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        baseArgs({
          answersFormat: "boolean",
          questionType: "fact",
          sourceUrl: undefined,
          isTrue: undefined,
          emojis: ["⚽"],
        }),
        SESSION,
      ),
    );
    assert.match(parsed.error, /require "isTrue"/);
  });
});
