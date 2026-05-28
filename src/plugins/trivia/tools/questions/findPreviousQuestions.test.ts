import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };

describe("find_previous_questions response shape (single game)", () => {
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
        games: [FIXTURE_GAME_NAME],
        categories: ["Science"],
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
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
      assert.equal(q.game, FIXTURE_GAME_NAME);
    }
  });

  it("keywords search returns only matching rows and stamps matchedKeywords", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["boils"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "q1");
    assert.deepEqual(parsed.questions[0].matchedKeywords, ["boils"]);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "isTrue"), false);
  });

  it("default match=all AND's keywords with categories", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["Science"],
        seasons: undefined,
        keywords: ["Earth"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "q2");
    assert.deepEqual(parsed.questions[0].matchedKeywords, ["Earth"]);
  });

  it("returns the search-safe field set including game and matchedKeywords", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["boils"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);

    assert.deepEqual(Object.keys(parsed.questions[0]).sort(), [
      "category",
      "createdAt",
      "emojis",
      "game",
      "id",
      "matchedKeywords",
      "messageLink",
      "postedAt",
      "statement",
    ]);
  });

  it("omits postedAt, messageLink, and matchedKeywords when not applicable", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["Science"],
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q2 = parsed.questions.find((q: { id: string }) => q.id === "q2");
    assert.equal(Object.prototype.hasOwnProperty.call(q2, "postedAt"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q2, "messageLink"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q2, "matchedKeywords"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q2, "isTrue"), false);
  });

  it("returns empty array for no matches", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["Science"],
        seasons: undefined,
        keywords: ["Rome"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 0);
    assert.deepEqual(parsed.questions, []);
  });
});

describe("find_previous_questions per-format response shape", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "qc1",
      answersFormat: "choice",
      category: "Geography",
      statement: "Which is the smallest planet?",
      choices: ["Mercury", "Venus", "Earth", "Mars"],
      correctIndex: 0,
      emojis: ["🪐"],
      createdAt: 100,
    });
    await scoped.saveQuestion({
      id: "qb1",
      answersFormat: "boolean",
      category: "Geography",
      statement: "The Earth is round.",
      isTrue: true,
      emojis: ["🌍"],
      createdAt: 200,
    });
  });

  it("choice rows include answersFormat and choices, never correctIndex or isTrue", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["planet"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q = parsed.questions[0];
    assert.equal(q.answersFormat, "choice");
    assert.deepEqual(q.choices, ["Mercury", "Venus", "Earth", "Mars"]);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "correctIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "isTrue"), false);
    assert.equal(q.game, FIXTURE_GAME_NAME);
  });

  it("boolean rows include answersFormat but never choices/correctIndex/isTrue", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["Earth is round"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q = parsed.questions[0];
    assert.equal(q.answersFormat, "boolean");
    assert.equal(Object.prototype.hasOwnProperty.call(q, "choices"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "correctIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "isTrue"), false);
  });

  it("freeform rows never carry expectedAnswer/acceptableAnswers/gradingNotes", async () => {
    const local = createInMemoryDataLayer();
    const scoped = local.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "qf1",
      answersFormat: "freeform",
      category: "Geography",
      statement: "What is the capital of France?",
      expectedAnswer: "Paris",
      acceptableAnswers: ["Paris, France"],
      gradingNotes: "Accept any English-language form.",
      emojis: ["🗺️"],
      createdAt: 1,
    });
    const tool = createFindPreviousQuestionsTool(local, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["france"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q = parsed.questions[0];
    assert.equal(q.answersFormat, "freeform");
    assert.equal(Object.prototype.hasOwnProperty.call(q, "expectedAnswer"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "acceptableAnswers"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "gradingNotes"), false);
    assert.deepEqual(q.matchedKeywords, ["france"]);
  });

  it("surfaces processedAt, season, slot, suggestedDifficulty, and difficulty when set", async () => {
    const local = createInMemoryDataLayer();
    const scoped = local.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "qx",
      answersFormat: "boolean",
      category: "Science",
      statement: "Water is wet.",
      isTrue: true,
      emojis: ["💧"],
      createdAt: 10,
      postedAt: 20,
      messageLink: "https://slack.com/archives/C/p20",
      processedAt: 30,
      season: "season-2026-05",
      slot: { index: 1, label: "Mid" },
      suggestedDifficulty: "Medium",
      difficulty: 5,
    });

    const tool = createFindPreviousQuestionsTool(local, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: ["wet"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const q = parsed.questions[0];
    assert.equal(q.processedAt, 30);
    assert.equal(q.season, "season-2026-05");
    assert.deepEqual(q.slot, { index: 1, label: "Mid" });
    assert.equal(q.suggestedDifficulty, "Medium");
    assert.equal(q.difficulty, 5);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "isTrue"), false);
  });
});
