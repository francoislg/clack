import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createComputeAnswersTool, type RevealSlackDeps } from "./computeAnswers.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";

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

const DAY = 86_400_000;

async function seedCurrentSeason(
  data: ReturnType<typeof createInMemoryDataLayer>,
  expectedEndAt: number,
): Promise<void> {
  await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
    seasons: [{ slug: "s1", startedAt: Date.now() - DAY, expectedEndAt }],
  });
}

describe("compute_answers —showAllTimeRow", () => {
  // `revealCron` drives isLastFireOfSeason: "* * * * *" (every minute) → next fire
  // is ~now, before a future expectedEndAt → NOT the last fire; a yearly cron →
  // next fire lands far after expectedEndAt → IS the last fire. Sourced from the
  // game's own config, never from the bot-core cron-job registry.
  function toolWith(
    data: ReturnType<typeof createInMemoryDataLayer>,
    allTimeRow: "always" | "never" | "end-of-season-only",
    revealCron = "* * * * *",
  ) {
    const getGames = () =>
      fixtureGetGames().map((g) =>
        g.name === FIXTURE_GAME_NAME ? { ...g, revealCron, timezone: "UTC" } : g,
      );
    return createComputeAnswersTool(data, fakeSdk(), getGames, fakeSlackDeps(), () => ({
      allTimeRow,
    }));
  }

  async function run(tool: ReturnType<typeof createComputeAnswersTool>) {
    return parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
  }

  it("is absent when seasons are disabled (no current season)", async () => {
    const data = createInMemoryDataLayer();
    const res = await run(toolWith(data, "always"));
    assert.equal("seasonStatus" in res, false);
    assert.equal("showAllTimeRow" in res, false);
  });

  it("always → true regardless of last fire", async () => {
    const data = createInMemoryDataLayer();
    await seedCurrentSeason(data, Date.now() + DAY);
    const res = await run(toolWith(data, "always"));
    assert.equal(res.showAllTimeRow, true);
  });

  it("never → false regardless of last fire", async () => {
    const data = createInMemoryDataLayer();
    await seedCurrentSeason(data, Date.now() + DAY);
    const res = await run(toolWith(data, "never"));
    assert.equal(res.showAllTimeRow, false);
  });

  it("end-of-season-only → false on a non-last fire (no reveal job)", async () => {
    const data = createInMemoryDataLayer();
    await seedCurrentSeason(data, Date.now() + DAY);
    const res = await run(toolWith(data, "end-of-season-only"));
    assert.equal(res.showAllTimeRow, false);
  });

  it("end-of-season-only → true on the season's last fire", async () => {
    const data = createInMemoryDataLayer();
    // Season ends shortly; the game's revealCron next fires far in the future
    // (yearly), so its next fire lands AFTER expectedEndAt → this is the last fire.
    await seedCurrentSeason(data, Date.now() + 60_000);
    const res = await run(toolWith(data, "end-of-season-only", "0 0 1 1 *"));
    assert.equal(res.seasonStatus.isLastFireOfSeason, true);
    assert.equal(res.showAllTimeRow, true);
  });
});

describe("compute_answers —orchestrator", () => {
  it("returns reveals: [] when no question is pending", async () => {
    const data = createInMemoryDataLayer();
    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
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

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
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

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(res.reveals.length, 2);
    assert.ok(res.roundSummary !== undefined, "roundSummary should be present for all-yes batch");
    assert.equal(res.roundSummary.totalQuestions, 2);
    assert.equal(res.roundSummary.perPlayer.length, 1);
    assert.equal(res.roundSummary.perPlayer[0].userId, "U1");
    assert.equal(res.roundSummary.perPlayer[0].correct, 2);
  });

  it("includes `roundSummary` in EVERY reveal mode, aggregating scored answers regardless of mode", async () => {
    // revealResponses governs only per-question display — it must NOT touch the
    // scoreboard. A batch spanning yes / no / just-winners still tallies all
    // scored answers across all three questions.
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, revealResponses: "yes" }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "q2", batchId: "B", postedAt: 1_001, revealResponses: "no" }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "q3", batchId: "B", postedAt: 1_002, revealResponses: "just-winners" }),
    );
    await data.saveUser({ userId: "U1", displayName: "Alice", joinedAt: 0 });
    for (const [questionId, correct] of [
      ["q1", true],
      ["q2", true],
      ["q3", false],
    ] as const) {
      await scoped.saveAnswer({ userId: "U1", questionId, answer: true, correct, timestamp: 500 });
    }

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(res.reveals.length, 3);
    assert.ok(res.roundSummary !== undefined, "roundSummary is present in every mode");
    assert.equal(res.roundSummary.totalQuestions, 3);
    assert.equal(res.roundSummary.perPlayer.length, 1);
    assert.equal(res.roundSummary.perPlayer[0].userId, "U1");
    assert.equal(res.roundSummary.perPlayer[0].correct, 2, "correct across yes + no questions");
    assert.equal(
      res.roundSummary.perPlayer[0].answered,
      3,
      "answered all three regardless of mode",
    );
  });

  it("includes `roundSummary` with an empty perPlayer when nobody answered this round", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, revealResponses: "yes" }),
    );

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(res.reveals.length, 1);
    assert.ok(res.roundSummary !== undefined, "roundSummary is always present");
    assert.equal(res.roundSummary.totalQuestions, 1);
    assert.deepEqual(res.roundSummary.perPlayer, []);
  });

  it("excludes flagged cheaters from `roundSummary` (same scoring filter as the leaderboard)", async () => {
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
    await scoped.saveCheat({
      cheaterUserId: "U2",
      questionId: "q1",
      reason: "leaked answer",
      detectedAt: new Date(700).toISOString(),
    });

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.ok(res.roundSummary !== undefined);
    const ids = res.roundSummary.perPlayer.map((p: { userId: string }) => p.userId);
    assert.deepEqual(ids, ["U1"], "cheater U2 must be absent from the round scoreboard");
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

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
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

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
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

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
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

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    const voters = res.reveals[0].voters;
    assert.equal(voters.revealResponses, "yes");
    if (voters.revealResponses === "yes") {
      const correctIds = voters.correct.map((v: { userId: string }) => v.userId);
      assert.deepEqual(correctIds, ["U1"], "cheater U2 must be absent from correct bucket");
    }
  });

  it("reprocess re-derives EVERY answer's verdict in BOTH directions (never deletes rows)", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // isTrue: true is the corrected key; both stored rows carry STALE verdicts scored
    // against a previously-wrong key. Reprocess must recompute each one independently.
    const question = makeQuestion({
      id: "q1",
      batchId: "B",
      postedAt: 1_000,
      processedAt: 9_000, // already revealed
      isTrue: true,
      revealResponses: "yes",
    });
    await scoped.saveQuestion(question);
    // U1 answered TRUE (matches the corrected key) but is stored false → must flip UP.
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: false,
      timestamp: 500,
    });
    // U2 answered FALSE (no longer matches) but is stored true → must flip DOWN.
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "q1",
      answer: false,
      correct: true,
      timestamp: 600,
    });

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: ["q1"],
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(res.reveals.length, 1);
    assert.equal(res.reveals[0].wasReprocessed, true);

    // BOTH raw rows are RETAINED; every verdict is re-derived from the corrected key.
    const rows = (await scoped.loadAnswers()).filter((a) => a.questionId === "q1");
    assert.equal(rows.length, 2, "no row deleted");
    const u1 = rows.find((r) => r.userId === "U1");
    const u2 = rows.find((r) => r.userId === "U2");
    assert.equal(u1?.answer, true, "U1 raw click preserved");
    assert.equal(u1?.correct, true, "U1 verdict flipped UP (false → true)");
    assert.equal(u2?.answer, false, "U2 raw click preserved");
    assert.equal(u2?.correct, false, "U2 verdict flipped DOWN (true → false)");
  });

  it("reprocess skips re-derivation for hand-overridden rows but still re-derives the rest", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, processedAt: 9_000, isTrue: true }),
    );
    // U1 was hand-overridden to correct: true; their raw click (false) does NOT match the
    // key, so a naive re-derive would flip it to false. originalVerdict must shield it.
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: false,
      correct: true,
      originalVerdict: { correct: false },
      timestamp: 500,
    });
    // U2 carries a stale verdict and no override → reprocess re-derives it.
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "q1",
      answer: true,
      correct: false,
      timestamp: 600,
    });

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        reprocessQuestionIds: ["q1"],
        reprocessBatchId: undefined,
      },
      SESSION,
    );

    const rows = (await scoped.loadAnswers()).filter((a) => a.questionId === "q1");
    const u1 = rows.find((r) => r.userId === "U1");
    const u2 = rows.find((r) => r.userId === "U2");
    assert.equal(u1?.correct, true, "overridden row preserved (not recomputed against the key)");
    assert.deepEqual(u1?.originalVerdict, { correct: false }, "lock retained");
    assert.equal(u2?.correct, true, "non-overridden row re-derived from the key");
  });

  it("treats undefined-batchId questions as singleton batches", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Two legacy questions with no batchId — each is its own batch.
    await scoped.saveQuestion(makeQuestion({ id: "legacy1", postedAt: 1_000, statement: "L1" }));
    await scoped.saveQuestion(makeQuestion({ id: "legacy2", postedAt: 2_000, statement: "L2" }));

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
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

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.deepEqual(res.reveals, []);
    assert.equal(res.leaderboard.length, 1);
    assert.equal(res.leaderboard[0].userId, "U1");
    assert.equal(res.leaderboard[0].totalCorrect, 1);
  });

  describe("instructions and additionalInstructions on the result", () => {
    it("omits both when no tier sets them", async () => {
      const data = createInMemoryDataLayer();
      const tool = createComputeAnswersTool(
        data,
        fakeSdk(),
        fixtureGetGames,
        fakeSlackDeps(),
        () => ({}),
      );
      const res = parseToolResult(
        await tool.handler(
          {
            game: FIXTURE_GAME_NAME,
            reprocessQuestionIds: undefined,
            reprocessBatchId: undefined,
          },
          SESSION,
        ),
      );
      assert.equal(res.instructions, undefined);
      assert.equal(res.additionalInstructions, undefined);
    });

    it("surfaces workspace-tier instructions when set", async () => {
      const data = createInMemoryDataLayer();
      const tool = createComputeAnswersTool(
        data,
        fakeSdk(),
        fixtureGetGames,
        fakeSlackDeps(),
        () => ({ instructions: "Be funny." }),
      );
      const res = parseToolResult(
        await tool.handler(
          {
            game: FIXTURE_GAME_NAME,
            reprocessQuestionIds: undefined,
            reprocessBatchId: undefined,
          },
          SESSION,
        ),
      );
      assert.equal(res.instructions, "Be funny.");
    });

    it("concatenates additionalInstructions across workspace + game (game has it)", async () => {
      const data = createInMemoryDataLayer();
      const tool = createComputeAnswersTool(
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
        fakeSlackDeps(),
        () => ({ additionalInstructions: "Avoid politics." }),
      );
      const res = parseToolResult(
        await tool.handler(
          {
            game: FIXTURE_GAME_NAME,
            reprocessQuestionIds: undefined,
            reprocessBatchId: undefined,
          },
          SESSION,
        ),
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

      const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, {
        isAvailable: () => null,
        fetchBotUserId: async () => "UBOT",
        fetchMessageReactions: async () => [],
        fetchUserDisplayName: async (userId) => (userId === "U1" ? "NewName" : null),
        updateMessage: async () => {},
      });

      const res = parseToolResult(
        await tool.handler(
          {
            game: FIXTURE_GAME_NAME,
            reprocessQuestionIds: undefined,
            reprocessBatchId: undefined,
          },
          SESSION,
        ),
      );
      const entry = res.leaderboard.find((e: { userId: string }) => e.userId === "U1");
      assert.ok(entry !== undefined, "U1 should appear on the leaderboard");
      assert.equal(entry.displayName, "NewName", "leaderboard reflects refreshed Slack name");
      const stored = (await data.loadUsers()).get("U1");
      assert.equal(stored?.displayName, "NewName", "users.json is updated with the new name");
    });
  });
});

describe("compute_answers — reprocess re-applies current config", () => {
  const gamesWithRevealResponses = (mode: "yes" | "just-correctness") => () =>
    fixtureGetGames().map((g) =>
      g.name === FIXTURE_GAME_NAME ? { ...g, revealResponses: mode } : g,
    );

  it("re-stamps revealResponses from the current cascade", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", processedAt: 9_000, revealResponses: "yes" }),
    );
    const tool = createComputeAnswersTool(
      data,
      fakeSdk(),
      gamesWithRevealResponses("just-correctness"),
      fakeSlackDeps(),
    );

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: ["q1"],
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(res.reveals[0].voters.revealResponses, "just-correctness");
    const stored = (await scoped.loadQuestions()).find((q) => q.id === "q1");
    assert.equal(stored?.revealResponses, "just-correctness", "record re-stamped");
  });

  it("is a harmless no-op when the resolved value already matches the stamp", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", processedAt: 9_000, revealResponses: "yes" }),
    );
    const tool = createComputeAnswersTool(
      data,
      fakeSdk(),
      gamesWithRevealResponses("yes"),
      fakeSlackDeps(),
    );
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        reprocessQuestionIds: ["q1"],
        reprocessBatchId: undefined,
      },
      SESSION,
    );
    const stored = (await scoped.loadQuestions()).find((q) => q.id === "q1");
    assert.equal(stored?.revealResponses, "yes");
  });

  it("reprocessBatchId targets the whole batch in postedAt order", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q2", batchId: "B", postedAt: 2_000, processedAt: 9_000 }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000, processedAt: 9_000 }),
    );
    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());

    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: "B",
        },
        SESSION,
      ),
    );
    assert.equal(res.reveals.length, 2);
    assert.deepEqual(
      res.reveals.map((r: { questionId: string }) => r.questionId),
      ["q1", "q2"],
    );
    assert.ok(res.reveals.every((r: { wasReprocessed: boolean }) => r.wasReprocessed));
  });

  it("reveals nothing when reprocessBatchId matches no batch or id", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1", batchId: "B", processedAt: 9_000 }));
    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());
    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: "missing",
        },
        SESSION,
      ),
    );
    assert.deepEqual(res.reveals, []);
  });

  it("unions reprocessQuestionIds and reprocessBatchId", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "solo", postedAt: 500, processedAt: 9_000 }));
    await scoped.saveQuestion(
      makeQuestion({ id: "q2", batchId: "B", postedAt: 2_000, processedAt: 9_000 }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "q3", batchId: "B", postedAt: 3_000, processedAt: 9_000 }),
    );
    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());
    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: ["solo"],
          reprocessBatchId: "B",
        },
        SESSION,
      ),
    );
    assert.deepEqual(
      res.reveals.map((r: { questionId: string }) => r.questionId),
      ["solo", "q2", "q3"],
    );
  });

  it("re-stamps judgeLeniency on a freeform question from the current cascade", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const freeform: TriviaQuestion = {
      id: "f1",
      category: "C",
      statement: "Capital of France?",
      answersFormat: "freeform",
      questionType: "fact",
      expectedAnswer: "Paris",
      emojis: ["🎯"],
      createdAt: 0,
      postedAt: 1_000,
      messageLink: "https://x.slack.com/archives/C100000000/p1700000000000000",
      revealResponses: "yes",
      judgeLeniency: "strict",
      batchId: "B",
      processedAt: 9_000,
    };
    await scoped.saveQuestion(freeform);
    const getGames = () =>
      fixtureGetGames().map((g) =>
        g.name === FIXTURE_GAME_NAME ? { ...g, judgeLeniency: "lenient" as const } : g,
      );
    const tool = createComputeAnswersTool(data, fakeSdk(), getGames, fakeSlackDeps());

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        reprocessQuestionIds: ["f1"],
        reprocessBatchId: undefined,
      },
      SESSION,
    );
    const stored = (await scoped.loadQuestions()).find((q) => q.id === "f1");
    assert.equal(stored?.judgeLeniency, "lenient", "judgeLeniency re-stamped from the game tier");
  });

  it("falls back to a legacy question's id when reprocessBatchId matches no batchId", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "legacy", postedAt: 1_000, processedAt: 9_000 }));
    await scoped.saveQuestion(
      makeQuestion({ id: "other", batchId: "B", postedAt: 2_000, processedAt: 9_000 }),
    );
    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());
    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: "legacy",
        },
        SESSION,
      ),
    );
    assert.deepEqual(
      res.reveals.map((r: { questionId: string }) => r.questionId),
      ["legacy"],
    );
  });

  it("isolates a re-stamp failure: records a per-id error, skips it, processes the rest", async () => {
    const base = createInMemoryDataLayer();
    const scoped = base.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "boom", batchId: "B", postedAt: 1_000, processedAt: 9_000 }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "ok", batchId: "B", postedAt: 2_000, processedAt: 9_000 }),
    );

    // Inject a data layer whose updateQuestion throws for one question id — the
    // re-stamp persist failure should isolate to that question.
    const data: TriviaDataLayer = {
      ...base,
      forGame(name: string) {
        const inner = base.forGame(name);
        return {
          ...inner,
          updateQuestion: async (id: string, updates: Partial<TriviaQuestion>) => {
            if (id === "boom") throw new Error("disk fail");
            return inner.updateQuestion(id, updates);
          },
        };
      },
    };

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());
    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: "B",
        },
        SESSION,
      ),
    );
    assert.deepEqual(
      res.reveals.map((r: { questionId: string }) => r.questionId),
      ["ok"],
      "only the healthy question reveals",
    );
    assert.ok(
      res.errors?.some((e: { questionId: string }) => e.questionId === "boom"),
      "failed question surfaced in errors",
    );
  });
});

describe("compute_answers —hint non-leak regression", () => {
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

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());
    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
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

    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());
    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        reprocessQuestionIds: undefined,
        reprocessBatchId: undefined,
      },
      SESSION,
    );

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

describe("compute_answers — does not edit cards (projection moved to update_answers_block)", () => {
  it("never calls updateMessage during a successful reveal", async () => {
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
    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, deps);
    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );

    assert.equal(updates.length, 0);
    assert.equal(res.reveals.length, 1);
    assert.equal(res.batchId, "B");
  });
});

describe("compute_answers —image-medium attribution", () => {
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
    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());
    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
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
    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());
    const res = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
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
    const tool = createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, fakeSlackDeps());
    const raw = JSON.stringify(
      parseToolResult(
        await tool.handler(
          {
            game: FIXTURE_GAME_NAME,
            reprocessQuestionIds: undefined,
            reprocessBatchId: undefined,
          },
          SESSION,
        ),
      ),
    );
    assert.ok(!raw.includes("upload.wikimedia.org"), "upstream url must not appear");
    assert.ok(!raw.includes("wikidata:Q243"), "subjectId must not appear");
  });
});

describe("compute_answers — includeRevealInQuestions axis", () => {
  function toolWith(data: ReturnType<typeof createInMemoryDataLayer>, mode?: "yes" | "no") {
    const getGames = () =>
      fixtureGetGames().map((g) =>
        g.name === FIXTURE_GAME_NAME && mode !== undefined
          ? { ...g, includeRevealInQuestions: mode }
          : g,
      );
    return createComputeAnswersTool(data, fakeSdk(), getGames, fakeSlackDeps(), () => ({}));
  }

  async function run(tool: ReturnType<typeof createComputeAnswersTool>) {
    return parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
  }

  it("payload carries the resolved value (present even on empty reveals)", async () => {
    const data = createInMemoryDataLayer();
    const res = await run(toolWith(data, "yes"));
    assert.equal(res.reveals.length, 0);
    assert.equal(res.includeRevealInQuestions, "yes");
  });

  it("defaults to no when unset at every tier", async () => {
    const data = createInMemoryDataLayer();
    const res = await run(toolWith(data, undefined));
    assert.equal(res.includeRevealInQuestions, "no");
  });

  it("resolves fresh from current config, not from the question record", async () => {
    const data = createInMemoryDataLayer();
    // A question posted while the game resolved "no" (its record carries no axis)…
    await data
      .forGame(FIXTURE_GAME_NAME)
      .saveQuestion(makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000 }));
    // …but the game is now "yes" → compute returns the CURRENT resolution.
    const res = await run(toolWith(data, "yes"));
    assert.equal(res.includeRevealInQuestions, "yes");
  });
});

describe("compute_answers — finalRevealSummary axis", () => {
  function toolWith(
    data: ReturnType<typeof createInMemoryDataLayer>,
    mode?: "yes" | "no" | "in-thread",
  ) {
    const getGames = () =>
      fixtureGetGames().map((g) =>
        g.name === FIXTURE_GAME_NAME && mode !== undefined ? { ...g, finalRevealSummary: mode } : g,
      );
    return createComputeAnswersTool(data, fakeSdk(), getGames, fakeSlackDeps(), () => ({}));
  }

  async function run(tool: ReturnType<typeof createComputeAnswersTool>) {
    return parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
  }

  it("payload carries the resolved value (present even on empty reveals)", async () => {
    const data = createInMemoryDataLayer();
    const res = await run(toolWith(data, "in-thread"));
    assert.equal(res.reveals.length, 0);
    assert.equal(res.finalRevealSummary, "in-thread");
  });

  it("defaults to yes when unset at every tier", async () => {
    const data = createInMemoryDataLayer();
    const res = await run(toolWith(data, undefined));
    assert.equal(res.finalRevealSummary, "yes");
  });

  it("resolves fresh from current config, not from the question record", async () => {
    const data = createInMemoryDataLayer();
    await data
      .forGame(FIXTURE_GAME_NAME)
      .saveQuestion(makeQuestion({ id: "q1", batchId: "B", postedAt: 1_000 }));
    const res = await run(toolWith(data, "no"));
    assert.equal(res.finalRevealSummary, "no");
  });
});

describe("compute_answers — tagPlayers axis", () => {
  function toolWith(data: ReturnType<typeof createInMemoryDataLayer>, tagPlayers?: boolean) {
    const getGames = () =>
      fixtureGetGames().map((g) =>
        g.name === FIXTURE_GAME_NAME && tagPlayers !== undefined ? { ...g, tagPlayers } : g,
      );
    return createComputeAnswersTool(data, fakeSdk(), getGames, fakeSlackDeps(), () => ({}));
  }

  async function run(tool: ReturnType<typeof createComputeAnswersTool>) {
    return parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
  }

  it("defaults to true when unset at every tier", async () => {
    const res = await run(toolWith(createInMemoryDataLayer(), undefined));
    assert.equal(res.tagPlayers, true);
  });

  it("payload carries the resolved game-tier value", async () => {
    const res = await run(toolWith(createInMemoryDataLayer(), false));
    assert.equal(res.tagPlayers, false);
  });
});

describe("compute_answers — predictions & invalidation", () => {
  const FAKE_REACTIONS: RevealSlackDeps = {
    isAvailable: () => null,
    fetchBotUserId: async () => "UBOT",
    fetchMessageReactions: async () => [],
    fetchUserDisplayName: async () => null,
    updateMessage: async () => {},
  };

  function predictionTool(data: ReturnType<typeof createInMemoryDataLayer>) {
    return createComputeAnswersTool(data, fakeSdk(), fixtureGetGames, FAKE_REACTIONS);
  }
  function runDefault(t: ReturnType<typeof createComputeAnswersTool>) {
    return t.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined, reprocessBatchId: undefined },
      SESSION,
    );
  }

  it("refuses to score while a prediction is still pending (resolved:false)", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "pred",
        batchId: "B",
        questionType: "prediction",
        isTrue: undefined,
        resolved: false,
      }),
    );
    const res = parseToolResult(await runDefault(predictionTool(data)));
    assert.match(res.error, /UNDECIDED_PREDICTIONS/);
    const after = await scoped.loadQuestions();
    assert.equal(after.find((q) => q.id === "pred")?.processedAt, undefined);
  });

  it("scores a settled prediction and derives the verdict on its pending answer rows", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "pred",
        batchId: "B",
        questionType: "prediction",
        isTrue: true,
        resolved: true,
      }),
    );
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "pred",
      answer: true,
      correct: undefined,
      timestamp: 1,
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "pred",
      answer: false,
      correct: undefined,
      timestamp: 2,
    });

    const res = parseToolResult(await runDefault(predictionTool(data)));
    assert.equal(res.reveals.length, 1);
    const answers = await scoped.loadAnswers();
    assert.equal(answers.find((a) => a.userId === "U1")?.correct, true);
    assert.equal(answers.find((a) => a.userId === "U2")?.correct, false);
  });

  it("surfaces an invalidated question, stamps processedAt, and never scores it", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "void1",
        batchId: "B",
        invalidated: true,
        invalidatedReason: "match postponed",
      }),
    );
    const res = parseToolResult(await runDefault(predictionTool(data)));
    assert.equal(res.reveals.length, 0);
    assert.equal(res.invalidatedQuestions.length, 1);
    assert.equal(res.invalidatedQuestions[0].invalidatedReason, "match postponed");
    const after = await scoped.loadQuestions();
    assert.notEqual(after.find((q) => q.id === "void1")?.processedAt, undefined);
  });
});
