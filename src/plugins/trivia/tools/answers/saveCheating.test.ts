import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createSaveCheatingTool } from "./saveCheating.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { ClackSdk } from "../../../sdk.js";

const SESSION = { sessionId: "test" };

interface FakeSdkOptions {
  dmOwnerResult?: { ok: true } | { ok: false; error: string };
}

function makeFakeSdk(opts: FakeSdkOptions = {}): {
  sdk: ClackSdk;
  dmOwnerCalls: string[];
} {
  const dmOwnerCalls: string[] = [];
  const result = opts.dmOwnerResult ?? { ok: true as const };
  const sdk: ClackSdk = {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    capabilities: { crons: true },
    error: () => {},
    addInstruction: () => {},
    addTopicInstruction: () => {},
    registerTool: () => {},
    mcpServer: { fullName: "test", registerTool: () => {}, addTopicInstruction: () => {} },
    registerMcpServer: () => ({
      fullName: "test",
      registerTool: () => {},
      addTopicInstruction: () => {},
    }),
    readFile: async () => null,
    writeFile: async () => {},
    watchFile: () => {
      throw new Error("watchFile not used in saveCheating tests");
    },
    reconcileCronJobs: async () => {},
    dmOwner: async (text: string) => {
      dmOwnerCalls.push(text);
      return result;
    },
    getSlackClient: () => null,
    registerAction: () => {},
    registerView: () => {},
    actionId: (key: string) => `plugin:test:${key}`,
    viewCallbackId: (key: string) => `plugin:test:${key}`,
    askClaude: async () => {
      throw new Error("askClaude not used in saveCheating tests");
    },
    requestSoftRestart: () => {},
    registerDictionary: () => {},
    t: (key: string) => key,
  };
  return { sdk, dmOwnerCalls };
}

describe("save_cheating tool", () => {
  it("first cheat initializes cheatAttempts counter to 1 and DMs the owner", async () => {
    const data = createInMemoryDataLayer();
    const { sdk, dmOwnerCalls } = makeFakeSdk();
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

    const users = await data.loadUsers();
    assert.equal(users.get("U123")?.cheatAttempts, 1);

    const cheats = await data.forGame(FIXTURE_GAME_NAME).loadCheats();
    assert.equal(cheats.length, 1);
    assert.equal(cheats[0].cheaterUserId, "U123");
    assert.equal(cheats[0].questionId, "q1");

    assert.equal(dmOwnerCalls.length, 1);
    assert.match(dmOwnerCalls[0], /Trivia cheat report/);
    assert.match(dmOwnerCalls[0], /<@U123>/);
    assert.match(dmOwnerCalls[0], /total attempts: 1/);
    assert.match(dmOwnerCalls[0], /q1/);
    assert.match(dmOwnerCalls[0], /how tall is mount everest/);
  });

  it("reports an owner-notification failure without losing the saved report", async () => {
    const data = createInMemoryDataLayer();
    const { sdk } = makeFakeSdk({
      dmOwnerResult: { ok: false, error: "No owner is configured (set one via the Home Tab)" },
    });
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
    const data = createInMemoryDataLayer();
    const { sdk } = makeFakeSdk();
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

    const users = await data.loadUsers();
    assert.equal(users.get("U123")?.cheatAttempts, 2);

    const cheats = await data.forGame(FIXTURE_GAME_NAME).loadCheats();
    assert.equal(cheats.length, 2);
  });

  it("appends each report in order", async () => {
    const data = createInMemoryDataLayer();
    const { sdk } = makeFakeSdk();
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
    const data = createInMemoryDataLayer();
    const { sdk, dmOwnerCalls } = makeFakeSdk();
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
    assert.equal(dmOwnerCalls.length, 0);
  });

  it("preserves existing user fields when incrementing counter", async () => {
    const data = createInMemoryDataLayer();
    await data.saveUser({
      userId: "U99",
      displayName: "Alice",
      joinedAt: 1_700_000_000_000,
    });
    const { sdk } = makeFakeSdk();
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

    const users = await data.loadUsers();
    const u = users.get("U99");
    assert.equal(u?.displayName, "Alice");
    assert.equal(u?.joinedAt, 1_700_000_000_000);
    assert.equal(u?.cheatAttempts, 1);
  });
});
