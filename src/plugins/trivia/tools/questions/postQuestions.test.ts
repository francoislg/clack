import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPostQuestionsTool, type PostQuestionsSlackDeps } from "./postQuestions.js";
import { getAnswerTypeHandler } from "../../answerTypes/registry.js";

const actionIdFn = (k: string): string => `plugin:trivia:${k}`;
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";
import type { z } from "zod";
import { BlockSchema } from "../../../../slack/blockSchema.js";
import type { SlackBlocks } from "../../../../slack/blocks.js";

type ZodBlock = z.infer<typeof BlockSchema>;

const SESSION = { sessionId: "test" };
const FIXTURE_CHANNEL = "C100000000";

function fakeSdk(): Pick<ClackSdk, "getSlackClient" | "actionId" | "t"> {
  return {
    getSlackClient: () => null,
    actionId: (key: string) => `plugin:trivia:${key}`,
    t: (key: string) => key,
  };
}

interface FakeSlackOpts {
  postResults?: Array<{ ts: string; permalink: string } | { error: string }>;
  unavailableError?: string;
}

interface FakeSlackCalls {
  postBlocksCalls: Array<{
    channel: string;
    blocks: SlackBlocks;
    suppressUnfurls?: boolean;
  }>;
}

function fakeSlackDeps(opts: FakeSlackOpts = {}): {
  deps: PostQuestionsSlackDeps;
  calls: FakeSlackCalls;
} {
  const calls: FakeSlackCalls = { postBlocksCalls: [] };
  let postIdx = 0;
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
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["⚡"],
    createdAt: 100,
  };
  const q: TriviaQuestion = { ...defaults, ...overrides };
  await data.forGame(FIXTURE_GAME_NAME).saveQuestion(q);
  return q;
}

const SAMPLE_BLOCKS: ZodBlock[] = [{ type: "section", text: { type: "mrkdwn", text: "Q?" } }];

/**
 * Narrow a SlackBlocks element to a button-bearing actions block. Returns the
 * elements array for direct inspection by tests, or throws if the tail block
 * isn't shaped like a button-actions block — which means the test setup is
 * wrong, not the production code.
 */
function tailButtons(
  blocks: SlackBlocks,
): Array<{ action_id?: string; text?: { text?: string }; style?: string }> {
  const last = blocks[blocks.length - 1];
  if (last === undefined || last.type !== "actions" || !("elements" in last)) {
    throw new Error(`expected an actions block at the tail, got ${last?.type ?? "nothing"}`);
  }
  return last.elements;
}

describe("answer-type handler buttons", () => {
  it("appends two vote buttons for a boolean question", () => {
    const q: TriviaQuestion = {
      id: "QB",
      category: "C",
      statement: "s",
      answersFormat: "boolean",
      questionType: "fact",
      isTrue: true,
      emojis: ["⚡"],
      createdAt: 0,
    };
    const blocks = getAnswerTypeHandler(q.answersFormat).appendActionsBlock([], actionIdFn, q);
    assert.equal(blocks.length, 1);
    const buttons = tailButtons(blocks);
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].action_id, "plugin:trivia:vote:QB:true");
    assert.equal(buttons[0].text?.text, "👍 TRUE");
    assert.equal(buttons[1].action_id, "plugin:trivia:vote:QB:false");
    assert.equal(buttons[1].text?.text, "👎 FALSE");
  });

  it("appends numbered choice buttons sized to choices.length", () => {
    const q: TriviaQuestion = {
      id: "QC",
      category: "C",
      statement: "s",
      answersFormat: "choice",
      questionType: "fact",
      choices: ["The Beatles", "Led Zeppelin", "Cream"],
      correctIndex: 0,
      emojis: ["⚡"],
      createdAt: 0,
    };
    const blocks = getAnswerTypeHandler(q.answersFormat).appendActionsBlock([], actionIdFn, q);
    const buttons = tailButtons(blocks);
    assert.equal(buttons.length, 3);
    assert.equal(buttons[0].action_id, "plugin:trivia:vote:QC:0");
    assert.equal(buttons[0].text?.text, "1️⃣ The Beatles");
    assert.equal(buttons[1].action_id, "plugin:trivia:vote:QC:1");
    assert.equal(buttons[1].text?.text, "2️⃣ Led Zeppelin");
    assert.equal(buttons[2].action_id, "plugin:trivia:vote:QC:2");
    assert.equal(buttons[2].text?.text, "3️⃣ Cream");
  });

  it("appends the Answer button for a freeform question", () => {
    const q: TriviaQuestion = {
      id: "QF",
      category: "C",
      statement: "s",
      answersFormat: "freeform",
      questionType: "fact",
      expectedAnswer: "Paris",
      emojis: ["⚡"],
      createdAt: 0,
    };
    const blocks = getAnswerTypeHandler(q.answersFormat).appendActionsBlock([], actionIdFn, q);
    const buttons = tailButtons(blocks);
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].action_id, "plugin:trivia:freeform-answer:QF");
    assert.equal(buttons[0].text?.text, "Answer");
    assert.equal(buttons[0].style, "primary");
  });

  it("treats absent answersFormat as boolean (legacy rows)", () => {
    const q: TriviaQuestion = {
      id: "QL",
      category: "C",
      statement: "s",
      questionType: "fact",
      isTrue: true,
      emojis: ["⚡"],
      createdAt: 0,
    };
    const blocks = getAnswerTypeHandler(q.answersFormat).appendActionsBlock([], actionIdFn, q);
    const buttons = tailButtons(blocks);
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].action_id, "plugin:trivia:vote:QL:true");
  });
});

describe("post_questions tool", () => {
  it("posts a boolean question and stamps the record (no reactions attached)", async () => {
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
        suppress_unfurls: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.results[0].ok, true);
    assert.equal(body.results[0].permalink, "https://x.slack.com/p1");
    assert.equal(calls.postBlocksCalls.length, 1);
    assert.equal(calls.postBlocksCalls[0].channel, FIXTURE_CHANNEL);

    const stored = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions())[0];
    assert.equal(stored.postedAt, 1700000000123);
    assert.equal(stored.messageLink, "https://x.slack.com/p1");
    assert.ok(stored.postedBlocks !== undefined);
    const last = stored.postedBlocks?.[stored.postedBlocks.length - 1];
    assert.equal(last?.type, "actions");
  });

  it("stamps liveAnswersVisible and revealResponses from the cascade default", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });

    const { deps } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
        suppress_unfurls: undefined,
      },
      SESSION,
    );

    const stored = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions())[0];
    assert.equal(stored.liveAnswersVisible, true);
    assert.equal(stored.revealResponses, "yes");
  });

  it("multi-item batch posts each question independently", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });
    await seedQuestion(data, { id: "Q2" });

    const { deps, calls } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [
          { questionId: "Q1", blocks: SAMPLE_BLOCKS },
          { questionId: "Q2", blocks: SAMPLE_BLOCKS },
        ],
        appendToPreviousBatch: undefined,
        suppress_unfurls: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.results.length, 2);
    assert.equal(body.results[0].ok, true);
    assert.equal(body.results[1].ok, true);
    assert.equal(calls.postBlocksCalls.length, 2);
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
        suppress_unfurls: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.equal(body.results[0].ok, true);
    assert.equal(body.results[0].permalink, "https://existing.slack.com/p1");
    assert.equal(calls.postBlocksCalls.length, 0);

    const stored = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions())[0];
    assert.equal(stored.postedAt, 1000);
  });

  it("rejects an unknown game", async () => {
    const data = createInMemoryDataLayer();
    const { deps, calls } = fakeSlackDeps();
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: "no-such-game",
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
        suppress_unfurls: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.match(body.error, /Unknown game/);
    assert.equal(calls.postBlocksCalls.length, 0);
  });

  it("returns Slack-unavailable error before any per-item work", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "Q1" });

    const { deps, calls } = fakeSlackDeps({ unavailableError: "Slack disconnected" });
    const tool = createPostQuestionsTool(data, fakeSdk(), fixtureGetGames, deps);

    const result = await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "Q1", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: undefined,
        suppress_unfurls: undefined,
      },
      SESSION,
    );

    const body = parseToolResult(result);
    assert.match(body.error, /Slack disconnected/);
    assert.equal(calls.postBlocksCalls.length, 0);
  });

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
        suppress_unfurls: undefined,
      },
      SESSION,
    );

    const stored = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
    const q1 = stored.find((q) => q.id === "Q1");
    const q2 = stored.find((q) => q.id === "Q2");
    assert.ok(q1?.batchId !== undefined && q1.batchId.length > 0);
    assert.equal(q1?.batchId, q2?.batchId);
  });
});
