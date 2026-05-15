import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer } from "./testHelpers.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import type { Config } from "../../config.js";
import type { TriviaDataLayer } from "./types.js";

const SESSION = { sessionId: "test" };

function makeConfig(trivia?: Config["trivia"]): Config {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    repositories: [],
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "sonnet" },
    trivia,
  };
}

describe("save_question — boolean shape", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
  });

  it("saves a valid boolean question with explicit type", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "boolean",
        category: "Science",
        statement: "Water boils at 100C at sea level",
        isTrue: true,
        choices: undefined,
        correctIndex: undefined,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["💧"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.type, "boolean");
    assert.equal(parsed.question.isTrue, true);
    assert.equal(parsed.question.choices, undefined);
  });

  it("saves boolean when type is omitted (default)", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: undefined,
        category: "Science",
        statement: "Water boils at 100C at sea level",
        isTrue: false,
        choices: undefined,
        correctIndex: undefined,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["💧"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.type, "boolean");
    assert.equal(parsed.question.isTrue, false);
  });

  it("rejects boolean question with choices", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "boolean",
        category: "Science",
        statement: "Statement long enough to validate",
        isTrue: true,
        choices: ["A", "B"],
        correctIndex: undefined,
        suggestedDifficulty: undefined,
        difficulty: undefined,
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
    const tool = createSaveQuestionTool(data, () => makeConfig({ choices: { min: 2, max: 4 } }));
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Which is the smallest planet in our solar system?",
        isTrue: undefined,
        choices: ["Mercury", "Venus", "Earth", "Mars"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🪐"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.type, "choice");
    assert.equal(parsed.question.correctIndex, 0);
    assert.deepEqual(parsed.question.choices, ["Mercury", "Venus", "Earth", "Mars"]);
    assert.equal(parsed.question.isTrue, undefined);
  });

  it("rejects correctIndex out of range (too high)", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick one of four options here",
        isTrue: undefined,
        choices: ["A", "B", "C", "D"],
        correctIndex: 4,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🪐"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /correctIndex \(4\) must be in \[0, 4\)/);
  });

  it("rejects correctIndex below zero", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick one of three options here",
        isTrue: undefined,
        choices: ["A", "B", "C"],
        correctIndex: -1,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🪐"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /correctIndex \(-1\) must be in \[0, 3\)/);
  });

  it("rejects exact duplicate choices", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick the one true thing here",
        isTrue: undefined,
        choices: ["Paris", "London", "Paris", "Rome"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /Choices must be unique/);
  });

  it("rejects whitespace/case-equivalent duplicate choices", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick the one true thing here",
        isTrue: undefined,
        choices: ["Paris", "  PARIS  ", "London", "Rome"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /Choices must be unique/);
  });

  it("rejects choices below configured min", async () => {
    const tool = createSaveQuestionTool(data, () => makeConfig({ choices: { min: 3, max: 4 } }));
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        choices: ["A", "B"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /between 3 and 4 options/);
  });

  it("rejects choices above configured max", async () => {
    const tool = createSaveQuestionTool(data, () => makeConfig({ choices: { min: 2, max: 3 } }));
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        choices: ["A", "B", "C", "D"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /between 2 and 3 options/);
  });

  it("rejects choice question with isTrue", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: true,
        choices: ["A", "B"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /must not include "isTrue"/);
  });

  it("rejects empty choice string", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        choices: ["A", "  ", "C"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /1-100 characters after trim/);
  });

  it("rejects choices longer than 100 chars", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        choices: ["A".repeat(101), "B", "C"],
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /1-100 characters after trim/);
  });

  it("rejects choice question missing choices", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        choices: undefined,
        correctIndex: 0,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /require "choices"/);
  });

  it("rejects choice question missing correctIndex", async () => {
    const tool = createSaveQuestionTool(data, () => null);
    const result = await tool.handler(
      {
        type: "choice",
        category: "Geography",
        statement: "Pick the right option",
        isTrue: undefined,
        choices: ["A", "B"],
        correctIndex: undefined,
        suggestedDifficulty: undefined,
        difficulty: undefined,
        emojis: ["🌍"],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /require "correctIndex"/);
  });
});
