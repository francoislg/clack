import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createUpdateAnswersBlockTool } from "./updateAnswersBlock.js";
import type { RevealSlackDeps } from "./computeAnswers.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaQuestion } from "../../core/types.js";

/**
 * Tests for `update_answers_block` — the deterministic projector that edits
 * revealed question cards from file state. Card-editing behavior lives here;
 * `computeAnswers.test.ts` asserts that `compute_answers` no longer edits.
 */

const SESSION = { sessionId: "test" };

function fakeSdk(): Pick<ClackSdk, "getSlackClient" | "actionId"> {
  return {
    getSlackClient: () => null,
    actionId: (key: string) => `plugin:trivia:${key}`,
  };
}

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
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
    revealResponses: "yes",
    ...overrides,
  };
}

interface UpdateCall {
  channel: string;
  ts: string;
  blockIds: string[];
}

function capturingSlackDeps(opts: { throwOnUpdate?: boolean } = {}): {
  deps: RevealSlackDeps;
  updates: UpdateCall[];
} {
  const updates: UpdateCall[] = [];
  const deps: RevealSlackDeps = {
    isAvailable: () => null,
    fetchBotUserId: async () => "UBOT",
    fetchMessageReactions: async () => [],
    fetchUserDisplayName: async () => null,
    updateMessage: async (channel, ts, blocks) => {
      if (opts.throwOnUpdate) throw new Error("rate limited");
      updates.push({ channel, ts, blockIds: blocks.map((b) => b.block_id ?? "") });
    },
  };
  return { deps, updates };
}

function postedBooleanBlocks(questionId: string) {
  return [
    {
      type: "section" as const,
      block_id: `card:${questionId}`,
      text: { type: "mrkdwn" as const, text: "S" },
    },
    {
      type: "actions" as const,
      block_id: `vote-actions:${questionId}`,
      elements: [
        {
          type: "button" as const,
          action_id: `plugin:trivia:vote:${questionId}:true`,
          text: { type: "plain_text" as const, text: "👍 TRUE" },
        },
      ],
    },
  ];
}

function makeTool(data: ReturnType<typeof createInMemoryDataLayer>, deps: RevealSlackDeps) {
  return createUpdateAnswersBlockTool(data, fakeSdk(), fixtureGetGames, deps);
}

describe("update_answers_block — deterministic card projection", () => {
  it("edits each question's card in the batch once", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedBlocks: postedBooleanBlocks("q1") }),
    );
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 1,
    });

    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION),
    );

    assert.equal(updates.length, 1);
    assert.equal(updates[0].channel, "C100000000");
    assert.ok(!updates[0].blockIds.includes("vote-actions:q1"));
    assert.ok(updates[0].blockIds.includes("reveal-results:q1"));
    assert.ok(updates[0].blockIds.includes("reveal-see-answer-actions:q1"));
    assert.deepEqual(res.edited, ["q1"]);
  });

  it("accepts a single question id as the batch handle (legacy row)", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q_legacy", postedBlocks: postedBooleanBlocks("q_legacy") }),
    );

    const { deps, updates } = capturingSlackDeps();
    await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, batchId: "q_legacy" }, SESSION);

    assert.equal(updates.length, 1);
    assert.ok(updates[0].blockIds.includes("reveal-results:q_legacy"));
  });

  it("records an error and skips a question whose projection failed", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        batchId: "B",
        answersFormat: "choice",
        isTrue: undefined,
        choices: ["A", "B"],
        correctIndex: -1,
        postedBlocks: postedBooleanBlocks("q1"),
      }),
    );

    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION),
    );

    assert.equal(updates.length, 0);
    assert.ok(res.errors?.some((e: { questionId: string }) => e.questionId === "q1"));
  });

  it("does not abort the batch when one card's chat.update throws", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedBlocks: postedBooleanBlocks("q1") }),
    );

    const { deps } = capturingSlackDeps({ throwOnUpdate: true });
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION),
    );

    // editRevealIntoCard swallows the chat.update failure; the tool still returns.
    assert.equal(res.batchId, "B");
  });

  it("is idempotent — re-running re-projects the same card", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedBlocks: postedBooleanBlocks("q1") }),
    );

    const { deps, updates } = capturingSlackDeps();
    const tool = makeTool(data, deps);
    await tool.handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION);
    await tool.handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION);

    assert.equal(updates.length, 2);
    assert.deepEqual(updates[0].blockIds, updates[1].blockIds);
  });

  it("edits every card in a multi-question batch", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        batchId: "B",
        postedAt: 1_000,
        postedBlocks: postedBooleanBlocks("q1"),
      }),
    );
    await scoped.saveQuestion(
      makeQuestion({
        id: "q2",
        batchId: "B",
        postedAt: 1_001,
        postedBlocks: postedBooleanBlocks("q2"),
      }),
    );

    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION),
    );

    assert.equal(updates.length, 2);
    assert.deepEqual(res.edited.sort(), ["q1", "q2"]);
  });

  it("re-projects an already-judged freeform question from scored rows", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "f1",
        batchId: "B",
        answersFormat: "freeform",
        isTrue: undefined,
        expectedAnswer: "Paris",
        postedBlocks: postedBooleanBlocks("f1"),
      }),
    );
    // Already-scored freeform rows (correct !== undefined) — projectReveal must
    // build voters from these without re-judging.
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "f1",
      answerText: "Paris",
      correct: true,
      timestamp: 1,
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "f1",
      answerText: "London",
      correct: false,
      timestamp: 2,
    });

    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION),
    );

    assert.equal(updates.length, 1);
    assert.ok(updates[0].blockIds.includes("reveal-results:f1"));
    assert.deepEqual(res.edited, ["f1"]);
  });

  it("errors when the batchId matches no questions", async () => {
    const data = createInMemoryDataLayer();
    const { deps } = capturingSlackDeps();
    const out = await makeTool(data, deps).handler(
      { game: FIXTURE_GAME_NAME, batchId: "nope" },
      SESSION,
    );
    assert.ok(out.isError);
  });

  it("appends stored revealBlocks between the footer and the See-your-answer button", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        batchId: "B",
        postedBlocks: postedBooleanBlocks("q1"),
        revealBlocks: [
          { type: "section", block_id: "narrative:q1", text: { type: "mrkdwn", text: "the why" } },
        ],
      }),
    );

    const { deps, updates } = capturingSlackDeps();
    await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION);

    const ids = updates[0].blockIds;
    const footer = ids.indexOf("reveal-results:q1");
    const narrative = ids.indexOf("narrative:q1");
    const seeAnswer = ids.indexOf("reveal-see-answer-actions:q1");
    assert.ok(footer >= 0 && narrative >= 0 && seeAnswer >= 0);
    assert.ok(footer < narrative, "footer before narrative");
    assert.ok(narrative < seeAnswer, "narrative before See-your-answer");
  });

  it("is facts-only when the record has no revealBlocks", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedBlocks: postedBooleanBlocks("q1") }),
    );

    const { deps, updates } = capturingSlackDeps();
    await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION);

    const ids = updates[0].blockIds;
    assert.ok(ids.includes("reveal-results:q1"));
    assert.ok(!ids.some((id) => id.startsWith("narrative:")));
  });

  it("re-projection after re-authoring reconciles to the new narrative", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        batchId: "B",
        postedBlocks: postedBooleanBlocks("q1"),
        revealBlocks: [
          { type: "section", block_id: "narrative-v1:q1", text: { type: "mrkdwn", text: "v1" } },
        ],
      }),
    );
    const { deps, updates } = capturingSlackDeps();
    const tool = makeTool(data, deps);
    await tool.handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION);

    // Re-author the narrative (as update_question would), then re-project.
    await scoped.updateQuestion("q1", {
      revealBlocks: [
        { type: "section", block_id: "narrative-v2:q1", text: { type: "mrkdwn", text: "v2" } },
      ],
    });
    await tool.handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION);

    const second = updates[1].blockIds;
    assert.ok(second.includes("narrative-v2:q1"), "shows v2 after re-authoring");
    assert.ok(!second.includes("narrative-v1:q1"), "v1 is gone (rebuilt, not accumulated)");
  });

  it("orders footer → narrative → see-answer → tell-me-more when tellMeMore is also enabled", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        batchId: "B",
        postedBlocks: postedBooleanBlocks("q1"),
        revealBlocks: [
          { type: "section", block_id: "narrative:q1", text: { type: "mrkdwn", text: "the why" } },
        ],
      }),
    );

    const { deps, updates } = capturingSlackDeps();
    const tool = createUpdateAnswersBlockTool(data, fakeSdk(), fixtureGetGames, deps, () => ({
      tellMeMore: { enabled: true },
    }));
    await tool.handler({ game: FIXTURE_GAME_NAME, batchId: "B" }, SESSION);

    const ids = updates[0].blockIds;
    const footer = ids.indexOf("reveal-results:q1");
    const narrative = ids.indexOf("narrative:q1");
    const seeAnswer = ids.indexOf("reveal-see-answer-actions:q1");
    const tellMore = ids.indexOf("reveal-tell-me-more-actions:q1");
    assert.ok(
      [footer, narrative, seeAnswer, tellMore].every((i) => i >= 0),
      "all blocks present",
    );
    assert.ok(footer < narrative, "footer before narrative");
    assert.ok(narrative < seeAnswer, "narrative before see-answer");
    assert.ok(seeAnswer < tellMore, "see-answer before tell-me-more");
  });
});
