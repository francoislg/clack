import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createProcessRevealAnswersTool, type RevealSlackDeps } from "./processRevealAnswers.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaQuestion } from "../../core/types.js";

/**
 * Orchestrator-level tests for `process_reveal_answers`. Per-handler reveal behavior
 * (mode-specific voter bucket emission, message-link parsing, freeform judging) lives
 * in `answerTypes/{boolean,choice,freeform}.test.ts`. This file covers the layer ABOVE
 * those handlers: which questions are selected per fire, how multi-question batches
 * compose, when `roundSummary` is included vs omitted, and reprocess-mode dispatch.
 */

const SESSION = { sessionId: "test" };

function fakeSdk(): Pick<ClackSdk, "getSlackClient" | "askClaude" | "actionId"> {
  return {
    getSlackClient: () => null,
    askClaude: async () => ({
      text: "",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
    actionId: (key: string) => `plugin:trivia:${key}`,
  };
}

function fakeSlackDeps(): RevealSlackDeps {
  return {
    isAvailable: () => null,
    fetchBotUserId: async () => "UBOT",
    fetchMessageReactions: async () => [],
    fetchUserDisplayName: async () => null,
    updateMessage: async () => {},
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

describe("process_reveal_answers — orchestrator", () => {
  it("returns reveals: [] when no question is pending", async () => {
    const data = createInMemoryDataLayer();
    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.deepEqual(res.reveals, []);
    assert.ok("leaderboard" in res);
  });

  it("processes only the oldest pending batch and leaves later batches alone", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Batch A: older. Batch B: newer.
    await scoped.saveQuestion(
      makeQuestion({ id: "a1", postedAt: 1_000, batchId: "batch-A", statement: "A1" }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "a2", postedAt: 2_000, batchId: "batch-A", statement: "A2" }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "b1", postedAt: 3_000, batchId: "batch-B", statement: "B1" }),
    );

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    const revealedIds = res.reveals.map((r: { questionId: string }) => r.questionId).sort();
    assert.deepEqual(revealedIds, ["a1", "a2"], "only batch A should reveal");

    // Batch A's questions are stamped processedAt; B's is untouched.
    const after = await scoped.loadQuestions();
    const byId = new Map(after.map((q) => [q.id, q]));
    assert.ok(byId.get("a1")?.processedAt !== undefined);
    assert.ok(byId.get("a2")?.processedAt !== undefined);
    assert.equal(byId.get("b1")?.processedAt, undefined);
  });

  it("includes top-level `roundSummary` when every reveal entry is revealResponses: 'yes'", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, revealResponses: "yes" }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "q2", batchId: "B", postedAt: 1_001, revealResponses: "yes" }),
    );
    await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 0 });
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 500,
    });
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q2",
      answer: true,
      correct: true,
      timestamp: 600,
    });

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(res.reveals.length, 2);
    assert.ok(res.roundSummary !== undefined, "roundSummary should be present for all-yes batch");
    assert.equal(res.roundSummary.totalQuestions, 2);
    assert.equal(res.roundSummary.perPlayer.length, 1);
    assert.equal(res.roundSummary.perPlayer[0].userId, "U1");
    assert.equal(res.roundSummary.perPlayer[0].correct, 2);
  });

  it("OMITS top-level `roundSummary` when any reveal entry is non-'yes'", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, revealResponses: "yes" }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "q2", batchId: "B", postedAt: 1_001, revealResponses: "no" }),
    );
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 500,
    });

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(res.reveals.length, 2);
    assert.equal(
      res.roundSummary,
      undefined,
      "roundSummary must be omitted when any entry is non-yes",
    );
  });

  it("OMITS roundSummary when any entry is 'just-correctness' too (not only 'no')", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, revealResponses: "yes" }),
    );
    await scoped.saveQuestion(
      makeQuestion({
        id: "q2",
        batchId: "B",
        postedAt: 1_001,
        revealResponses: "just-correctness",
      }),
    );

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(res.reveals.length, 2);
    assert.equal(res.roundSummary, undefined);
  });

  it("emits voters.revealResponses === 'no' with reactions-only shape (no correct/incorrect/noAnswer)", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, revealResponses: "no" }),
    );
    // Even with answers in the store, "no" mode strips per-user vote info.
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 500,
    });

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(res.reveals.length, 1);
    const voters = res.reveals[0].voters;
    assert.equal(voters.revealResponses, "no");
    // Discriminated union: 'no' carries only `reactions`.
    assert.equal("correct" in voters, false);
    assert.equal("incorrect" in voters, false);
    assert.equal("noAnswer" in voters, false);
    assert.ok("reactions" in voters);
  });

  it("emits voters.revealResponses === 'just-winners' naming winners and counting missers anonymously", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, revealResponses: "just-winners" }),
    );
    await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 0 });
    await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 0 });
    await data.saveUser({ userId: "U3", displayName: "Carol", joinedAt: 0 });
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 500,
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "q1",
      answer: false,
      correct: false,
      timestamp: 600,
    });
    await scoped.saveAnswer({
      userId: "U3",
      questionId: "q1",
      answer: false,
      correct: false,
      timestamp: 700,
    });

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    const voters = res.reveals[0].voters;
    assert.equal(voters.revealResponses, "just-winners");
    if (voters.revealResponses === "just-winners") {
      assert.deepEqual(
        voters.correct.map((v: { userId: string }) => v.userId),
        ["U1"],
        "only the correct voter is named",
      );
      assert.equal(voters.incorrectCount, 2, "two missers counted anonymously");
      assert.equal(voters.noAnswerCount, 0);
    }
    // The named incorrect/noAnswer arrays must be physically absent.
    assert.equal("incorrect" in voters, false);
    assert.equal("noAnswer" in voters, false);
  });

  it("just-winners with everyone wrong yields empty correct + positive incorrectCount", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, revealResponses: "just-winners" }),
    );
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: false,
      correct: false,
      timestamp: 500,
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "q1",
      answer: false,
      correct: false,
      timestamp: 600,
    });

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    const voters = res.reveals[0].voters;
    assert.equal(voters.revealResponses, "just-winners");
    if (voters.revealResponses === "just-winners") {
      assert.deepEqual(voters.correct, [], "nobody got it right");
      assert.equal(voters.incorrectCount, 2);
    }
  });

  it("excludes flagged cheaters from voter buckets", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, revealResponses: "yes" }),
    );
    await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 0 });
    await data.saveUser({ userId: "U2", displayName: "Bob", joinedAt: 0 });
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 500,
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 600,
    });
    // Bob is flagged as a cheater.
    await scoped.saveCheat({
      cheaterUserId: "U2",
      questionId: "q1",
      reason: "leaked answer",
      detectedAt: new Date(700).toISOString(),
    });

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    const voters = res.reveals[0].voters;
    assert.equal(voters.revealResponses, "yes");
    if (voters.revealResponses === "yes") {
      const correctIds = voters.correct.map((v: { userId: string }) => v.userId);
      assert.deepEqual(correctIds, ["U1"], "cheater U2 must be absent from correct bucket");
    }
  });

  it("reprocess mode hard-deletes prior boolean/choice answers before re-scoring", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const question = makeQuestion({
      id: "q1",
      batchId: "B",
      postedAt: 1_000,
      processedAt: 9_000, // already revealed
      revealResponses: "yes",
    });
    await scoped.saveQuestion(question);
    // Pre-existing scored answer that should be wiped by reprocess.
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 500,
    });

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: ["q1"] }, SESSION),
    );
    assert.equal(res.reveals.length, 1);
    assert.equal(res.reveals[0].wasReprocessed, true);

    // The prior answer was deleted (then nothing re-derived since there are no current stored
    // clicks in this in-memory scenario beyond the deleted one). Verifies the destructive wipe.
    const remaining = (await scoped.loadAnswers()).filter((a) => a.questionId === "q1");
    assert.equal(remaining.length, 0);
  });

  it("treats undefined-batchId questions as singleton batches", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Two legacy questions with no batchId — each is its own batch.
    await scoped.saveQuestion(makeQuestion({ id: "legacy1", postedAt: 1_000, statement: "L1" }));
    await scoped.saveQuestion(makeQuestion({ id: "legacy2", postedAt: 2_000, statement: "L2" }));

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(res.reveals.length, 1, "only the oldest singleton legacy question reveals");
    assert.equal(res.reveals[0].questionId, "legacy1");
  });

  it("includes leaderboard regardless of reveals length", async () => {
    const data = createInMemoryDataLayer();
    await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 0 });
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Stamp some history (no pending questions).
    const historical = makeQuestion({
      id: "old",
      postedAt: 100,
      processedAt: 200,
    });
    await scoped.saveQuestion(historical);
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "old",
      answer: true,
      correct: true,
      timestamp: 150,
    });

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.deepEqual(res.reveals, []);
    assert.equal(res.leaderboard.length, 1);
    assert.equal(res.leaderboard[0].userId, "U1");
    assert.equal(res.leaderboard[0].totalCorrect, 1);
  });

  describe("instructions and additionalInstructions on the result", () => {
    it("omits both when no tier sets them", async () => {
      const data = createInMemoryDataLayer();
      const tool = createProcessRevealAnswersTool(
        data,
        fakeSdk(),
        fixtureGetGames,
        async () => [],
        fakeSlackDeps(),
        () => ({}),
      );
      const res = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
      );
      assert.equal(res.instructions, undefined);
      assert.equal(res.additionalInstructions, undefined);
    });

    it("surfaces workspace-tier instructions when set", async () => {
      const data = createInMemoryDataLayer();
      const tool = createProcessRevealAnswersTool(
        data,
        fakeSdk(),
        fixtureGetGames,
        async () => [],
        fakeSlackDeps(),
        () => ({ instructions: "Be funny." }),
      );
      const res = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
      );
      assert.equal(res.instructions, "Be funny.");
    });

    it("concatenates additionalInstructions across workspace + game (game has it)", async () => {
      const data = createInMemoryDataLayer();
      const tool = createProcessRevealAnswersTool(
        data,
        fakeSdk(),
        () => [
          {
            name: FIXTURE_GAME_NAME,
            channel: "C1",
            questionCron: "0 9 * * *",
            revealCron: "0 17 * * *",
            timezone: "UTC",
            additionalInstructions: "Be concise.",
          },
        ],
        async () => [],
        fakeSlackDeps(),
        () => ({ additionalInstructions: "Avoid politics." }),
      );
      const res = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
      );
      assert.equal(res.additionalInstructions, "[Workspace] Avoid politics.\n\n[Game] Be concise.");
    });
  });

  describe("display-name refresh", () => {
    it("propagates a refreshed Slack display name into the leaderboard", async () => {
      const data = createInMemoryDataLayer();
      const scoped = data.forGame(FIXTURE_GAME_NAME);
      await scoped.saveQuestion(
        makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, revealResponses: "yes" }),
      );
      await data.saveUser({ userId: "U1", displayName: "OldName", joinedAt: 0 });
      await scoped.saveAnswer({
        userId: "U1",
        questionId: "q1",
        answer: true,
        correct: true,
        timestamp: 500,
      });

      const tool = createProcessRevealAnswersTool(
        data,
        fakeSdk(),
        fixtureGetGames,
        async () => [],
        {
          isAvailable: () => null,
          fetchBotUserId: async () => "UBOT",
          fetchMessageReactions: async () => [],
          fetchUserDisplayName: async (userId) => (userId === "U1" ? "NewName" : null),
          updateMessage: async () => {},
        },
      );

      const res = parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
      );
      const entry = res.leaderboard.find((e: { userId: string }) => e.userId === "U1");
      assert.ok(entry !== undefined, "U1 should appear on the leaderboard");
      assert.equal(entry.displayName, "NewName", "leaderboard reflects refreshed Slack name");
      const stored = (await data.loadUsers()).get("U1");
      assert.equal(stored?.displayName, "NewName", "users.json is updated with the new name");
    });
  });
});

describe("process_reveal_answers — hint non-leak regression", () => {
  it("does NOT surface hint.text, hint.mode, or hint.clickedBy in the reveal payload", async () => {
    const data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
    const scoped = data.forGame(FIXTURE_GAME_NAME);

    await scoped.saveQuestion(
      makeQuestion({
        id: "q-with-hint",
        batchId: "B",
        hint: {
          mode: "button",
          text: "Think about a primary color.",
          clickedBy: ["U-hinter-1", "U-hinter-2"],
        },
      }),
    );

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );
    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );

    const serialized = JSON.stringify(res);
    assert.equal(serialized.includes("Think about a primary color"), false);
    assert.equal(serialized.includes("U-hinter-1"), false);
    assert.equal(serialized.includes("U-hinter-2"), false);
    assert.equal(serialized.includes("clickedBy"), false);
    if ("roundSummary" in res && typeof res.roundSummary === "object") {
      const roundSerialized = JSON.stringify(res.roundSummary);
      assert.equal(roundSerialized.includes("Think about a primary color"), false);
      assert.equal(roundSerialized.includes("clickedBy"), false);
    }
  });

  it("clickedBy on the persisted record survives the reveal pass intact (audit trail)", async () => {
    const data = createInMemoryDataLayer();
    await data.saveCategories(["Science"]);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const originalClickedBy = ["U-hinter-1", "U-hinter-2"];

    await scoped.saveQuestion(
      makeQuestion({
        id: "q-with-hint",
        batchId: "B",
        hint: {
          mode: "button",
          text: "Think about a primary color.",
          clickedBy: originalClickedBy,
        },
      }),
    );

    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );
    await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION);

    const post = (await scoped.loadQuestions()).find((q) => q.id === "q-with-hint");
    assert.deepEqual(post?.hint?.clickedBy, originalClickedBy);
  });
});

interface UpdateCall {
  channel: string;
  ts: string;
  blockIds: string[];
}

/** Slack deps that capture `updateMessage` calls (and can be made to throw). */
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

describe("process_reveal_answers — static reveal card edit", () => {
  it("edits each revealed question's card once", async () => {
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
    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      deps,
    );
    await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION);

    assert.equal(updates.length, 1);
    assert.equal(updates[0].channel, "C100000000");
    assert.ok(!updates[0].blockIds.includes("vote-actions:q1"));
    assert.ok(updates[0].blockIds.includes("reveal-results:q1"));
    assert.ok(updates[0].blockIds.includes("reveal-see-answer-actions:q1"));
  });

  it("does not edit a question whose processing errored", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Choice question with an invalid correctIndex → processReveal returns an error.
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        answersFormat: "choice",
        isTrue: undefined,
        choices: ["A", "B"],
        correctIndex: -1,
        postedBlocks: postedBooleanBlocks("q1"),
      }),
    );

    const { deps, updates } = capturingSlackDeps();
    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      deps,
    );
    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );

    assert.equal(updates.length, 0);
    assert.ok(res.errors?.some((e: { questionId: string }) => e.questionId === "q1"));
  });

  it("returns the payload even when the card edit fails", async () => {
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

    const { deps } = capturingSlackDeps({ throwOnUpdate: true });
    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      deps,
    );
    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );

    assert.equal(res.reveals.length, 1);
    assert.ok(Array.isArray(res.leaderboard));
  });

  it("repaints the card on reprocess", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        batchId: "B",
        postedAt: 1000,
        processedAt: 5000,
        postedBlocks: postedBooleanBlocks("q1"),
      }),
    );
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 1,
    });

    const { deps, updates } = capturingSlackDeps();
    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      deps,
    );
    await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: ["q1"] }, SESSION);

    assert.equal(updates.length, 1);
    assert.ok(updates[0].blockIds.includes("reveal-results:q1"));
  });
});

describe("process_reveal_answers — image-medium attribution", () => {
  const MEDIA = {
    kind: "image" as const,
    url: "https://upload.wikimedia.org/secret-path/thumb.jpg",
    altText: "a landmark",
    subjectId: "wikidata:Q243",
    title: "Eiffel Tower",
    license: "CC-BY-SA 4.0",
    attribution: "Jane Doe",
  };

  it("surfaces media { title, attribution, license } on the reveal entry", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "img",
        batchId: "B",
        postedAt: 1_000,
        promptMedium: "image",
        media: MEDIA,
      }),
    );
    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );
    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.deepEqual(res.reveals[0].media, {
      title: "Eiffel Tower",
      attribution: "Jane Doe",
      license: "CC-BY-SA 4.0",
    });
  });

  it("omits media on text-medium questions", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "txt", batchId: "B", postedAt: 1_000 }));
    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );
    const res = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(res.reveals[0].media, undefined);
  });

  it("never leaks the upstream url or subjectId into the payload", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "img",
        batchId: "B",
        postedAt: 1_000,
        promptMedium: "image",
        media: MEDIA,
      }),
    );
    const tool = createProcessRevealAnswersTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      async () => [],
      fakeSlackDeps(),
    );
    const raw = JSON.stringify(
      parseToolResult(
        await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
      ),
    );
    assert.ok(!raw.includes("upload.wikimedia.org"), "upstream url must not appear");
    assert.ok(!raw.includes("wikidata:Q243"), "subjectId must not appear");
  });
});
