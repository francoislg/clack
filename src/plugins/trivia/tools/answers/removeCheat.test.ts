import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import { createTriviaDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createRemoveCheatTool } from "./removeCheat.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";

const SESSION = { sessionId: "test" };

// remove_cheat takes no SDK, so it structurally cannot emit a Slack message —
// the "no Slack message on removal" requirement is enforced by the tool's shape.

describe("remove_cheat tool", () => {
  it("removes a matching report and decrements the counter", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveCheat({ cheaterUserId: "U1", questionId: "q1", reason: "x", detectedAt: "t" });
    await scoped.saveCheat({ cheaterUserId: "U1", questionId: "q2", reason: "y", detectedAt: "t" });
    const tool = createRemoveCheatTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, cheaterUserId: "U1", questionId: "q1" },
        SESSION,
      ),
    );
    assert.equal(body.removed, 1);
    assert.equal(body.totalAttempts, 1);

    const cheats = await scoped.loadCheats();
    assert.equal(cheats.length, 1);
    assert.equal(cheats[0].questionId, "q2", "the unrelated report is preserved");
    assert.equal(
      (await sdk.users.data(z.object({ cheatAttempts: z.number().optional() })).get("U1"))
        ?.cheatAttempts,
      1,
    );
  });

  it("removes every matching report and drops the counter by that count", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveCheat({ cheaterUserId: "U1", questionId: "q1", reason: "a", detectedAt: "t" });
    await scoped.saveCheat({ cheaterUserId: "U1", questionId: "q1", reason: "b", detectedAt: "t" });
    const tool = createRemoveCheatTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, cheaterUserId: "U1", questionId: "q1" },
        SESSION,
      ),
    );
    assert.equal(body.removed, 2);
    assert.equal(body.totalAttempts, 0);
    assert.equal((await scoped.loadCheats()).length, 0);
  });

  it("floors the counter at 0 when it has drifted below the removed count", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveCheat({ cheaterUserId: "U1", questionId: "q1", reason: "a", detectedAt: "t" });
    // Force a drifted counter: 0 despite an existing report.
    await sdk.users
      .data(z.object({ joinedAt: z.number().optional(), cheatAttempts: z.number().optional() }))
      .merge("U1", { joinedAt: 0, cheatAttempts: 0 });
    const tool = createRemoveCheatTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, cheaterUserId: "U1", questionId: "q1" },
        SESSION,
      ),
    );
    assert.equal(body.removed, 1);
    assert.equal(body.totalAttempts, 0, "never negative");
  });

  it("is a safe no-op when nothing matches", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveCheat({ cheaterUserId: "U1", questionId: "q1", reason: "a", detectedAt: "t" });
    const tool = createRemoveCheatTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, cheaterUserId: "U1", questionId: "qZ" },
        SESSION,
      ),
    );
    assert.equal(body.removed, 0);
    assert.match(body.message, /No cheat report/);
    assert.equal((await scoped.loadCheats()).length, 1, "report untouched");
    assert.equal(
      (await sdk.users.data(z.object({ cheatAttempts: z.number().optional() })).get("U1"))
        ?.cheatAttempts,
      1,
      "counter untouched",
    );
  });

  it("points at the reprocess-refresh flow when the question was already revealed", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "q1",
      category: "C",
      statement: "s",
      answersFormat: "boolean",
      questionType: "fact",
      isTrue: true,
      emojis: ["🎯"],
      createdAt: 0,
      postedAt: 1_000,
      messageLink: "https://x.slack.com/archives/C1/p1700000000000000",
      revealResponses: "yes",
      processedAt: 9_000,
    });
    await scoped.saveCheat({ cheaterUserId: "U1", questionId: "q1", reason: "a", detectedAt: "t" });
    const tool = createRemoveCheatTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, cheaterUserId: "U1", questionId: "q1" },
        SESSION,
      ),
    );
    assert.match(body.refreshHint, /compute_answers/);
    assert.match(body.refreshHint, /refresh_question_cards\(game, questionIds: \["q1"\]\)/);
    assert.doesNotMatch(body.refreshHint, /batchId/);
  });

  it("omits the refreshHint when the question has not been revealed yet", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "q1",
      category: "C",
      statement: "s",
      answersFormat: "boolean",
      questionType: "fact",
      isTrue: true,
      emojis: ["🎯"],
      createdAt: 0,
      postedAt: 1_000,
      messageLink: "https://x.slack.com/archives/C1/p1700000000000000",
      revealResponses: "yes",
    });
    await scoped.saveCheat({ cheaterUserId: "U1", questionId: "q1", reason: "a", detectedAt: "t" });
    const tool = createRemoveCheatTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, cheaterUserId: "U1", questionId: "q1" },
        SESSION,
      ),
    );
    assert.equal(body.removed, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "refreshHint"), false);
  });
});
