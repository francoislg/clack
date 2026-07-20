import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createUnlockQuestionsTool } from "./unlockQuestions.js";
import { type LockSlackDeps } from "./lockQuestions.js";
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

interface UnlockResult {
  unlocked?: string[];
  errors?: Array<{ questionId: string; error: string }>;
  error?: string;
}

function locked(overrides: Partial<TriviaQuestion>): TriviaQuestion {
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
    answerLocked: true,
    ...overrides,
  };
}

async function run(data: FakeTriviaDataLayer, sdk: LockSlackDeps): Promise<UnlockResult> {
  const tool = createUnlockQuestionsTool(data, sdk, fixtureGetGames);
  return parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION));
}

describe("unlock_questions", () => {
  it("clears the flag and repaints every locked, unrevealed question", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(locked({ id: "a" }));
    await scoped.saveQuestion(locked({ id: "b" }));
    const chat = { update: vi.fn<RosterEditClient["chat"]["update"]>(async () => ({ ok: true })) };
    const slackDeps = createFakeLockSlackDeps({ getSlackClient: () => ({ chat }) });

    const res = await run(data, slackDeps);

    assert.deepEqual(res.unlocked?.sort(), ["a", "b"]);
    assert.equal(chat.update.mock.calls.length, 2);
    const after = await scoped.loadQuestions();
    assert.ok(after.every((q) => q.answerLocked === false));
  });

  it("does not reopen an already-revealed (and locked) question", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(locked({ id: "revealed", processedAt: 2000 }));
    const chat = { update: vi.fn<RosterEditClient["chat"]["update"]>(async () => ({ ok: true })) };
    const slackDeps = createFakeLockSlackDeps({ getSlackClient: () => ({ chat }) });

    const res = await run(data, slackDeps);

    assert.deepEqual(res.unlocked, []);
    const after = (await scoped.loadQuestions()).find((q) => q.id === "revealed");
    assert.equal(after?.answerLocked, true, "revealed+locked question stays locked");
  });

  it("ignores questions that are not locked", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(locked({ id: "open", answerLocked: undefined }));
    const chat = { update: vi.fn<RosterEditClient["chat"]["update"]>(async () => ({ ok: true })) };
    const slackDeps = createFakeLockSlackDeps({ getSlackClient: () => ({ chat }) });

    const res = await run(data, slackDeps);
    assert.deepEqual(res.unlocked, []);
  });

  it("errors when the Slack client is unavailable", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const res = await run(data, { getSlackClient: () => null });
    assert.match(res.error ?? "", /Slack client is not available/);
  });
});
