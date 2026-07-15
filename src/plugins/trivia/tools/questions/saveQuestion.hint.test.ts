import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };

const BASE_ARGS = {
  game: FIXTURE_GAME_NAME,
  answersFormat: "boolean" as const,
  questionType: "fact" as const,
  promptMedium: undefined,
  media: undefined,
  category: "Science",
  statement: "Water boils at 100 C at sea level.",
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
  emojis: ["💧"],
  choiceEmojis: undefined,
};

describe("save_question — hint persistence", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("persists a valid button hint without clickedBy", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        { ...BASE_ARGS, hint: { mode: "button", text: "Think about a primary color." } },
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.deepEqual(parsed.question.hint, {
      mode: "button",
      text: "Think about a primary color.",
    });
  });

  it("persists a valid inline hint", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        { ...BASE_ARGS, hint: { mode: "inline", text: "A kind of fruit" } },
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.deepEqual(parsed.question.hint, { mode: "inline", text: "A kind of fruit" });
  });

  it("trims hint text on save", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        { ...BASE_ARGS, hint: { mode: "button", text: "   trimmed   " } },
        SESSION,
      ),
    );
    assert.equal(parsed.question.hint.text, "trimmed");
  });

  it("rejects blank-after-trim text", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ ...BASE_ARGS, hint: { mode: "button", text: "   " } }, SESSION),
    );
    assert.match(parsed.error, /non-empty after trim/);
  });

  it("rejects text over 140 chars", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const longText = "x".repeat(200);
    const parsed = parseToolResult(
      await tool.handler({ ...BASE_ARGS, hint: { mode: "button", text: longText } }, SESSION),
    );
    assert.match(parsed.error, /140 characters/);
  });

  it("persists no hint field when omitted", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler({ ...BASE_ARGS, hint: undefined }, SESSION));
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.hint, undefined);
  });

  it("clickedBy is absent on freshly-saved record", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ ...BASE_ARGS, hint: { mode: "button", text: "A nudge." } }, SESSION),
    );
    assert.equal(parsed.question.hint.clickedBy, undefined);
  });
});
