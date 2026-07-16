import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  multiFixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";

const SESSION = { sessionId: "test" };

describe("find_previous_questions cross-game and array semantics", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;

    const m1 = {
      id: "m1",
      category: "Music",
      statement: "Mozart composed The Magic Flute in 1791.",
      isTrue: true,
      emojis: ["🎼"],
      createdAt: 100,
    };
    const m2 = {
      id: "m2",
      category: "Geography",
      statement: "Mount Everest is the tallest mountain.",
      isTrue: true,
      emojis: ["⛰️"],
      createdAt: 200,
    };
    const s1 = {
      id: "s1",
      category: "Music",
      statement: "Beethoven wrote nine symphonies.",
      isTrue: true,
      emojis: ["🎻"],
      createdAt: 300,
    };
    const s2 = {
      id: "s2",
      category: "Science",
      statement: "Mozart was a famous chemist.",
      isTrue: false,
      emojis: ["⚗️"],
      createdAt: 400,
    };
    const r1 = {
      id: "r1",
      category: "History",
      statement: "Mozart died in 1791 in Vienna.",
      isTrue: true,
      emojis: ["🕰️"],
      createdAt: 500,
    };

    data.forGame("main").loadQuestions.mockResolvedValue([m1, m2]);
    data.forGame("sandbox").loadQuestions.mockResolvedValue([s1, s2]);
    data.forGame("retired").loadQuestions.mockResolvedValue([r1]);
  });

  it("omitted games scans every registered game (including disabled — frozen archive)", async () => {
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: undefined,
        categories: undefined,
        seasons: undefined,
        keywords: ["mozart"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const idsByGame = new Map<string, string[]>();
    for (const q of parsed.questions) {
      const bucket = idsByGame.get(q.game) ?? [];
      bucket.push(q.id);
      idsByGame.set(q.game, bucket);
    }
    assert.deepEqual(idsByGame.get("main"), ["m1"]);
    assert.deepEqual(idsByGame.get("sandbox"), ["s2"]);
    assert.deepEqual(idsByGame.get("retired"), ["r1"]);
  });

  it('single-game scoping via games: ["main"] excludes other games', async () => {
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: ["main"],
        categories: undefined,
        seasons: undefined,
        keywords: ["mozart"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "m1");
    assert.equal(parsed.questions[0].game, "main");
  });

  it("multi-game scoping returns rows only from listed games", async () => {
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: ["main", "sandbox"],
        categories: undefined,
        seasons: undefined,
        keywords: ["mozart"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const ids = parsed.questions.map((q: { id: string }) => q.id).sort();
    assert.deepEqual(ids, ["m1", "s2"]);
    for (const q of parsed.questions) {
      assert.ok(q.game === "main" || q.game === "sandbox", `unexpected game ${q.game}`);
    }
  });

  it("unknown game name in games array is rejected with structured error", async () => {
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: ["main", "ghost"],
        categories: undefined,
        seasons: undefined,
        keywords: ["mozart"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const block = result.content?.[0];
    const text = block && "text" in block ? block.text : "";
    assert.match(text, /ghost/);
    assert.match(text, /Unknown game/);
  });

  it("keywords are OR-internal: rows matching any keyword surface once", async () => {
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: undefined,
        categories: undefined,
        seasons: undefined,
        keywords: ["mozart", "everest"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const ids = parsed.questions.map((q: { id: string }) => q.id).sort();
    assert.deepEqual(ids, ["m1", "m2", "r1", "s2"]);
  });

  it("matchedKeywords preserves input keyword order", async () => {
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: ["main"],
        categories: undefined,
        seasons: undefined,
        keywords: ["1791", "mozart"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const m1 = parsed.questions.find((q: { id: string }) => q.id === "m1");
    assert.deepEqual(m1.matchedKeywords, ["1791", "mozart"]);
  });

  it("match=any unions criteria across the top level", async () => {
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: undefined,
        categories: ["Geography"],
        seasons: undefined,
        keywords: ["mozart"],
        match: "any",
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const ids = parsed.questions.map((q: { id: string }) => q.id).sort();
    assert.deepEqual(ids, ["m1", "m2", "r1", "s2"]);
  });

  it("match=all with a single criterion is equivalent to match=any", async () => {
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const resultAll = await tool.handler(
      {
        games: undefined,
        categories: undefined,
        seasons: undefined,
        keywords: ["mozart"],
        match: "all",
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const resultAny = await tool.handler(
      {
        games: undefined,
        categories: undefined,
        seasons: undefined,
        keywords: ["mozart"],
        match: "any",
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const idsAll = parseToolResult(resultAll)
      .questions.map((q: { id: string }) => q.id)
      .sort();
    const idsAny = parseToolResult(resultAny)
      .questions.map((q: { id: string }) => q.id)
      .sort();
    assert.deepEqual(idsAll, idsAny);
  });

  it("no criteria supplied returns everything in scope", async () => {
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: undefined,
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.count, 5);
  });

  it("empty arrays equal omitted arrays", async () => {
    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: [],
        categories: [],
        seasons: [],
        keywords: ["mozart"],
        match: undefined,
        posted: undefined,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const ids = parsed.questions.map((q: { id: string }) => q.id).sort();
    assert.deepEqual(ids, ["m1", "r1", "s2"]);
  });
});
