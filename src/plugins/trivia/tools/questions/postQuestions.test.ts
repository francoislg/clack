import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createPostQuestionsTool,
  deriveReactions,
  type PostQuestionsSlackDeps,
} from "./postQuestions.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";
import type { z } from "zod";
import { BlockSchema } from "../../../../slack/blockSchema.js";
import type { SlackBlocks } from "../../../../slack/blocks.js";

// The Zod-inferred Block type. The strict `Block` type exported from
// blockSchema.ts uses different index signatures and doesn't structurally
// satisfy the tool handler's input.
type ZodBlock = z.infer<typeof BlockSchema>;

const SESSION = { sessionId: "test" };

// FIXTURE_GAMES.channel — kept in sync with testHelpers.ts.
const FIXTURE_CHANNEL = "C100000000";

function fakeSdk(): Pick<ClackSdk, "getSlackClient"> {
  // Slack deps are injected directly in tests, so the sdk's getSlackClient is never called.
  return { getSlackClient: () => null };
}

interface FakeSlackOpts {
  /** Map of `postCallIndex` → ts to return. Defaults to a fresh ts per call. */
  postResults?: Array<{ ts: string; permalink: string } | { error: string }>;
  /** When set, addReactions throws this error on its first call. */
  addReactionsError?: string;
  /** When set, isAvailable returns this string instead of null. */
  unavailableError?: string;
}

interface FakeSlackCalls {
  postBlocksCalls: Array<{ channel: string; blocks: SlackBlocks }>;
  addReactionsCalls: Array<{ channel: string; ts: string; reactions: string[] }>;
}

function fakeSlackDeps(opts: FakeSlackOpts = {}): {
  deps: PostQuestionsSlackDeps;
  calls: FakeSlackCalls;
} {
  const calls: FakeSlackCalls = { postBlocksCalls: [], addReactionsCalls: [] };
  let postIdx = 0;
  let addCallIdx = 0;
  const deps: PostQuestionsSlackDeps = {
    isAvailable() {
      return opts.unavailableError ?? null;
    },
    async postBlocks(args) {
      calls.postBlocksCalls.push(args);
      const result = opts.postResults?.[postIdx];
      postIdx++;
      if (result === undefined) {
        const idx = calls.postBlocksCalls.length;
        return {
          ts: `1700000${String(idx).padStart(3, "0")}.000000`,
          permalink: `https://test.slack.com/archives/${args.channel}/p1700000${String(idx).padStart(3, "0")}000000`,
        };
      }
      if ("error" in result) {
        throw new Error(result.error);
      }
      return result;
    },
    async addReactions(channel, ts, reactions) {
      calls.addReactionsCalls.push({ channel, ts, reactions });
      if (opts.addReactionsError && addCallIdx === 0) {
        addCallIdx++;
        throw new Error(opts.addReactionsError);
      }
      addCallIdx++;
    },
  };
  return { deps, calls };
}

async function seedQuestion(
  data: TriviaDataLayer,
  overrides: Partial<TriviaQuestion> & { id: string },
): Promise<TriviaQuestion> {
  const defaults: TriviaQuestion = {
    id: overrides.id,
    category: "Trivia",
    statement: "is this true?",
    type: "boolean",
    isTrue: true,
    emojis: ["⚡"],
    createdAt: 100,
  };
  const q: TriviaQuestion = { ...defaults, ...overrides };
  await data.forGame(FIXTURE_GAME_NAME).saveQuestion(q);
  return q;
}

const SAMPLE_BLOCKS: ZodBlock[] = [{ type: "section", text: { type: "mrkdwn", text: "Q?" } }];

describe("deriveReactions", () => {
  it("returns ['+1', '-1'] for boolean questions", () => {
    const q: TriviaQuestion = {
      id: "x",
      category: "C",
      statement: "s",
      type: "boolean",
      isTrue: true,
      emojis: ["⚡"],
      createdAt: 0,
    };
    assert.deepEqual(deriveReactions(q), ["+1", "-1"]);
  });

  it("returns ['+1', '-1'] when type is absent (legacy boolean)", () => {
    const q: TriviaQuestion = {
      id: "x",
      category: "C",
      statement: "s",
      isTrue: true,
      emojis: ["⚡"],
      createdAt: 0,
    };
    assert.deepEqual(deriveReactions(q), ["+1", "-1"]);
  });

  it("returns numbered reactions sized to choices.length for choice questions", () => {
    const choices2: TriviaQuestion = {
      id: "x",
      category: "C",
      statement: "s",
      type: "choice",
      choices: ["a", "b"],
      correctIndex: 0,
      emojis: ["⚡"],
      createdAt: 0,
    };
    assert.deepEqual(deriveReactions(choices2), ["one", "two"]);

    const choices3 = { ...choices2, choices: ["a", "b", "c"] };
    assert.deepEqual(deriveReactions(choices3), ["one", "two", "three"]);

    const choices4 = { ...choices2, choices: ["a", "b", "c", "d"] };
    assert.deepEqual(deriveReactions(choices4), ["one", "two", "three", "four"]);
  });
});

describe("post_questions tool", () => {
  it("posts a boolean question, stamps the record, attaches ['+1', '-1'] reactions", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });

    const { deps, calls } = fakeSlackDeps({
      postResults: [{ ts: "1700000000.123456", permalink: "https://x.slack.com/p1" }],
    });
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].questionId, "Q1");
    assert.equal(body.results[0].ok, true);
    assert.equal(body.results[0].ts, "1700000000.123456");
    assert.equal(body.results[0].permalink, "https://x.slack.com/p1");

    assert.equal(calls.postBlocksCalls.length, 1);
    assert.equal(calls.postBlocksCalls[0].channel, FIXTURE_CHANNEL);
    assert.deepEqual(calls.postBlocksCalls[0].blocks, SAMPLE_BLOCKS);

    assert.equal(calls.addReactionsCalls.length, 1);
    assert.equal(calls.addReactionsCalls[0].channel, FIXTURE_CHANNEL);
    assert.equal(calls.addReactionsCalls[0].ts, "1700000000.123456");
    assert.deepEqual(calls.addReactionsCalls[0].reactions, ["+1", "-1"]);

    const stored = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions())[0];
    assert.equal(stored.postedAt, 1700000000123); // floor(1700000000.123456 * 1000)
    assert.equal(stored.messageLink, "https://x.slack.com/p1");
  });

  it("derives ['one', 'two', 'three'] for a 3-choice question", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q3",
      type: "choice",
      isTrue: undefined,
      choices: ["a", "b", "c"],
      correctIndex: 1,
    });

    const { deps, calls } = fakeSlackDeps({
      postResults: [{ ts: "1700000001.000000", permalink: "https://x/p3" }],
    });
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q3", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    assert.deepEqual(calls.addReactionsCalls[0].reactions, ["one", "two", "three"]);
  });

  it("derives ['one', 'two', 'three', 'four'] for a 4-choice question", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q4",
      type: "choice",
      isTrue: undefined,
      choices: ["a", "b", "c", "d"],
      correctIndex: 2,
    });

    const { deps, calls } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q4", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    assert.deepEqual(calls.addReactionsCalls[0].reactions, ["one", "two", "three", "four"]);
  });

  it("multi-item batch posts and stamps each question independently", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });
    await seedQuestion(data, { id: "Q2" });
    await seedQuestion(data, { id: "Q3" });

    const { deps, calls } = fakeSlackDeps({
      postResults: [
        { ts: "1700000001.000000", permalink: "https://x/p1" },
        { ts: "1700000002.000000", permalink: "https://x/p2" },
        { ts: "1700000003.000000", permalink: "https://x/p3" },
      ],
    });
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [
          { questionId: "Q1", blocks: SAMPLE_BLOCKS },
          { questionId: "Q2", blocks: SAMPLE_BLOCKS },
          { questionId: "Q3", blocks: SAMPLE_BLOCKS },
        ],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.results.length, 3);
    for (const r of body.results) {
      assert.equal(r.ok, true);
    }
    assert.equal(body.results[0].ts, "1700000001.000000");
    assert.equal(body.results[1].ts, "1700000002.000000");
    assert.equal(body.results[2].ts, "1700000003.000000");

    assert.equal(calls.postBlocksCalls.length, 3);

    const stored = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    assert.equal(stored.find((q) => q.id === "Q1")?.messageLink, "https://x/p1");
    assert.equal(stored.find((q) => q.id === "Q2")?.messageLink, "https://x/p2");
    assert.equal(stored.find((q) => q.id === "Q3")?.messageLink, "https://x/p3");
  });

  it("skips an already-posted question (idempotency)", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q1",
      postedAt: 1000,
      messageLink: "https://existing.slack.com/p1",
    });

    const { deps, calls } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.results[0].ok, true);
    assert.equal(body.results[0].permalink, "https://existing.slack.com/p1");
    assert.match(body.results[0].ts, /^1\.000000$/);

    // No Slack calls made.
    assert.equal(calls.postBlocksCalls.length, 0);
    assert.equal(calls.addReactionsCalls.length, 0);

    // Record unchanged.
    const stored = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions())[0];
    assert.equal(stored.postedAt, 1000);
    assert.equal(stored.messageLink, "https://existing.slack.com/p1");
  });

  it("per-item failure does not abort the batch", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });
    await seedQuestion(data, { id: "Q2" });

    const { deps, calls } = fakeSlackDeps({
      postResults: [
        { ts: "1700000001.000000", permalink: "https://x/p1" },
        // Q3 is not in the data, so postBlocks is never called for it.
        { ts: "1700000002.000000", permalink: "https://x/p2" },
      ],
    });
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [
          { questionId: "Q1", blocks: SAMPLE_BLOCKS },
          { questionId: "Q3-missing", blocks: SAMPLE_BLOCKS },
          { questionId: "Q2", blocks: SAMPLE_BLOCKS },
        ],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.results.length, 3);
    assert.equal(body.results[0].ok, true);
    assert.equal(body.results[1].ok, false);
    assert.match(body.results[1].error, /not found/);
    assert.equal(body.results[2].ok, true);

    // Only Q1 and Q2 hit Slack; Q3-missing was caught before any Slack call.
    assert.equal(calls.postBlocksCalls.length, 2);
  });

  it("rejects an unknown game before any Slack call", async () => {
    const data = createInMemoryDataLayer();
    const { deps, calls } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: "no-such-game",
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    assert.equal(result.isError, true);
    assert.equal(calls.postBlocksCalls.length, 0);
  });

  it("rejects a disabled game", async () => {
    const data = createInMemoryDataLayer();
    const disabledGames = () =>
      [
        {
          name: "retired",
          channel: "C_R",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          enabled: false,
        },
      ] as const;
    const { deps, calls } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), disabledGames, deps);

    const result = await tool.handler(
      {
        game: "retired",
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    assert.equal(result.isError, true);
    assert.equal(calls.postBlocksCalls.length, 0);
  });

  it("returns Slack-unavailable error before any per-item work", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });
    const { deps, calls } = fakeSlackDeps({
      unavailableError: "Slack client is not available.",
    });
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    assert.equal(result.isError, true);
    assert.equal(calls.postBlocksCalls.length, 0);
  });

  it("stamp persists even when reaction-add throws", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });
    const { deps } = fakeSlackDeps({
      postResults: [{ ts: "1700000001.500000", permalink: "https://x/p1" }],
      addReactionsError: "rate_limited",
    });
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.results[0].ok, true);

    const stored = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions())[0];
    assert.equal(stored.postedAt, 1700000001500);
    assert.equal(stored.messageLink, "https://x/p1");
  });

  it("uses the channel from game config, not from args", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });
    const customGames = () =>
      [
        {
          name: "main",
          channel: "C_CUSTOM_CHANNEL",
          questionCron: "0 9 * * *",
          revealCron: "0 17 * * *",
          timezone: "UTC",
          enabled: true,
        },
      ] as const;
    const { deps, calls } = fakeSlackDeps({
      postResults: [{ ts: "1.0", permalink: "https://x/p" }],
    });
    const tool = createPostQuestionsTool(data, fakeSdk(), customGames, deps);

    await tool.handler(
      {
        game: "main",
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    assert.equal(calls.postBlocksCalls[0].channel, "C_CUSTOM_CHANNEL");
  });
});

describe("post_questions tool — batchId", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("stamps a shared batchId on every fresh item in one call", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });
    await seedQuestion(data, { id: "Q2" });

    const { deps } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [
          { questionId: "Q1", blocks: SAMPLE_BLOCKS },
          { questionId: "Q2", blocks: SAMPLE_BLOCKS },
        ],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    const stored = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    const q1 = stored.find((q) => q.id === "Q1");
    const q2 = stored.find((q) => q.id === "Q2");
    assert.ok(q1?.batchId, "Q1 must have a batchId");
    assert.ok(q2?.batchId, "Q2 must have a batchId");
    assert.match(q1.batchId, UUID_RE);
    assert.equal(q1.batchId, q2.batchId, "both items in the same call share one batchId");
  });

  it("idempotent-skipped item keeps its original batchId", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q1",
      postedAt: 1000,
      messageLink: "https://existing/p1",
      batchId: "preexisting-batch",
    });
    await seedQuestion(data, { id: "Q2" });

    const { deps } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [
          { questionId: "Q1", blocks: SAMPLE_BLOCKS },
          { questionId: "Q2", blocks: SAMPLE_BLOCKS },
        ],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    const stored = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    const q1 = stored.find((q) => q.id === "Q1");
    const q2 = stored.find((q) => q.id === "Q2");
    assert.equal(q1?.batchId, "preexisting-batch", "skipped item retains its original batchId");
    assert.ok(q2?.batchId, "fresh item gets a batchId");
    assert.notEqual(q2.batchId, "preexisting-batch", "fresh item's batchId is a new UUID");
    assert.match(q2.batchId, UUID_RE);
  });

  it("batchId is independent across separate calls", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });
    await seedQuestion(data, { id: "Q2" });

    const { deps } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q2", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    const stored = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    const q1Batch = stored.find((q) => q.id === "Q1")?.batchId;
    const q2Batch = stored.find((q) => q.id === "Q2")?.batchId;
    assert.ok(q1Batch);
    assert.ok(q2Batch);
    assert.notEqual(q1Batch, q2Batch, "separate calls produce different batchIds");
  });

  it("when every item is idempotent-skipped, no batchId mutation occurs", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q1",
      postedAt: 1000,
      messageLink: "https://existing/p1",
      batchId: "batch-aaaa",
    });
    await seedQuestion(data, {
      id: "Q2",
      postedAt: 2000,
      messageLink: "https://existing/p2",
      batchId: "batch-bbbb",
    });

    const { deps, calls } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [
          { questionId: "Q1", blocks: SAMPLE_BLOCKS },
          { questionId: "Q2", blocks: SAMPLE_BLOCKS },
        ],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );

    assert.equal(calls.postBlocksCalls.length, 0, "no Slack posts on full-skip");
    const stored = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    assert.equal(stored.find((q) => q.id === "Q1")?.batchId, "batch-aaaa");
    assert.equal(stored.find((q) => q.id === "Q2")?.batchId, "batch-bbbb");
  });
});

describe("post_questions tool — appendToPreviousBatch", () => {
  it("reuses the most-recent batch's UUID when the flag is true", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q1",
      postedAt: 1000,
      messageLink: "https://existing/p1",
      batchId: "batch-AAA",
    });
    await seedQuestion(data, {
      id: "Q2",
      postedAt: 2000,
      messageLink: "https://existing/p2",
      batchId: "batch-AAA",
    });
    await seedQuestion(data, { id: "Q3" });

    const { deps } = fakeSlackDeps({
      postResults: [{ ts: "1700000003.000000", permalink: "https://x/p3" }],
    });
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q3", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: true,
      },
      SESSION,
    );

    const stored = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    assert.equal(stored.find((q) => q.id === "Q3")?.batchId, "batch-AAA");
    assert.equal(stored.find((q) => q.id === "Q1")?.batchId, "batch-AAA");
    assert.equal(stored.find((q) => q.id === "Q2")?.batchId, "batch-AAA");
  });

  it("default behavior is preserved when the flag is absent or false", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q1",
      postedAt: 1000,
      messageLink: "https://existing/p1",
      batchId: "batch-AAA",
    });
    await seedQuestion(data, { id: "Q2" });

    // First sub-call: flag absent.
    const { deps: depsA } = fakeSlackDeps({
      postResults: [{ ts: "1700000002.000000", permalink: "https://x/p2" }],
    });
    const toolA = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, depsA);
    await toolA.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q2", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
      },
      SESSION,
    );
    const afterAbsent = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions()).find(
      (q) => q.id === "Q2",
    );
    assert.ok(afterAbsent?.batchId, "Q2 must have a batchId");
    assert.notEqual(
      afterAbsent.batchId,
      "batch-AAA",
      "absent flag must NOT reuse the previous batch",
    );

    // Second sub-call: flag explicitly false on a fresh question Q3.
    await seedQuestion(data, { id: "Q3" });
    const { deps: depsB } = fakeSlackDeps({
      postResults: [{ ts: "1700000003.000000", permalink: "https://x/p3" }],
    });
    const toolB = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, depsB);
    await toolB.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q3", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: false,
      },
      SESSION,
    );
    const afterFalse = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions()).find(
      (q) => q.id === "Q3",
    );
    assert.ok(afterFalse?.batchId);
    assert.notEqual(
      afterFalse.batchId,
      "batch-AAA",
      "false flag must NOT reuse the previous batch",
    );
  });

  it("most-recent batch is the group with the largest max(postedAt)", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q1",
      postedAt: 100,
      messageLink: "x",
      batchId: "batch-OLD",
    });
    await seedQuestion(data, {
      id: "Q2",
      postedAt: 200,
      messageLink: "x",
      batchId: "batch-OLD",
    });
    await seedQuestion(data, {
      id: "Q3",
      postedAt: 150,
      messageLink: "x",
      batchId: "batch-NEW",
    });
    await seedQuestion(data, {
      id: "Q4",
      postedAt: 300,
      messageLink: "x",
      batchId: "batch-NEW",
    });
    await seedQuestion(data, { id: "Q5" });

    const { deps } = fakeSlackDeps({
      postResults: [{ ts: "1700000005.000000", permalink: "https://x/p5" }],
    });
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q5", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: true,
      },
      SESSION,
    );

    const q5 = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions()).find((q) => q.id === "Q5");
    assert.equal(q5?.batchId, "batch-NEW", "should pick the batch with the largest max(postedAt)");
  });

  it("multiple fresh items in one append-mode call all share the resolved batchId", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q1",
      postedAt: 1000,
      messageLink: "x",
      batchId: "batch-AAA",
    });
    await seedQuestion(data, { id: "Q4" });
    await seedQuestion(data, { id: "Q5" });

    const { deps } = fakeSlackDeps({
      postResults: [
        { ts: "1700000004.000000", permalink: "https://x/p4" },
        { ts: "1700000005.000000", permalink: "https://x/p5" },
      ],
    });
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [
          { questionId: "Q4", blocks: SAMPLE_BLOCKS },
          { questionId: "Q5", blocks: SAMPLE_BLOCKS },
        ],
        appendToPreviousBatch: true,
      },
      SESSION,
    );

    const stored = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    assert.equal(stored.find((q) => q.id === "Q4")?.batchId, "batch-AAA");
    assert.equal(stored.find((q) => q.id === "Q5")?.batchId, "batch-AAA");
  });

  it("rejects atomically when the previous batch has a revealed question", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q1",
      postedAt: 1000,
      messageLink: "x",
      batchId: "batch-AAA",
      processedAt: 5000,
    });
    await seedQuestion(data, {
      id: "Q2",
      postedAt: 1500,
      messageLink: "x",
      batchId: "batch-AAA",
    });
    await seedQuestion(data, { id: "Q3" });

    const { deps, calls } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q3", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: true,
      },
      SESSION,
    );

    assert.equal(result.isError, true, "expected top-level error result");
    const errorText = JSON.stringify(result);
    assert.match(errorText, /batch-AAA/);
    assert.match(errorText, /Q1/);
    assert.equal(calls.postBlocksCalls.length, 0, "no Slack post should be made");

    const q3 = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions()).find((q) => q.id === "Q3");
    assert.equal(q3?.postedAt, undefined, "Q3 must NOT be stamped");
    assert.equal(q3?.batchId, undefined, "Q3 must NOT receive a batchId");
  });

  it("rejects atomically when no previous batch exists", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" }); // no batchId, no postedAt

    const { deps, calls } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: true,
      },
      SESSION,
    );

    assert.equal(result.isError, true);
    const errorText = JSON.stringify(result);
    assert.match(errorText, new RegExp(FIXTURE_GAME_NAME));
    assert.equal(calls.postBlocksCalls.length, 0);

    const q1 = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions()).find((q) => q.id === "Q1");
    assert.equal(q1?.postedAt, undefined);
    assert.equal(q1?.batchId, undefined);
  });

  it("short-circuits before idempotent-skip when the previous batch is already revealed", async () => {
    const data = createInMemoryDataLayer();
    // The most-recent batch has been revealed.
    await seedQuestion(data, {
      id: "Q1",
      postedAt: 5000,
      messageLink: "x",
      batchId: "batch-AAA",
      processedAt: 6000,
    });
    // Items in the call are themselves already posted (would normally be idempotent-skipped).
    await seedQuestion(data, {
      id: "Q2",
      postedAt: 2000,
      messageLink: "https://existing/p2",
      batchId: "batch-BBB",
    });

    const { deps, calls } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q2", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: true,
      },
      SESSION,
    );

    // Should be a top-level error (NOT a `results` array with idempotent-ok entries).
    assert.equal(result.isError, true);
    const errorText = JSON.stringify(result);
    assert.match(errorText, /batch-AAA/);
    assert.equal(calls.postBlocksCalls.length, 0);
  });
});
