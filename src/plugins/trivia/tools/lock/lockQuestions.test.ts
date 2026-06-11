import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createLockQuestionsTool, type LockSlackDeps } from "./lockQuestions.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { RosterEditClient } from "../../freeform/roster.js";
import type { KnownBlock } from "@slack/types";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";

const SESSION = { sessionId: "test" };

interface LockResult {
  locked?: string[];
  errors?: Array<{ questionId: string; error: string }>;
  error?: string;
}

/** Fake Slack client capturing chat.update ts values; `throwOnUpdate` forces failure. */
function fakeSdk(throwOnUpdate = false): { sdk: LockSlackDeps; updateCalls: string[] } {
  const updateCalls: string[] = [];
  const chat: RosterEditClient["chat"] = {
    async update(args) {
      updateCalls.push("ts" in args && typeof args.ts === "string" ? args.ts : "");
      if (throwOnUpdate) throw new Error("slack down");
      return { ok: true };
    },
  };
  return { sdk: { getSlackClient: () => ({ chat }) }, updateCalls };
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

async function run(data: TriviaDataLayer, sdk: LockSlackDeps): Promise<LockResult> {
  const tool = createLockQuestionsTool(data, sdk, fixtureGetGames);
  return parseToolResult(await tool.handler({ game: FIXTURE_GAME_NAME }, SESSION));
}

describe("lock_questions", () => {
  it("locks every posted, unrevealed, unlocked question and stamps the record", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(posted({ id: "a" }));
    await scoped.saveQuestion(posted({ id: "b" }));
    const { sdk, updateCalls } = fakeSdk();

    const res = await run(data, sdk);

    assert.deepEqual(res.locked?.sort(), ["a", "b"]);
    assert.equal(updateCalls.length, 2, "both cards repainted");
    const after = await scoped.loadQuestions();
    assert.ok(after.every((q) => q.answerLocked === true));
  });

  it("skips revealed and already-locked questions", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(posted({ id: "open" }));
    await scoped.saveQuestion(posted({ id: "revealed", processedAt: 2000 }));
    await scoped.saveQuestion(posted({ id: "alreadyLocked", answerLocked: true }));
    const { sdk } = fakeSdk();

    const res = await run(data, sdk);

    assert.deepEqual(res.locked, ["open"]);
    const revealed = (await scoped.loadQuestions()).find((q) => q.id === "revealed");
    assert.equal(revealed?.answerLocked, undefined, "revealed question untouched");
  });

  it("skips unposted (staged) questions", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(posted({ id: "staged", postedAt: undefined }));
    const { sdk } = fakeSdk();

    const res = await run(data, sdk);
    assert.deepEqual(res.locked, []);
  });

  it("is idempotent — a second run locks nothing new", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(posted({ id: "a" }));
    const { sdk } = fakeSdk();

    const first = await run(data, sdk);
    assert.deepEqual(first.locked, ["a"]);
    const second = await run(data, sdk);
    assert.deepEqual(second.locked, []);
  });

  it("isolates a per-card chat.update failure — the flag still persists for every target", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(posted({ id: "a" }));
    await scoped.saveQuestion(posted({ id: "b" }));
    const { sdk, updateCalls } = fakeSdk(true); // chat.update throws

    const res = await run(data, sdk);

    // editRosterIntoCard swallows chat.update failures, so both questions are still
    // flagged and both repaints were attempted — one card's failure never aborts the rest.
    assert.deepEqual(res.locked?.sort(), ["a", "b"]);
    assert.equal(updateCalls.length, 2);
    const after = await scoped.loadQuestions();
    assert.ok(after.every((q) => q.answerLocked === true));
  });

  it("errors when the game is unknown", async () => {
    const data = createInMemoryDataLayer();
    const { sdk } = fakeSdk();
    const tool = createLockQuestionsTool(data, sdk, fixtureGetGames);
    const res: LockResult = parseToolResult(await tool.handler({ game: "nope" }, SESSION));
    assert.ok(res.error);
  });

  it("errors when the Slack client is unavailable", async () => {
    const data = createInMemoryDataLayer();
    const res = await run(data, { getSlackClient: () => null });
    assert.match(res.error ?? "", /Slack client is not available/);
  });
});
