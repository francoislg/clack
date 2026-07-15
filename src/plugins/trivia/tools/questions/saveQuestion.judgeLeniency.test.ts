import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";
import type { TriviaConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

const FREEFORM_ARGS = {
  game: FIXTURE_GAME_NAME,
  answersFormat: "freeform" as const,
  questionType: "fact" as const,
  promptMedium: undefined,
  media: undefined,
  category: "Science",
  statement: "Name the closest planet to the Sun.",
  isTrue: undefined,
  sourceUrl: undefined,
  eventDate: undefined,
  context: undefined,
  choices: undefined,
  correctIndex: undefined,
  expectedAnswer: "Mercury",
  acceptableAnswers: undefined,
  gradingNotes: undefined,
  freeformAnswerShape: "name" as const,
  suggestedDifficulty: undefined,
  difficulty: undefined,
  points: undefined,
  slot: undefined,
  hint: undefined,
  emojis: ["🪐"],
  choiceEmojis: undefined,
};

const BOOLEAN_ARGS = {
  ...FREEFORM_ARGS,
  answersFormat: "boolean" as const,
  isTrue: true,
  expectedAnswer: undefined,
  freeformAnswerShape: undefined,
};

describe("save_question — judgeLeniency stamping", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("stamps the resolved non-default preset on a freeform question", async () => {
    const config: TriviaConfig = { judgeLeniency: "lenient" };
    const tool = createSaveQuestionTool(data, () => config, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(FREEFORM_ARGS, SESSION));
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.judgeLeniency, "lenient");
  });

  it("omits the stamp when the resolved preset is the default (absence reads as strict-with-typos)", async () => {
    const config: TriviaConfig = { judgeLeniency: "strict-with-typos" };
    const tool = createSaveQuestionTool(data, () => config, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(FREEFORM_ARGS, SESSION));
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.judgeLeniency, undefined);
  });

  it("omits the stamp when no tier configures it", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(FREEFORM_ARGS, SESSION));
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.judgeLeniency, undefined);
  });

  it("never stamps a non-freeform question even when a preset is configured", async () => {
    const config: TriviaConfig = { judgeLeniency: "lenient" };
    const tool = createSaveQuestionTool(data, () => config, fixtureGetGames);
    const parsed = parseToolResult(await tool.handler(BOOLEAN_ARGS, SESSION));
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.judgeLeniency, undefined);
  });
});
