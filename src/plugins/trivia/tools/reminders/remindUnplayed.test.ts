import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createRemindUnplayedTool } from "./remindUnplayed.js";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaQuestion } from "../../core/types.js";
import { revealReminderKey } from "../../core/userPrefs.js";

const SESSION = { sessionId: "test" };

// Per-game opt-in key for the fixture game — what a user's slice must carry to be reminded.
const REMINDER_KEY = revealReminderKey(FIXTURE_GAME_NAME);

interface RemindResult {
  reminded?: number;
  skipped?: number;
  message?: string;
  error?: string;
}

function pendingQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q1",
    category: "C",
    statement: "stmt",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 100,
    postedAt: 200,
    ...overrides,
  };
}

async function run(
  data: FakeTriviaDataLayer,
  sdk: ReturnType<typeof createFakeSdk>["sdk"],
  message: string,
): Promise<RemindResult> {
  const remindDeps = {
    dmUser: sdk.dmUser,
    preferences: sdk.preferences,
    logger: sdk.logger,
  };
  const tool = createRemindUnplayedTool(data, remindDeps, fixtureGetGames);
  return parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME, message }, SESSION));
}

describe("remind_unplayed", () => {
  let sdk: ReturnType<typeof createFakeSdk>["sdk"];
  let testHelpers: ReturnType<typeof createFakeSdk>["testHelpers"];
  let data: FakeTriviaDataLayer;

  beforeEach(() => {
    const created = createFakeSdk();
    sdk = created.sdk;
    testHelpers = created.testHelpers;
    primeTriviaConfig(sdk);
    const dataLayer = createTriviaDataLayer(sdk);
    data = dataLayer.dataLayer;
  });

  it("reminds opted-in players who haven't answered pending questions", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(pendingQuestion({}));

    testHelpers.saveUser({ userId: "u1", displayName: "Alice" });
    testHelpers.saveUser({ userId: "u2", displayName: "Bob" });
    testHelpers.saveUser({ userId: "u3", displayName: "Charlie" });

    await scoped.saveAnswer({
      userId: "u1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 100,
    });

    testHelpers.savePreference("u2", { [REMINDER_KEY]: true });
    testHelpers.savePreference("u3", { [REMINDER_KEY]: false });

    const res = await run(data, sdk, "Hurry up!");

    assert.equal(res.reminded, 1, "only u2 reminded");
    assert.equal(res.skipped, 1, "u3 skipped");
    assert.equal(sdk.dmUser.mock.calls.length, 1, "dmUser called once");
    const call = sdk.dmUser.mock.calls[0];
    assert.equal(call[0], "u2");
    assert.equal(call[1], "Hurry up!");
  });

  it("returns no-op when no current round pending", async () => {
    testHelpers.saveUser({ userId: "u1", displayName: "Alice" });

    const res = await run(data, sdk, "Hurry up!");

    assert.equal(res.reminded, 0);
    assert.match(res.message ?? "", /no current round/i);
  });

  it("excludes players who already answered", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(pendingQuestion({}));

    testHelpers.saveUser({ userId: "u1", displayName: "Alice" });
    testHelpers.saveUser({ userId: "u2", displayName: "Bob" });

    await scoped.saveAnswer({
      userId: "u1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 100,
    });
    await scoped.saveAnswer({
      userId: "u2",
      questionId: "q1",
      answer: false,
      correct: false,
      timestamp: 100,
    });

    testHelpers.savePreference("u1", { [REMINDER_KEY]: true });
    testHelpers.savePreference("u2", { [REMINDER_KEY]: true });

    const res = await run(data, sdk, "Hurry up!");

    assert.equal(res.reminded, 0, "nobody reminded");
    assert.equal(sdk.dmUser.mock.calls.length, 0);
  });

  it("respects preference opt-out", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(pendingQuestion({}));

    testHelpers.saveUser({ userId: "u1", displayName: "Alice" });
    testHelpers.saveUser({ userId: "u2", displayName: "Bob" });

    testHelpers.savePreference("u1", { [REMINDER_KEY]: true });
    testHelpers.savePreference("u2", { [REMINDER_KEY]: false });

    const res = await run(data, sdk, "Hurry up!");

    assert.equal(res.reminded, 1);
    assert.equal(res.skipped, 1);
  });

  it("continues past per-user DM failures", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(pendingQuestion({}));

    testHelpers.saveUser({ userId: "u1", displayName: "Alice" });
    testHelpers.saveUser({ userId: "u2", displayName: "Bob" });

    testHelpers.savePreference("u1", { [REMINDER_KEY]: true });
    testHelpers.savePreference("u2", { [REMINDER_KEY]: true });

    sdk.dmUser.mockImplementation(async (userId) => {
      if (userId === "u1") {
        return { ok: false, error: "user not found" };
      }
      return { ok: true };
    });

    const res = await run(data, sdk, "Hurry up!");

    assert.equal(res.reminded, 1);
    assert.equal(sdk.dmUser.mock.calls.length, 2);
    // Spec: a per-recipient delivery failure is logged (not silently swallowed).
    assert.ok(
      sdk.logger.warn.mock.calls.some((call) => String(call[0]).includes("u1")),
      "u1's DM failure is logged",
    );
  });

  it("logs and continues when a DM throws", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(pendingQuestion({}));

    testHelpers.saveUser({ userId: "u1", displayName: "Alice" });
    testHelpers.saveUser({ userId: "u2", displayName: "Bob" });

    testHelpers.savePreference("u1", { [REMINDER_KEY]: true });
    testHelpers.savePreference("u2", { [REMINDER_KEY]: true });

    sdk.dmUser.mockImplementation(async (userId) => {
      if (userId === "u1") {
        throw new Error("network down");
      }
      return { ok: true };
    });

    const res = await run(data, sdk, "Hurry up!");

    assert.equal(res.reminded, 1, "u2 still reminded after u1 threw");
    assert.ok(
      sdk.logger.warn.mock.calls.some((call) => String(call[0]).includes("threw")),
      "the thrown DM failure is logged",
    );
  });

  it("handles unset preferences as opted-out", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(pendingQuestion({}));

    testHelpers.saveUser({ userId: "u1", displayName: "Alice" });

    const res = await run(data, sdk, "Hurry up!");

    assert.equal(res.reminded, 0, "nobody reminded");
    assert.equal(res.skipped, 1, "u1 skipped");
  });

  it("excludes team rows from candidates", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(pendingQuestion({}));

    testHelpers.saveUser({ userId: "u1", displayName: "Alice" });
    testHelpers.saveUser({ userId: "team:alpha", displayName: "Team Alpha" });

    testHelpers.savePreference("u1", { [REMINDER_KEY]: true });

    await scoped.saveAnswer({
      userId: "team:alpha",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 100,
    });

    const res = await run(data, sdk, "Hurry up!");

    assert.equal(res.reminded, 1);
    assert.equal(sdk.dmUser.mock.calls.length, 1);
    assert.equal(sdk.dmUser.mock.calls[0][0], "u1");
  });

  it("errors when the game is unknown", async () => {
    const remindDeps = {
      dmUser: sdk.dmUser,
      preferences: sdk.preferences,
      logger: sdk.logger,
    };
    const tool = createRemindUnplayedTool(data, remindDeps, fixtureGetGames);
    const res: RemindResult = parseToolResult(
      await tool.handler({ game: "nope", message: "Hurry up!" }, SESSION),
    );

    assert.ok(res.error);
  });
});
