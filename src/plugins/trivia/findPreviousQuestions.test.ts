import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "./testHelpers.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import type { TriviaDataLayer } from "./types.js";

const SESSION = { sessionId: "test" };

describe("find_previous_questions response shape", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "q1",
      category: "Science",
      statement: "Water boils at 100 degrees Celsius",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 1,
      postedAt: 1500,
      messageLink: "https://slack.com/archives/C/p1",
    });
    await scoped.saveQuestion({
      id: "q2",
      category: "Science",
      statement: "The Earth is flat",
      isTrue: false,
      emojis: ["🌍"],
      createdAt: 2,
    });
    await scoped.saveQuestion({
      id: "q3",
      category: "History",
      statement: "Rome was founded in 753 BC",
      isTrue: true,
      emojis: ["🏛️"],
      createdAt: 3,
    });
  });

  it("omits isTrue from every returned question (category-only search)", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: "Science",
        text: undefined,
        season: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.count, 2);
    for (const q of parsed.questions) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(q, "isTrue"),
        false,
        `question ${q.id} must not include isTrue`,
      );
    }
  });

  it("omits isTrue from every returned question (text-only search)", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: "boils",
        season: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.count, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "isTrue"), false);
  });

  it("omits isTrue from every returned question (both filters)", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: "Science",
        text: "Earth",
        season: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "q2");
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "isTrue"), false);
  });

  it("returns the search-safe field set", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: "boils",
        season: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    const q = parsed.questions[0];
    assert.deepEqual(Object.keys(q).sort(), [
      "category",
      "createdAt",
      "emojis",
      "id",
      "messageLink",
      "postedAt",
      "statement",
    ]);
  });

  it("omits postedAt and messageLink when not stored", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: "Earth",
        season: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    const q = parsed.questions[0];
    assert.equal(Object.prototype.hasOwnProperty.call(q, "postedAt"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "messageLink"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "isTrue"), false);
  });

  it("returns empty array for no matches without leaking answer keys elsewhere", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: "Science",
        text: "Rome",
        season: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.count, 0);
    assert.deepEqual(parsed.questions, []);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "isTrue"), false);
  });
});

describe("find_previous_questions choice-question shape", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "qc1",
      type: "choice",
      category: "Geography",
      statement: "Which is the smallest planet?",
      choices: ["Mercury", "Venus", "Earth", "Mars"],
      correctIndex: 0,
      emojis: ["🪐"],
      createdAt: 100,
    });
    await scoped.saveQuestion({
      id: "qb1",
      type: "boolean",
      category: "Geography",
      statement: "The Earth is round.",
      isTrue: true,
      emojis: ["🌍"],
      createdAt: 200,
    });
  });

  it("choice rows include type and choices, never correctIndex or isTrue", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: "planet",
        season: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q = parsed.questions[0];
    assert.equal(q.type, "choice");
    assert.deepEqual(q.choices, ["Mercury", "Venus", "Earth", "Mars"]);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "correctIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "isTrue"), false);
  });

  it("boolean rows include type but never choices/correctIndex/isTrue", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: "Earth is round",
        season: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q = parsed.questions[0];
    assert.equal(q.type, "boolean");
    assert.equal(Object.prototype.hasOwnProperty.call(q, "choices"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "correctIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "isTrue"), false);
  });
});
