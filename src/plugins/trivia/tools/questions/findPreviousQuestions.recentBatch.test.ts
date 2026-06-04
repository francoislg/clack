import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  createInMemoryDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  multiFixtureGetGames,
} from "../../testHelpers.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer } from "../../core/types.js";

const SESSION = { sessionId: "test" };

// Three batches at distinct postedAt windows; within each batch, the items are
// separated by a few ms (mirroring how post_questions stamps them in sequence).
// T1 (oldest) = batch-A, T2 = batch-B, T3 (newest) = batch-C.
async function seedThreeBatches(scoped: ReturnType<TriviaDataLayer["forGame"]>) {
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

function extractText(result: { content?: ReadonlyArray<{ type: string }> }): string {
  const block = result.content?.[0];
  if (block && "text" in block && typeof (block as { text: unknown }).text === "string") {
    return (block as { text: string }).text;
  }
  return "";
}

describe("find_previous_questions recentBatchFromNow", () => {
  it("recentBatchFromNow=1 returns every question in the most recent batch, ordered by postedAt asc, stamped with game", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame(FIXTURE_GAME_NAME));
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 3);
    assert.deepEqual(
      parsed.questions.map((q: { id: string }) => q.id),
      ["c1", "c2", "c3"],
    );
    for (const q of parsed.questions) assert.equal(q.game, FIXTURE_GAME_NAME);
  });

  it("recentBatchFromNow=2 returns the second-most-recent batch", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame(FIXTURE_GAME_NAME));
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: 2,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.deepEqual(
      parsed.questions.map((q: { id: string }) => q.id),
      ["b1", "b2"],
    );
    for (const q of parsed.questions) assert.equal(q.game, FIXTURE_GAME_NAME);
  });

  it("recentBatchFromNow without games is rejected", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame(FIXTURE_GAME_NAME));
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: undefined,
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    assert.match(extractText(result), /recentBatchFromNow requires exactly one game/);
  });

  it("recentBatchFromNow with multiple games is rejected", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame("main"));
    await seedThreeBatches(data.forGame("sandbox"));
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: ["main", "sandbox"],
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    assert.match(extractText(result), /recentBatchFromNow requires exactly one game/);
  });

  it("recentBatchFromNow exceeding available batches returns an empty result, not an error", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame(FIXTURE_GAME_NAME));
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: 99,
        limit: undefined,
        includeRevealBlocks: undefined,
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
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "batched");
    assert.equal(parsed.questions[0].game, FIXTURE_GAME_NAME);
  });

  it("filters compose with recentBatchFromNow before grouping (latest batch still has Y matches)", async () => {
    const data = createInMemoryDataLayer();
    await seedThreeBatches(data.forGame(FIXTURE_GAME_NAME));
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["Y"],
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.deepEqual(
      parsed.questions.map((q: { id: string }) => q.id),
      ["c2", "c3"],
    );
    for (const q of parsed.questions) assert.equal(q.game, FIXTURE_GAME_NAME);
  });

  it("filters can eliminate a batch from the ranking", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
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
        games: [FIXTURE_GAME_NAME],
        categories: ["Y"],
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: 1,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.deepEqual(
      parsed.questions.map((q: { id: string }) => q.id),
      ["oldy1"],
    );
    for (const q of parsed.questions) assert.equal(q.game, FIXTURE_GAME_NAME);
  });

  it("recentBatchFromNow=0 is rejected by the schema", () => {
    const tool = createFindPreviousQuestionsTool(createInMemoryDataLayer(), fixtureGetGames);
    const parsed = z.object(tool.inputSchema).safeParse({
      games: [FIXTURE_GAME_NAME],
      recentBatchFromNow: 0,
    });
    assert.equal(parsed.success, false);
  });

  it("negative recentBatchFromNow is rejected by the schema", () => {
    const tool = createFindPreviousQuestionsTool(createInMemoryDataLayer(), fixtureGetGames);
    const parsed = z.object(tool.inputSchema).safeParse({
      games: [FIXTURE_GAME_NAME],
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
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: 1,
        limit: 2,
        includeRevealBlocks: undefined,
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
