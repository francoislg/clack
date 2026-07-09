import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createComputeAnswersTool, type RevealSlackDeps } from "./tools/reveal/computeAnswers.js";
import { createRefreshQuestionCardsTool } from "./tools/reveal/refreshQuestionCards.js";
import { createStartNewSeasonTool } from "./tools/seasons/startNewSeason.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "./testHelpers.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import type { ClackSdk } from "../sdk.js";
import type { TriviaQuestion } from "./core/types.js";

/**
 * INTEGRATION test for the reveal flow. Unlike the per-tool unit files
 * (`computeAnswers.test.ts`, `refreshQuestionCards.test.ts`, `startNewSeason.test.ts`),
 * this wires all three real tools against ONE shared in-memory data layer and ONE
 * shared Slack seam — exactly as the scheduled reveal prompt chains them:
 *
 *   compute_answers → refresh_question_cards(questionIds) → start_new_season (last fire only)
 *
 * It is the end-to-end safety net the refactor's design called for: the split must
 * reproduce the old monolith's observable result (cards edited, leaderboard/round
 * summary correct, season rolled over on the last fire — and ONLY then), and the
 * chain must be safely replayable (no double card-edit, no double rollover of an
 * already-closed season). The orchestration responsibility moved into the prompt,
 * so nothing else asserts the tools compose correctly against shared state.
 */

const SESSION = { sessionId: "test" };
const DAY = 86_400_000;

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

interface UpdateCall {
  channel: string;
  ts: string;
  blockIds: string[];
}

/** One Slack seam shared by compute_answers AND refresh_question_cards, capturing every chat.update. */
function capturingSlackDeps(): { deps: RevealSlackDeps; updates: UpdateCall[] } {
  const updates: UpdateCall[] = [];
  const deps: RevealSlackDeps = {
    isAvailable: () => null,
    fetchBotUserId: async () => "UBOT",
    fetchMessageReactions: async () => [],
    fetchUserDisplayName: async () => null,
    updateMessage: async (channel, ts, blocks) => {
      updates.push({ channel, ts, blockIds: blocks.map((b) => b.block_id ?? "") });
    },
  };
  return { deps, updates };
}

/** Game fixture with a tunable revealCron — the axis that drives isLastFireOfSeason. */
function getGamesWithCron(revealCron: string) {
  return () =>
    fixtureGetGames().map((g) =>
      g.name === FIXTURE_GAME_NAME ? { ...g, revealCron, timezone: "UTC" } : g,
    );
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

type Data = ReturnType<typeof createInMemoryDataLayer>;

function tools(data: Data, deps: RevealSlackDeps, revealCron: string) {
  const sdk = fakeSdk();
  const getGames = getGamesWithCron(revealCron);
  const noConfig = () => ({});
  return {
    compute: createComputeAnswersTool(data, sdk, getGames, deps, noConfig),
    update: createRefreshQuestionCardsTool(data, sdk, getGames, deps, noConfig),
    startNewSeason: createStartNewSeasonTool(data, getGames),
  };
}

async function seedCurrentSeason(data: Data, expectedEndAt: number): Promise<void> {
  await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState({
    seasons: [{ slug: "s1", startedAt: Date.now() - DAY, expectedEndAt }],
  });
}

describe("reveal flow integration — compute → update → start_new_season", () => {
  it("mid-season fire: scores, edits the batch's cards, and leaves the season open", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // "* * * * *" → next fire ≈ now, well before a +DAY end → NOT the last fire.
    await seedCurrentSeason(data, Date.now() + DAY);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", batchId: "B", postedBlocks: postedBooleanBlocks("q1") }),
    );
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 1,
      season: "s1",
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "q1",
      answer: false,
      correct: false,
      timestamp: 2,
      season: "s1",
    });

    const { deps, updates } = capturingSlackDeps();
    const { compute, update } = tools(data, deps, "* * * * *");

    // ── Step 1: compute_answers (the scorer) ──────────────────────────────
    const computed = parseToolResult(
      await compute.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(computed.reveals.length, 1);
    assert.equal(computed.reveals[0].questionId, "q1");
    assert.equal(computed.seasonStatus.isLastFireOfSeason, false);
    // Leaderboard reflects the scored answers (U1 correct, U2 wrong).
    const u1 = computed.leaderboard.find((e: { userId: string }) => e.userId === "U1");
    const u2 = computed.leaderboard.find((e: { userId: string }) => e.userId === "U2");
    assert.equal(u1.totalCorrect, 1);
    assert.equal(u2.totalCorrect, 0);
    // compute is the WRITER: it stamps processedAt — but it touches NO Slack card.
    assert.equal(updates.length, 0);
    const afterCompute = await scoped.loadQuestions();
    assert.notEqual(afterCompute.find((q) => q.id === "q1")?.processedAt, undefined);

    // ── Step 2: refresh_question_cards (the projector) ──────────────────────
    const edited = parseToolResult(
      await update.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionIds: computed.reveals.map((r: { questionId: string }) => r.questionId),
        },
        SESSION,
      ),
    );
    assert.deepEqual(edited.edited, ["q1"]);
    assert.equal(updates.length, 1);
    assert.ok(!updates[0].blockIds.includes("vote-actions:q1"));
    assert.ok(updates[0].blockIds.includes("reveal-results:q1"));

    // ── No rollover on a mid-season fire: season s1 stays open. ───────────
    const state = await scoped.loadSeasonsState();
    assert.equal(state?.seasons.find((s) => s.slug === "s1")?.endedAt, undefined);
  });

  it("last fire: compute reports it, start_new_season is what closes the season and queues the continuation", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Season ends shortly; a yearly cron next-fires far past that → the last fire.
    await seedCurrentSeason(data, Date.now() + 60_000);
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
    const { compute, update, startNewSeason } = tools(data, deps, "0 0 1 1 *");

    const computed = parseToolResult(
      await compute.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(computed.seasonStatus.isLastFireOfSeason, true);
    // compute REPORTS the last fire but performs NO rollover itself.
    assert.equal(computed.seasonStatus.seasonClosed, false);
    assert.equal(
      (await scoped.loadSeasonsState())?.seasons.find((s) => s.slug === "s1")?.endedAt,
      undefined,
    );

    await update.handler(
      {
        game: FIXTURE_GAME_NAME,
        questionIds: computed.reveals.map((r: { questionId: string }) => r.questionId),
      },
      SESSION,
    );
    assert.equal(updates.length, 1);

    // ── Step 3: start_new_season (the only step that mutates season state) ─
    const rolled = parseToolResult(
      await startNewSeason.handler({ game: FIXTURE_GAME_NAME, force: undefined }, SESSION),
    );
    assert.equal(rolled.seasonClosed, true);
    assert.equal(rolled.closedSlug, "s1");
    assert.notEqual(rolled.newSeasonStarted, undefined);

    const state = await scoped.loadSeasonsState();
    assert.notEqual(state?.seasons.find((s) => s.slug === "s1")?.endedAt, undefined);
    assert.equal(
      state?.seasons.some((s) => s.slug === rolled.newSeasonStarted.slug),
      true,
    );
  });

  it("replay is safe: re-running update re-projects identically and the closed season is never re-closed", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await seedCurrentSeason(data, Date.now() + 60_000);
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
    const { compute, update, startNewSeason } = tools(data, deps, "0 0 1 1 *");

    const computed = parseToolResult(
      await compute.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    await update.handler(
      {
        game: FIXTURE_GAME_NAME,
        questionIds: computed.reveals.map((r: { questionId: string }) => r.questionId),
      },
      SESSION,
    );
    await startNewSeason.handler({ game: FIXTURE_GAME_NAME, force: undefined }, SESSION);

    const closedAt = (await scoped.loadSeasonsState())?.seasons.find(
      (s) => s.slug === "s1",
    )?.endedAt;
    assert.notEqual(closedAt, undefined);

    // Re-run the projector: same card, no duplicate edits beyond the re-render.
    await update.handler(
      {
        game: FIXTURE_GAME_NAME,
        questionIds: computed.reveals.map((r: { questionId: string }) => r.questionId),
      },
      SESSION,
    );
    assert.equal(updates.length, 2);
    assert.deepEqual(updates[0].blockIds, updates[1].blockIds);

    // Re-run rollover: s1's close stamp is irreversible-once — never re-applied.
    await startNewSeason.handler({ game: FIXTURE_GAME_NAME, force: undefined }, SESSION);
    const reclosedAt = (await scoped.loadSeasonsState())?.seasons.find(
      (s) => s.slug === "s1",
    )?.endedAt;
    assert.equal(reclosedAt, closedAt);
  });

  it("batches drain one per fire across successive chained runs", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        batchId: "B1",
        postedAt: 1_000,
        postedBlocks: postedBooleanBlocks("q1"),
      }),
    );
    await scoped.saveQuestion(
      makeQuestion({
        id: "q2",
        batchId: "B2",
        postedAt: 2_000,
        postedBlocks: postedBooleanBlocks("q2"),
      }),
    );

    const { deps, updates } = capturingSlackDeps();
    const { compute, update } = tools(data, deps, "* * * * *");

    // Fire 1 drains the oldest batch (B1) only.
    const first = parseToolResult(
      await compute.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.deepEqual(
      first.reveals.map((r: { questionId: string }) => r.questionId),
      ["q1"],
    );
    await update.handler(
      {
        game: FIXTURE_GAME_NAME,
        questionIds: first.reveals.map((r: { questionId: string }) => r.questionId),
      },
      SESSION,
    );

    // Fire 2 drains the next batch (B2), leaving the already-revealed B1 alone.
    const second = parseToolResult(
      await compute.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.deepEqual(
      second.reveals.map((r: { questionId: string }) => r.questionId),
      ["q2"],
    );
    await update.handler(
      {
        game: FIXTURE_GAME_NAME,
        questionIds: second.reveals.map((r: { questionId: string }) => r.questionId),
      },
      SESSION,
    );

    assert.deepEqual(
      updates.map((u) => u.blockIds.find((b) => b.startsWith("reveal-results:"))),
      ["reveal-results:q1", "reveal-results:q2"],
    );

    // Fire 3 has nothing left to drain.
    const third = parseToolResult(
      await compute.handler(
        {
          game: FIXTURE_GAME_NAME,
          reprocessQuestionIds: undefined,
          reprocessBatchId: undefined,
        },
        SESSION,
      ),
    );
    assert.deepEqual(third.reveals, []);
  });
});
