import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

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
        recentBatchFromNow: undefined,
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
        recentBatchFromNow: undefined,
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
        recentBatchFromNow: undefined,
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
        recentBatchFromNow: undefined,
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
        recentBatchFromNow: undefined,
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
        recentBatchFromNow: undefined,
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

  it("surfaces processedAt, season, slot, suggestedDifficulty, and difficulty when set", async () => {
    const local = createInMemoryDataLayer();
    const scoped = local.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "qx",
      type: "boolean",
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
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: "wet",
        season: undefined,
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

  it("boolean rows include type but never choices/correctIndex/isTrue", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: "Earth is round",
        season: undefined,
        recentBatchFromNow: undefined,
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

describe("find_previous_questions recentBatchFromNow", () => {
  // Three batches at distinct postedAt windows; within each batch, the items are
  // separated by a few ms (mirroring how post_questions stamps them in sequence).
  // T1 (oldest) = batch-A, T2 = batch-B, T3 (newest) = batch-C.
  async function seedThreeBatches(scoped: ReturnType<TriviaDataLayer["forGame"]>) {
    // batch-A: 2 questions, both category "X"
    await scoped.saveQuestion({
      id: "a1",
      category: "X",
      statement: "A1 statement (ten or more chars)",
      isTrue: true,
      emojis: ["🅰️"],
      createdAt: 1,
      postedAt: 1000,
      batchId: "batch-A",
    });
    await scoped.saveQuestion({
      id: "a2",
      category: "X",
      statement: "A2 statement (ten or more chars)",
      isTrue: false,
      emojis: ["🅰️"],
      createdAt: 2,
      postedAt: 1001,
      batchId: "batch-A",
    });
    // batch-B: 2 questions, both category "Y"
    await scoped.saveQuestion({
      id: "b1",
      category: "Y",
      statement: "B1 statement (ten or more chars)",
      isTrue: true,
      emojis: ["🅱️"],
      createdAt: 3,
      postedAt: 2000,
      batchId: "batch-B",
    });
    await scoped.saveQuestion({
      id: "b2",
      category: "Y",
      statement: "B2 statement (ten or more chars)",
      isTrue: false,
      emojis: ["🅱️"],
      createdAt: 4,
      postedAt: 2001,
      batchId: "batch-B",
    });
    // batch-C: 3 questions, mixed categories X + Y
    await scoped.saveQuestion({
      id: "c1",
      category: "X",
      statement: "C1 statement (ten or more chars)",
      isTrue: true,
      emojis: ["🅲"],
      createdAt: 5,
      postedAt: 3000,
      batchId: "batch-C",
    });
    await scoped.saveQuestion({
      id: "c2",
      category: "Y",
      statement: "C2 statement (ten or more chars)",
      isTrue: false,
      emojis: ["🅲"],
      createdAt: 6,
      postedAt: 3001,
      batchId: "batch-C",
    });
    await scoped.saveQuestion({
      id: "c3",
      category: "Y",
      statement: "C3 statement (ten or more chars)",
      isTrue: true,
      emojis: ["🅲"],
      createdAt: 7,
      postedAt: 3002,
      batchId: "batch-C",
    });
  }

  it("recentBatchFromNow=1 returns every question in the most recent batch, ordered by postedAt asc", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame(FIXTURE_GAME_NAME));
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: undefined,
        season: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 3);
    assert.deepEqual(
      parsed.questions.map((q: { id: string }) => q.id),
      ["c1", "c2", "c3"],
    );
  });

  it("recentBatchFromNow=2 returns the second-most-recent batch", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame(FIXTURE_GAME_NAME));
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: undefined,
        season: undefined,
        recentBatchFromNow: 2,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.deepEqual(
      parsed.questions.map((q: { id: string }) => q.id),
      ["b1", "b2"],
    );
  });

  it("recentBatchFromNow alone is a valid search (no other filters needed)", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame(FIXTURE_GAME_NAME));
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: undefined,
        season: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 3);
  });

  it("recentBatchFromNow exceeding available batches returns an empty result, not an error", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame(FIXTURE_GAME_NAME));
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: undefined,
        season: undefined,
        recentBatchFromNow: 99,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 0);
    assert.deepEqual(parsed.questions, []);
  });

  it("legacy rows without batchId are excluded from the recent-batch view", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Older batched question
    await scoped.saveQuestion({
      id: "batched",
      category: "X",
      statement: "Batched statement long enough",
      isTrue: true,
      emojis: ["🅰️"],
      createdAt: 1,
      postedAt: 1000,
      batchId: "batch-A",
    });
    // Newer legacy posted row (no batchId) — must not appear
    await scoped.saveQuestion({
      id: "legacy",
      category: "X",
      statement: "Legacy statement long enough",
      isTrue: true,
      emojis: ["⚠️"],
      createdAt: 2,
      postedAt: 5000,
    });
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: undefined,
        season: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "batched");
  });

  it("filters compose with recentBatchFromNow before grouping (latest batch still has Y matches)", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame(FIXTURE_GAME_NAME));
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: "Y",
        text: undefined,
        season: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    // batch-C is still the most recent batch that has Y matches (c2 + c3).
    assert.deepEqual(
      parsed.questions.map((q: { id: string }) => q.id),
      ["c2", "c3"],
    );
  });

  it("filters can eliminate a batch from the ranking", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Newest batch contains only category X
    await scoped.saveQuestion({
      id: "newx1",
      category: "X",
      statement: "Newest X1 statement long enough",
      isTrue: true,
      emojis: ["🆕"],
      createdAt: 10,
      postedAt: 5000,
      batchId: "newest",
    });
    await scoped.saveQuestion({
      id: "newx2",
      category: "X",
      statement: "Newest X2 statement long enough",
      isTrue: false,
      emojis: ["🆕"],
      createdAt: 11,
      postedAt: 5001,
      batchId: "newest",
    });
    // Older batch contains category Y
    await scoped.saveQuestion({
      id: "oldy1",
      category: "Y",
      statement: "Older Y1 statement long enough",
      isTrue: true,
      emojis: ["📜"],
      createdAt: 1,
      postedAt: 1000,
      batchId: "older",
    });

    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: "Y",
        text: undefined,
        season: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    // "newest" was filtered out by the category constraint; "older" wins.
    assert.deepEqual(
      parsed.questions.map((q: { id: string }) => q.id),
      ["oldy1"],
    );
  });

  it("recentBatchFromNow=0 is rejected by the schema", () => {
    const tool = createFindPreviousQuestionsTool(createInMemoryDataLayer(), fixtureGetGames);
    const parsed = z.object(tool.inputSchema).safeParse({
      game: FIXTURE_GAME_NAME,
      recentBatchFromNow: 0,
    });
    assert.equal(parsed.success, false);
  });

  it("negative recentBatchFromNow is rejected by the schema", () => {
    const tool = createFindPreviousQuestionsTool(createInMemoryDataLayer(), fixtureGetGames);
    const parsed = z.object(tool.inputSchema).safeParse({
      game: FIXTURE_GAME_NAME,
      recentBatchFromNow: -1,
    });
    assert.equal(parsed.success, false);
  });

  it("limit caps the per-batch result (oldest-by-postedAt kept)", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    for (let i = 0; i < 5; i++) {
      await scoped.saveQuestion({
        id: `big-${i}`,
        category: "X",
        statement: `Big batch item ${i} long enough`,
        isTrue: true,
        emojis: ["📦"],
        createdAt: 100 + i,
        postedAt: 9000 + i,
        batchId: "big-batch",
      });
    }
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        category: undefined,
        text: undefined,
        season: undefined,
        recentBatchFromNow: 1,
        limit: 2,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 2);
    assert.deepEqual(
      parsed.questions.map((q: { id: string }) => q.id),
      ["big-0", "big-1"],
    );
    assert.equal(parsed.total, 5);
  });
});
