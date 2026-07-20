import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";

const SESSION = { sessionId: "test" };

function extractText(result: { content?: ReadonlyArray<{ type: string }> }): string {
  const block = result.content?.[0];
  if (block && "text" in block && typeof (block as { text: unknown }).text === "string") {
    return (block as { text: string }).text;
  }
  return "";
}

describe("find_previous_questions — posted filter", () => {
  let data: FakeTriviaDataLayer;

  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;

    const q1 = {
      id: "q1",
      category: "Science",
      statement: "posted question one",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 1,
      postedAt: 1500,
      messageLink: "https://slack.com/archives/C/p1",
    };
    const q2 = {
      id: "q2",
      category: "Geography",
      statement: "posted question two",
      isTrue: false,
      emojis: ["🌍"],
      createdAt: 2,
      postedAt: 2500,
      messageLink: "https://slack.com/archives/C/p2",
    };
    const q3 = {
      id: "q3",
      category: "Science",
      statement: "staged question three",
      isTrue: true,
      emojis: ["🧪"],
      createdAt: 3,
    };
    const q4 = {
      id: "q4",
      category: "History",
      statement: "staged question four",
      isTrue: false,
      emojis: ["📜"],
      createdAt: 4,
    };

    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([q1, q2, q3, q4]);
  });

  it("posted: true returns only posted questions", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: true,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const ids = parsed.questions.map((q: { id: string }) => q.id).sort();
    assert.deepEqual(ids, ["q1", "q2"]);
  });

  it("posted: false returns only staged (unposted) questions", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: false,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    const ids = parsed.questions.map((q: { id: string }) => q.id).sort();
    assert.deepEqual(ids, ["q3", "q4"]);
  });

  it("posted omitted returns ALL questions (criterion not supplied)", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
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
    assert.equal(parsed.count, 4);
  });

  it("posted combines with categories under match: 'all'", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: ["Science"],
        seasons: undefined,
        keywords: undefined,
        match: "all",
        posted: false,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    // Only staged + category=Science → q3 (q1 is Science but posted)
    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "q3");
  });

  it("posted combines under match: 'any' (union, not intersection)", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        // Omit `games` — including it would itself be a criterion that matches every
        // fixture row, making the "any" union trivially complete and masking the
        // posted/categories interaction this test is checking.
        games: undefined,
        categories: ["History"],
        seasons: undefined,
        keywords: undefined,
        match: "any",
        posted: true,
        recentBatchFromNow: undefined,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    // posted=true (q1, q2) UNION categories=History (q4) → q1, q2, q4
    const ids = parsed.questions.map((q: { id: string }) => q.id).sort();
    assert.deepEqual(ids, ["q1", "q2", "q4"]);
  });

  it("posted: false + recentBatchFromNow is rejected with a clear error", async () => {
    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: false,
        recentBatchFromNow: 1,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    assert.match(extractText(result), /recentBatchFromNow.*requires posted/i);
    assert.match(extractText(result), /posted: false/);
  });

  it("posted: true + recentBatchFromNow is permitted (existing behavior preserved)", async () => {
    const q1 = {
      id: "q1",
      category: "Science",
      statement: "posted question one",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 1,
      postedAt: 1500,
      messageLink: "https://slack.com/archives/C/p1",
      batchId: "batch-a",
    };
    const q2 = {
      id: "q2",
      category: "Geography",
      statement: "posted question two",
      isTrue: false,
      emojis: ["🌍"],
      createdAt: 2,
      postedAt: 2500,
      messageLink: "https://slack.com/archives/C/p2",
      batchId: "batch-a",
    };
    const q3 = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    const q3q4 = q3?.slice(2) || [];

    data.forGame(FIXTURE_GAME_NAME).loadQuestions.mockResolvedValue([q1, q2, ...q3q4]);

    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: [FIXTURE_GAME_NAME],
        categories: undefined,
        seasons: undefined,
        keywords: undefined,
        match: undefined,
        posted: true,
        recentBatchFromNow: 1,
        limit: undefined,
        includeRevealBlocks: undefined,
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.questions.length, 2);
  });
});
