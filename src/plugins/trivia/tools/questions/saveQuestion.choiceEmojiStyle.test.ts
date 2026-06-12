import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";
import type { TriviaConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

const THEMED_EMOJIS = ["🌊", "🧊", "🏝️", "🌋"];

const CHOICE_ARGS = {
  game: FIXTURE_GAME_NAME,
  answersFormat: "choice" as const,
  questionType: "fact" as const,
  promptMedium: undefined,
  media: undefined,
  category: "Geography",
  statement: "Which is the largest ocean?",
  isTrue: undefined,
  sourceUrl: undefined,
  eventDate: undefined,
  context: undefined,
  choices: ["Pacific", "Arctic", "Indian", "Atlantic"],
  correctIndex: 0,
  choiceEmojis: undefined as string[] | undefined,
  expectedAnswer: undefined,
  acceptableAnswers: undefined,
  gradingNotes: undefined,
  freeformAnswerShape: undefined,
  suggestedDifficulty: undefined,
  difficulty: undefined,
  slot: undefined,
  hint: undefined,
  emojis: ["🌍"],
};

describe("save_question — choiceEmojis stamping", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Geography"]);
  });

  it("stamps choiceEmojis when the workspace style is themed", async () => {
    const config: TriviaConfig = { choiceEmojiStyle: "themed" };
    const tool = createSaveQuestionTool(data, () => config, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ ...CHOICE_ARGS, choiceEmojis: THEMED_EMOJIS }, SESSION),
    );
    assert.equal(parsed.saved, true);
    assert.deepEqual(parsed.question.choiceEmojis, THEMED_EMOJIS);
  });

  it("saves without the field when themed but choiceEmojis is omitted", async () => {
    const config: TriviaConfig = { choiceEmojiStyle: "themed" };
    const tool = createSaveQuestionTool(data, () => config, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(CHOICE_ARGS, SESSION));
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.choiceEmojis, undefined);
  });

  it("rejects choiceEmojis when no tier configures the axis (default numbers)", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler({ ...CHOICE_ARGS, choiceEmojis: THEMED_EMOJIS }, SESSION);
    const text = JSON.stringify(result);
    assert.match(text, /only permitted/);
  });

  it("rejects choiceEmojis on a non-choice question (cross-format collision)", async () => {
    const config: TriviaConfig = { choiceEmojiStyle: "themed" };
    const tool = createSaveQuestionTool(data, () => config, fixtureGetGames);
    const result = await tool.handler(
      {
        ...CHOICE_ARGS,
        answersFormat: "boolean" as const,
        isTrue: true,
        choices: undefined,
        correctIndex: undefined,
        choiceEmojis: THEMED_EMOJIS,
      },
      SESSION,
    );
    const text = JSON.stringify(result);
    assert.match(text, /not permitted on boolean questions/);
  });

  it("rejects a mismatched emoji count via the handler validation", async () => {
    const config: TriviaConfig = { choiceEmojiStyle: "themed" };
    const tool = createSaveQuestionTool(data, () => config, fixtureGetGames);
    const result = await tool.handler({ ...CHOICE_ARGS, choiceEmojis: ["🌊", "🧊"] }, SESSION);
    const text = JSON.stringify(result);
    assert.match(text, /one emoji per option/);
  });
});
