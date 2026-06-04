import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  createInMemoryDataLayer,
  fixtureGetGames,
  multiFixtureGetGames,
} from "../../testHelpers.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";

const SESSION = { sessionId: "test" };

describe("find_previous_questions seasons array semantics", () => {
  it('seasons: ["current"] resolves per-game', async () => {
    const data = createInMemoryDataLayer();
    const main = data.forGame("main");
    const sandbox = data.forGame("sandbox");

    await main.saveSeasonsState({
      seasons: [
        {
          slug: "summer-2026",
          startedAt: 1000,
          expectedEndAt: 1_000_000_000_000_000,
          categories: ["Music"],
        },
      ],
    });
    await sandbox.saveSeasonsState({
      seasons: [
        {
          slug: "demo-2026",
          startedAt: 1000,
          expectedEndAt: 1_000_000_000_000_000,
          categories: ["Music"],
        },
      ],
    });

    await main.saveQuestion({
      id: "m1",
      category: "Music",
      statement: "Main current season question",
      isTrue: true,
      emojis: ["🎵"],
      createdAt: 100,
      season: "summer-2026",
    });
    await main.saveQuestion({
      id: "m2",
      category: "Music",
      statement: "Main other season question",
      isTrue: true,
      emojis: ["🎵"],
      createdAt: 101,
      season: "spring-2026",
    });
    await sandbox.saveQuestion({
      id: "s1",
      category: "Music",
      statement: "Sandbox current season question",
      isTrue: true,
      emojis: ["🎵"],
      createdAt: 102,
      season: "demo-2026",
    });

    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: undefined,
        categories: undefined,
        seasons: ["current"],
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
    const ids = parsed.questions.map((q: { id: string }) => q.id).sort();
    assert.deepEqual(ids, ["m1", "s1"]);
  });

  it('seasons: ["current"] during a gap contributes no match for that game', async () => {
    const data = createInMemoryDataLayer();
    const main = data.forGame("main");
    // Seasons are enabled (state exists) but no season covers `now` — gap scenario.
    await main.saveSeasonsState({
      seasons: [
        {
          slug: "ancient-history",
          startedAt: 0,
          expectedEndAt: 1000,
          endedAt: 1000,
          categories: [],
        },
      ],
    });
    await main.saveQuestion({
      id: "m1",
      category: "Music",
      statement: "Main no-season question",
      isTrue: true,
      emojis: ["🎵"],
      createdAt: 100,
      season: "summer-2026",
    });

    const tool = createFindPreviousQuestionsTool(data, multiFixtureGetGames);
    const result = await tool.handler(
      {
        games: ["main"],
        categories: undefined,
        seasons: ["current"],
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
    assert.equal(parsed.count, 0);
  });

  it("multiple season slugs are OR-internal", async () => {
    const data = createInMemoryDataLayer();
    const main = data.forGame("main");
    await main.saveSeasonsState({
      seasons: [
        {
          slug: "spring-2026",
          startedAt: 0,
          expectedEndAt: 500,
          endedAt: 500,
          categories: [],
        },
        {
          slug: "summer-2026",
          startedAt: 500,
          expectedEndAt: 1_000_000_000_000_000,
          categories: [],
        },
      ],
    });
    await main.saveQuestion({
      id: "s1",
      category: "X",
      statement: "Spring question long enough",
      isTrue: true,
      emojis: ["🌱"],
      createdAt: 1,
      season: "spring-2026",
    });
    await main.saveQuestion({
      id: "s2",
      category: "X",
      statement: "Summer question long enough",
      isTrue: true,
      emojis: ["☀️"],
      createdAt: 2,
      season: "summer-2026",
    });
    await main.saveQuestion({
      id: "s3",
      category: "X",
      statement: "Winter question long enough",
      isTrue: true,
      emojis: ["❄️"],
      createdAt: 3,
      season: "winter-2026",
    });

    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: ["main"],
        categories: undefined,
        seasons: ["spring-2026", "summer-2026"],
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
    const ids = parsed.questions.map((q: { id: string }) => q.id).sort();
    assert.deepEqual(ids, ["s1", "s2"]);
  });

  it("seasons criterion is silently dropped when no game has a seasons state", async () => {
    // When trivia.seasons.enabled is false, no game has a seasons state. The criterion
    // is dropped → falls back to "no criterion supplied," and the remaining keywords
    // criterion governs matching alone.
    const data = createInMemoryDataLayer();
    const main = data.forGame("main");
    await main.saveQuestion({
      id: "m1",
      category: "X",
      statement: "Mozart wrote operas",
      isTrue: true,
      emojis: ["🎼"],
      createdAt: 1,
    });

    const tool = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const result = await tool.handler(
      {
        games: ["main"],
        categories: undefined,
        seasons: ["anything"],
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
  });
});
