import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaConfig } from "../../core/configTypes.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };

function makeConfig(trivia?: TriviaConfig): TriviaConfig {
  return trivia ?? {};
}

describe("save_question — boolean shape", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("saves a valid boolean question with explicit answersFormat", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "boolean",
        questionType: "fact",
        category: "Science",
        statement: "Water boils at 100C at sea level",
        isTrue: true,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: undefined,
        correctIndex: undefined,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["💧"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.answersFormat, "boolean");
    assert.equal(parsed.question.isTrue, true);
    assert.equal(parsed.question.choices, undefined);
  });

  it("saves boolean when answersFormat is omitted (default)", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "boolean",
        questionType: "fact",
        category: "Science",
        statement: "Water boils at 100C at sea level",
        isTrue: false,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: undefined,
        correctIndex: undefined,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["💧"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.answersFormat, "boolean");
    assert.equal(parsed.question.isTrue, false);
  });

  it("rejects boolean question with choices", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "boolean",
        questionType: "fact",
        category: "Science",
        statement: "Statement long enough to validate",
        isTrue: true,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["A", "B"],
        correctIndex: undefined,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["💧"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /must not include "choices"/);
  });
});

describe("save_question — choice shape", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Geography"]);
  });

  it("saves a valid 4-choice question", async () => {
    const tool = createSaveQuestionTool(
      data,
      () => makeConfig({ choices: { min: 2, max: 4 } }),
      fixtureGetGames,
    );
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Which is the smallest planet in our solar system?",
        isTrue: undefined,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["Mercury", "Venus", "Earth", "Mars"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🪐"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.answersFormat, "choice");
    assert.equal(parsed.question.correctIndex, 0);
    assert.deepEqual(parsed.question.choices, ["Mercury", "Venus", "Earth", "Mars"]);
    assert.equal(parsed.question.isTrue, undefined);
  });

  it("rejects correctIndex out of range (too high)", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Pick one of four options here",
        isTrue: undefined,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["A", "B", "C", "D"],
        correctIndex: 4,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🪐"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /correctIndex \(4\) must be in \[0, 4\)/);
  });

  it("rejects correctIndex below zero", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Pick one of four options here",
        isTrue: undefined,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["A", "B", "C", "D"],
        correctIndex: -1,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🪐"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /correctIndex \(-1\) must be in \[0, 4\)/);
  });

  it("rejects exact duplicate choices", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Pick the one true thing here",
        isTrue: undefined,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["Paris", "London", "Paris", "Rome"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /Choices must be unique/);
  });

  it("rejects whitespace/case-equivalent duplicate choices", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Pick the one true thing here",
        isTrue: undefined,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["Paris", "  PARIS  ", "London", "Rome"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /Choices must be unique/);
  });

  it("rejects choices below configured min", async () => {
    const tool = createSaveQuestionTool(
      data,
      () => makeConfig({ choices: { min: 3, max: 4 } }),
      fixtureGetGames,
    );
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["A", "B"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /between 3 and 4 options/);
  });

  it("rejects choices above configured max", async () => {
    const tool = createSaveQuestionTool(
      data,
      () => makeConfig({ choices: { min: 2, max: 3 } }),
      fixtureGetGames,
    );
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        choices: ["A", "B", "C", "D"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /between 2 and 3 options/);
  });

  it("rejects choice question with isTrue", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: true,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["A", "B"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /must not include "isTrue"/);
  });

  it("rejects empty choice string", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["A", "  ", "C", "D"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /1-100 characters after trim/);
  });

  it("rejects choices longer than 100 chars", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["A".repeat(101), "B", "C", "D"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /1-100 characters after trim/);
  });

  it("rejects choice question missing choices", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: undefined,
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /require "choices"/);
  });

  it("rejects choice question missing correctIndex", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        answersFormat: "choice",
        questionType: "fact",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        sourceUrl: undefined,
        eventDate: undefined,
        context: undefined,
        expectedAnswer: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
        choices: ["A", "B"],
        correctIndex: undefined,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        slot: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /require "correctIndex"/);
  });
});
