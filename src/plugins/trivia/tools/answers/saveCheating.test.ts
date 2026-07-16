import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import { createTriviaDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createSaveCheatingTool } from "./saveCheating.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";

const SESSION = { sessionId: "test" };

describe("save_cheating tool", () => {
  it("first cheat initializes cheatAttempts counter to 1 and DMs the owner", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createSaveCheatingTool(data, sdk, fixtureGetGames);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        cheaterUserId: "U123",
        questionId: "q1",
        reason: "Asked about the exact fact from today's question",
        evidence: "msg: 'how tall is mount everest'",
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.saved, true);
    assert.equal(body.totalAttempts, 1);
    assert.equal(body.ownerNotified, true);

    const userData = await sdk.users
      .data(z.object({ cheatAttempts: z.number().optional() }))
      .get("U123");
    assert.equal(userData?.cheatAttempts, 1);

    const cheats = await data.forGame(FIXTURE_GAME_NAME).loadCheats();
    assert.equal(cheats.length, 1);
    assert.equal(cheats[0].cheaterUserId, "U123");
    assert.equal(cheats[0].questionId, "q1");

    assert.equal(sdk.dmOwner.mock.calls.length, 1);
    assert.match(sdk.dmOwner.mock.calls[0][0], /Trivia cheat report/);
    assert.match(sdk.dmOwner.mock.calls[0][0], /<@U123>/);
    assert.match(sdk.dmOwner.mock.calls[0][0], /total attempts: 1/);
    assert.match(sdk.dmOwner.mock.calls[0][0], /q1/);
    assert.match(sdk.dmOwner.mock.calls[0][0], /how tall is mount everest/);
  });

  it("reports an owner-notification failure without losing the saved report", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    sdk.dmOwner.mockResolvedValue({
      ok: false,
      error: "No owner is configured (set one via the Home Tab)",
    });
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createSaveCheatingTool(data, sdk, fixtureGetGames);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        cheaterUserId: "U1",
        questionId: "q1",
        reason: "caught",
        evidence: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.saved, true);
    assert.equal(body.ownerNotified, false);
    assert.match(body.ownerNotificationError, /owner is configured/);

    const cheats = await data.forGame(FIXTURE_GAME_NAME).loadCheats();
    assert.equal(cheats.length, 1);
  });

  it("subsequent cheats increment the counter", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createSaveCheatingTool(data, sdk, fixtureGetGames);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        cheaterUserId: "U123",
        questionId: "q1",
        reason: "first offense",
        evidence: undefined,
      },
      SESSION,
    );
    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        cheaterUserId: "U123",
        questionId: "q2",
        reason: "second offense",
        evidence: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.totalAttempts, 2);

    const userData = await sdk.users
      .data(z.object({ cheatAttempts: z.number().optional() }))
      .get("U123");
    assert.equal(userData?.cheatAttempts, 2);

    const cheats = await data.forGame(FIXTURE_GAME_NAME).loadCheats();
    assert.equal(cheats.length, 2);
  });

  it("appends each report in order", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createSaveCheatingTool(data, sdk, fixtureGetGames);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        cheaterUserId: "U1",
        questionId: "q1",
        reason: "first",
        evidence: undefined,
      },
      SESSION,
    );
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        cheaterUserId: "U2",
        questionId: "q1",
        reason: "second",
        evidence: undefined,
      },
      SESSION,
    );
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        cheaterUserId: "U1",
        questionId: "q2",
        reason: "third",
        evidence: undefined,
      },
      SESSION,
    );

    const cheats = await data.forGame(FIXTURE_GAME_NAME).loadCheats();
    assert.equal(cheats.length, 3);
    assert.deepEqual(
      cheats.map((c) => c.reason),
      ["first", "second", "third"],
    );
  });

  it("rejects empty reason and does not DM the owner", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createSaveCheatingTool(data, sdk, fixtureGetGames);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        cheaterUserId: "U1",
        questionId: "q1",
        reason: "  ",
        evidence: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.error, "reason must be a concise description");

    const cheats = await data.forGame(FIXTURE_GAME_NAME).loadCheats();
    assert.equal(cheats.length, 0);
    assert.equal(sdk.dmOwner.mock.calls.length, 0);
  });

  it("preserves existing user fields when incrementing counter", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk);
    testHelpers.saveUser({ userId: "U99", displayName: "Alice" });
    await sdk.users
      .data(z.object({ joinedAt: z.number().optional(), cheatAttempts: z.number().optional() }))
      .merge("U99", { joinedAt: 1_700_000_000_000 });
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const tool = createSaveCheatingTool(data, sdk, fixtureGetGames);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        cheaterUserId: "U99",
        questionId: "q1",
        reason: "caught",
        evidence: undefined,
      },
      SESSION,
    );

    const uData = await sdk.users
      .data(z.object({ joinedAt: z.number().optional(), cheatAttempts: z.number().optional() }))
      .get("U99");
    assert.equal(uData?.joinedAt, 1_700_000_000_000);
    assert.equal(uData?.cheatAttempts, 1);
  });
});
