import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createLockQuestionsTool, type LockSlackDeps } from "./lockQuestions.js";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import {
  createFakeSdk,
  primeTriviaConfig,
  createFakeLockSlackDeps,
} from "../../testHelpers.fakeSdk.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { RosterEditClient } from "../../freeform/roster.js";
import type { KnownBlock } from "@slack/types";
import type { TriviaQuestion } from "../../core/types.js";

const SESSION = { sessionId: "test" };

interface LockResult {
  locked?: string[];
  errors?: Array<{ questionId: string; error: string }>;
  error?: string;
}

function posted(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  const blocks: KnownBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: "stmt" } },
    { type: "actions", block_id: "vote-actions:q", elements: [] },
  ];
  return {
    id: "q",
    category: "C",
    statement: "stmt",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    postedAt: 1000,
    messageLink: "https://x.slack.com/archives/C100000000/p1700000000000000",
    postedBlocks: blocks,
    ...overrides,
  };
}

async function run(data: FakeTriviaDataLayer, sdk: LockSlackDeps): Promise<LockResult> {
  const tool = createLockQuestionsTool(data, sdk, fixtureGetGames);
  return parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION));
}

describe("lock_questions", () => {
  it("locks every posted, unrevealed, unlocked question and stamps the record", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(posted({ id: "a" }));
    await scoped.saveQuestion(posted({ id: "b" }));

    const chat = { update: vi.fn<RosterEditClient["chat"]["update"]>(async () => ({ ok: true })) };
    const slackDeps = createFakeLockSlackDeps({ getSlackClient: () => ({ chat }) });

    const res = await run(data, slackDeps);

    assert.deepEqual(res.locked?.sort(), ["a", "b"]);
    assert.equal(chat.update.mock.calls.length, 2, "both cards repainted");
    const after = await scoped.loadQuestions();
    assert.ok(after.every((q) => q.answerLocked === true));
  });

  it("skips revealed and already-locked questions", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(posted({ id: "open" }));
    await scoped.saveQuestion(posted({ id: "revealed", processedAt: 2000 }));
    await scoped.saveQuestion(posted({ id: "alreadyLocked", answerLocked: true }));
    const chat = { update: vi.fn<RosterEditClient["chat"]["update"]>(async () => ({ ok: true })) };
    const slackDeps = createFakeLockSlackDeps({ getSlackClient: () => ({ chat }) });

    const res = await run(data, slackDeps);

    assert.deepEqual(res.locked, ["open"]);
    const revealed = (await scoped.loadQuestions()).find((q) => q.id === "revealed");
    assert.equal(revealed?.answerLocked, undefined, "revealed question untouched");
  });

  it("skips unposted (staged) questions", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(posted({ id: "staged", postedAt: undefined }));
    const chat = { update: vi.fn<RosterEditClient["chat"]["update"]>(async () => ({ ok: true })) };
    const slackDeps = createFakeLockSlackDeps({ getSlackClient: () => ({ chat }) });

    const res = await run(data, slackDeps);
    assert.deepEqual(res.locked, []);
  });

  it("is idempotent — a second run locks nothing new", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(posted({ id: "a" }));
    const chat = { update: vi.fn<RosterEditClient["chat"]["update"]>(async () => ({ ok: true })) };
    const slackDeps = createFakeLockSlackDeps({ getSlackClient: () => ({ chat }) });

    const first = await run(data, slackDeps);
    assert.deepEqual(first.locked, ["a"]);
    const second = await run(data, slackDeps);
    assert.deepEqual(second.locked, []);
  });

  it("isolates a per-card chat.update failure — the flag still persists for every target", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(posted({ id: "a" }));
    await scoped.saveQuestion(posted({ id: "b" }));
    const chat = {
      update: vi.fn<RosterEditClient["chat"]["update"]>(async () => {
        throw new Error("slack down");
      }),
    };
    const slackDeps = createFakeLockSlackDeps({ getSlackClient: () => ({ chat }) });

    const res = await run(data, slackDeps);

    assert.deepEqual(res.locked?.sort(), ["a", "b"]);
    assert.equal(chat.update.mock.calls.length, 2);
    const after = await scoped.loadQuestions();
    assert.ok(after.every((q) => q.answerLocked === true));
  });

  it("errors when the game is unknown", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const slackDeps = createFakeLockSlackDeps();
    const tool = createLockQuestionsTool(data, slackDeps, fixtureGetGames);
    const res: LockResult = parseToolResult(await tool.handler({ game: "nope" }, SESSION));
    assert.ok(res.error);
  });

  it("errors when the Slack client is unavailable", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const res = await run(data, { getSlackClient: () => null });
    assert.match(res.error ?? "", /Slack client is not available/);
  });
});
