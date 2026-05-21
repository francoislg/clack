import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createProcessRevealAnswersTool, type RevealSlackDeps } from "./processRevealAnswers.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { ClackSdk } from "../../../sdk.js";
import type {
  TriviaDataLayer,
  TriviaQuestion,
  SubmittedAnswer,
  SeasonsState,
} from "../../core/types.js";
import type { SlackReactionLike } from "./types.js";
import type { CronJob } from "../../../../cronJobs.js";

const SESSION = { sessionId: "test" };

// `null` from sdk.getSlackClient() is fine here; the test always overrides slackDeps so
// the production default-deps factory never resolves the (null) client.
function makeFakeSdk(
  askClaudeImpl: ClackSdk["askClaude"] = async () => {
    throw new Error("askClaude not stubbed for this test");
  },
): Pick<ClackSdk, "getSlackClient" | "askClaude"> {
  return {
    getSlackClient: () => null,
    askClaude: askClaudeImpl,
  };
}

/**
 * Build a fake `RevealSlackDeps` that returns the supplied reactions for any
 * channel/ts pair, plus a configurable bot user ID. Tests stub Slack purely
 * through this seam.
 */
function makeSlackDeps(
  reactionsByMessage: Map<string, SlackReactionLike[]>,
  botUserId = "B_BOT",
): RevealSlackDeps {
  return {
    isAvailable: () => null,
    fetchBotUserId: async () => botUserId,
    fetchMessageReactions: async (_channel, ts) => reactionsByMessage.get(ts) ?? [],
  };
}

const PERMALINK_BASE = "https://workspace.slack.com/archives/C100000000/p";

/** Build a Slack permalink whose embedded `ts` matches `ts`. */
function permalink(ts: string): string {
  // Take "1700000000.123456" → "1700000000123456"
  const digits = ts.replace(".", "").padEnd(16, "0");
  return `${PERMALINK_BASE}${digits}`;
}

interface QuestionSeed {
  id: string;
  category?: string;
  statement?: string;
  type?: "boolean" | "choice";
  isTrue?: boolean;
  choices?: string[];
  correctIndex?: number;
  emojis?: string[];
  createdAt?: number;
  postedAt?: number;
  processedAt?: number;
  batchId?: string;
  ts: string; // canonical Slack ts string
}

async function seedQuestion(data: TriviaDataLayer, seed: QuestionSeed): Promise<void> {
  const q: TriviaQuestion = {
    id: seed.id,
    category: seed.category ?? "Trivia",
    statement: seed.statement ?? "is true?",
    answersFormat: seed.type,
    questionType: "fact",
    sourceUrl: undefined,
    eventDate: undefined,
    context: undefined,
    isTrue: seed.isTrue,
    choices: seed.choices,
    correctIndex: seed.correctIndex,
    emojis: seed.emojis ?? ["⚡"],
    createdAt: seed.createdAt ?? 100,
    postedAt: seed.postedAt ?? 200,
    messageLink: permalink(seed.ts),
    processedAt: seed.processedAt,
    batchId: seed.batchId,
  };
  await data.forGame(FIXTURE_GAME_NAME).saveQuestion(q);
}

async function flagCheater(
  data: TriviaDataLayer,
  userId: string,
  questionId: string,
): Promise<void> {
  await data.forGame(FIXTURE_GAME_NAME).saveCheat({
    cheaterUserId: userId,
    questionId,
    reason: "test",
    detectedAt: new Date().toISOString(),
  });
}

async function getQuestion(data: TriviaDataLayer, id: string): Promise<TriviaQuestion | undefined> {
  const all = await data.forGame(FIXTURE_GAME_NAME).loadQuestions();
  return all.find((q) => q.id === id);
}

async function getAnswers(data: TriviaDataLayer): Promise<SubmittedAnswer[]> {
  return data.forGame(FIXTURE_GAME_NAME).loadAnswers();
}

// No-jobs loader for tests that don't exercise the reveal-cron lookup.
const noJobs = async (): Promise<CronJob[]> => [];

describe("process_reveal_answers — default mode", () => {
  it("processes the oldest pending question, stamps processedAt, returns a single reveal", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.123456", postedAt: 200 });

    const reactions = new Map<string, SlackReactionLike[]>([
      [
        "1700000000.123456",
        [
          { emoji: "+1", users: ["U_alice", "U_bob"] },
          { emoji: "-1", users: ["U_carol"] },
        ],
      ],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined },
      SESSION,
    );
    const body = parseToolResult(result);

    assert.equal(body.reveals.length, 1);
    assert.equal(body.reveals[0].questionId, "q1");
    assert.equal(body.reveals[0].wasReprocessed, false);
    assert.equal(body.reveals[0].answer.type, "boolean");
    assert.equal(body.reveals[0].answer.isTrue, true);
    assert.equal(body.reveals[0].voters.correct.length, 2);
    assert.equal(body.reveals[0].voters.incorrect.length, 1);

    const refreshed = await getQuestion(data, "q1");
    assert.ok(refreshed?.processedAt !== undefined);
  });

  it("returns reveals: [] when no pending question and still returns a leaderboard", async () => {
    const data = createInMemoryDataLayer();
    // No questions seeded.
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(new Map()),
    );
    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined },
      SESSION,
    );
    const body = parseToolResult(result);
    assert.deepEqual(body.reveals, []);
    assert.deepEqual(body.leaderboard, []);
  });

  it("one batch of three pending questions reveals all three in postedAt order", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q1",
      isTrue: true,
      postedAt: 100,
      ts: "1700000001.000000",
      batchId: "batch-A",
    });
    await seedQuestion(data, {
      id: "Q2",
      isTrue: true,
      postedAt: 200,
      ts: "1700000002.000000",
      batchId: "batch-A",
    });
    await seedQuestion(data, {
      id: "Q3",
      isTrue: true,
      postedAt: 300,
      ts: "1700000003.000000",
      batchId: "batch-A",
    });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000001.000000", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000002.000000", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000003.000000", [{ emoji: "+1", users: ["U1"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined },
      SESSION,
    );
    const body = parseToolResult(result);

    assert.equal(body.reveals.length, 3);
    assert.deepEqual(
      body.reveals.map((r: { questionId: string }) => r.questionId),
      ["Q1", "Q2", "Q3"],
    );
    for (const id of ["Q1", "Q2", "Q3"]) {
      assert.ok((await getQuestion(data, id))?.processedAt !== undefined, `${id} stamped`);
    }
  });

  it("oldest batch wins when two batches are pending; younger batch stays pending", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "A1",
      isTrue: true,
      postedAt: 100,
      ts: "1700000001.000000",
      batchId: "batch-A",
    });
    await seedQuestion(data, {
      id: "A2",
      isTrue: true,
      postedAt: 110,
      ts: "1700000001.100000",
      batchId: "batch-A",
    });
    await seedQuestion(data, {
      id: "B1",
      isTrue: true,
      postedAt: 500,
      ts: "1700000005.000000",
      batchId: "batch-B",
    });
    await seedQuestion(data, {
      id: "B2",
      isTrue: true,
      postedAt: 510,
      ts: "1700000005.100000",
      batchId: "batch-B",
    });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000001.000000", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000001.100000", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000005.000000", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000005.100000", [{ emoji: "+1", users: ["U1"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );

    assert.equal(body.reveals.length, 2);
    assert.deepEqual(
      body.reveals.map((r: { questionId: string }) => r.questionId),
      ["A1", "A2"],
    );
    assert.ok((await getQuestion(data, "B1"))?.processedAt === undefined);
    assert.ok((await getQuestion(data, "B2"))?.processedAt === undefined);
  });

  it("successive fires drain the backlog one batch at a time", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "A1",
      isTrue: true,
      postedAt: 100,
      ts: "1700000001.000000",
      batchId: "batch-A",
    });
    await seedQuestion(data, {
      id: "B1",
      isTrue: true,
      postedAt: 500,
      ts: "1700000005.000000",
      batchId: "batch-B",
    });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000001.000000", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000005.000000", [{ emoji: "+1", users: ["U1"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const first = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(first.reveals.length, 1);
    assert.equal(first.reveals[0].questionId, "A1");

    const second = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(second.reveals.length, 1);
    assert.equal(second.reveals[0].questionId, "B1");
  });

  it("legacy pending row without batchId is treated as a singleton", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "Q_legacy",
      isTrue: true,
      postedAt: 50,
      ts: "1700000000.500000",
      // batchId omitted
    });
    await seedQuestion(data, {
      id: "fresh1",
      isTrue: true,
      postedAt: 200,
      ts: "1700000002.000000",
      batchId: "batch-A",
    });
    await seedQuestion(data, {
      id: "fresh2",
      isTrue: true,
      postedAt: 210,
      ts: "1700000002.100000",
      batchId: "batch-A",
    });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.500000", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000002.000000", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000002.100000", [{ emoji: "+1", users: ["U1"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );

    assert.equal(body.reveals.length, 1);
    assert.equal(body.reveals[0].questionId, "Q_legacy");
    assert.ok((await getQuestion(data, "fresh1"))?.processedAt === undefined);
    assert.ok((await getQuestion(data, "fresh2"))?.processedAt === undefined);
  });

  it("two legacy rows without batchId do not merge into one group", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "legacy_old",
      isTrue: true,
      postedAt: 50,
      ts: "1700000000.500000",
    });
    await seedQuestion(data, {
      id: "legacy_newer",
      isTrue: true,
      postedAt: 150,
      ts: "1700000001.500000",
    });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.500000", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000001.500000", [{ emoji: "+1", users: ["U1"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );

    assert.equal(body.reveals.length, 1);
    assert.equal(body.reveals[0].questionId, "legacy_old");
    assert.ok((await getQuestion(data, "legacy_newer"))?.processedAt === undefined);
  });

  it("idempotency: second default-mode call returns reveals:[] after the first stamped processedAt", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.123456" });
    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.123456", [{ emoji: "+1", users: ["U1"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION);
    const before = (await getQuestion(data, "q1"))?.processedAt;

    const second = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined },
      SESSION,
    );
    const body = parseToolResult(second);
    assert.deepEqual(body.reveals, []);

    const after = (await getQuestion(data, "q1"))?.processedAt;
    assert.equal(after, before, "processedAt is not re-stamped on the no-op second call");
  });
});

describe("process_reveal_answers — exclusions", () => {
  it("strips the bot's userId from every voter bucket", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.111111" });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.111111", [{ emoji: "+1", users: ["B_BOT", "U_alice"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions, "B_BOT"),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    const allUserIds = [
      ...body.reveals[0].voters.correct,
      ...body.reveals[0].voters.incorrect,
      ...body.reveals[0].voters.fenceSitters,
      ...body.reveals[0].voters.wildcards,
    ].map((v: { userId: string }) => v.userId);
    assert.ok(!allUserIds.includes("B_BOT"));
    assert.ok(allUserIds.includes("U_alice"));
  });

  it("silently excludes cheaters from voter buckets AND from persisted answers", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.111111" });
    await flagCheater(data, "U_cheater", "q1");

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.111111", [{ emoji: "+1", users: ["U_alice", "U_cheater"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    const allUserIds = [
      ...body.reveals[0].voters.correct,
      ...body.reveals[0].voters.incorrect,
      ...body.reveals[0].voters.fenceSitters,
      ...body.reveals[0].voters.wildcards,
    ].map((v: { userId: string }) => v.userId);
    assert.ok(!allUserIds.includes("U_cheater"));

    const answers = await getAnswers(data);
    assert.ok(!answers.some((a) => a.userId === "U_cheater"));
    assert.ok(answers.some((a) => a.userId === "U_alice"));
  });

  it("multi-react voters on a choice question are silently voided", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "qc",
      type: "choice",
      correctIndex: 0,
      choices: ["A", "B", "C"],
      ts: "1700000000.222222",
    });

    const reactions = new Map<string, SlackReactionLike[]>([
      [
        "1700000000.222222",
        [
          { emoji: "one", users: ["U_alice", "U_multi"] },
          { emoji: "two", users: ["U_multi"] },
        ],
      ],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    const allUserIds = [
      ...body.reveals[0].voters.correct,
      ...body.reveals[0].voters.incorrect,
      ...body.reveals[0].voters.fenceSitters,
      ...body.reveals[0].voters.wildcards,
    ].map((v: { userId: string }) => v.userId);
    assert.ok(!allUserIds.includes("U_multi"));
    assert.ok(allUserIds.includes("U_alice"));

    const answers = await getAnswers(data);
    assert.ok(!answers.some((a) => a.userId === "U_multi"));
  });
});

describe("process_reveal_answers — payload shape", () => {
  it("wildcards carry their emoji so the renderer can riff on it", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.111111" });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.111111", [{ emoji: "pizza", users: ["U_chef"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(body.reveals[0].voters.wildcards.length, 1);
    assert.equal(body.reveals[0].voters.wildcards[0].userId, "U_chef");
    assert.equal(body.reveals[0].voters.wildcards[0].emoji, "pizza");
  });

  it("choice questions return type: 'choice' with choices + correctIndex", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "qc",
      type: "choice",
      correctIndex: 1,
      choices: ["A", "B", "C", "D"],
      ts: "1700000000.111111",
    });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.111111", [{ emoji: "two", users: ["U1"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(body.reveals[0].answer.type, "choice");
    assert.deepEqual(body.reveals[0].answer.choices, ["A", "B", "C", "D"]);
    assert.equal(body.reveals[0].answer.correctIndex, 1);
    assert.equal(body.reveals[0].voters.correct.length, 1);
    assert.deepEqual(body.reveals[0].voters.fenceSitters, []);
  });

  it("seasonStatus is omitted when seasons are disabled (no seasons.json seeded)", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.111111" });

    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(new Map([["1700000000.111111", [{ emoji: "+1", users: ["U1"] }]]])),
    );
    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.equal(body.seasonStatus, undefined);
  });

  it("seasonStatus is populated when a current season exists", async () => {
    const data = createInMemoryDataLayer();
    const now = Date.now();
    const seasonState: SeasonsState = {
      seasons: [
        {
          slug: "s-now",
          startedAt: now - 1000,
          expectedEndAt: now + 7 * 24 * 60 * 60 * 1000, // a week from now
          categories: ["Trivia"],
        },
      ],
    };
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState(seasonState);
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.111111" });

    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(new Map([["1700000000.111111", [{ emoji: "+1", users: ["U1"] }]]])),
    );
    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.ok(body.seasonStatus !== undefined);
    assert.equal(body.seasonStatus.currentSlug, "s-now");
    // No reveal cron in noJobs → isLastFireOfSeason defaults to false (revealJob === null).
    assert.equal(body.seasonStatus.isLastFireOfSeason, false);
    assert.equal(body.seasonStatus.seasonClosed, false);
    // Only one season has produced answers → hasPriorSeasons should be false.
    assert.equal(body.seasonStatus.hasPriorSeasons, false);
  });

  it("seasonStatus.hasPriorSeasons is true when answers exist from an earlier season", async () => {
    const data = createInMemoryDataLayer();
    const now = Date.now();
    const seasonState: SeasonsState = {
      seasons: [
        {
          slug: "s-old",
          startedAt: now - 30 * 24 * 60 * 60 * 1000,
          expectedEndAt: now - 1000,
          endedAt: now - 1000,
          categories: ["Trivia"],
        },
        {
          slug: "s-now",
          startedAt: now - 500,
          expectedEndAt: now + 7 * 24 * 60 * 60 * 1000,
          categories: ["Trivia"],
        },
      ],
    };
    await data.forGame(FIXTURE_GAME_NAME).saveSeasonsState(seasonState);
    // Seed an answer from the old season so hasPriorSeasons resolves to true.
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U_prev",
      questionId: "q-prev",
      answer: true,
      correct: true,
      timestamp: now - 24 * 60 * 60 * 1000,
      season: "s-old",
    });
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.111111" });

    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(new Map([["1700000000.111111", [{ emoji: "+1", users: ["U1"] }]]])),
    );
    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined }, SESSION),
    );
    assert.ok(body.seasonStatus !== undefined);
    assert.equal(body.seasonStatus.hasPriorSeasons, true);
  });
});

describe("process_reveal_answers — reprocess mode", () => {
  it("hard-deletes prior answers for the listed IDs and re-derives from current reactions", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.111111", processedAt: 500 });

    // Pre-seed an "old" answer that we expect to be deleted on reprocess.
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U_old",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 500,
    });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.111111", [{ emoji: "+1", users: ["U_alice"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: ["q1"] }, SESSION),
    );
    assert.equal(body.reveals.length, 1);
    assert.equal(body.reveals[0].wasReprocessed, true);

    const answers = await getAnswers(data);
    assert.ok(!answers.some((a) => a.userId === "U_old"), "prior answer is hard-deleted");
    assert.ok(
      answers.some((a) => a.userId === "U_alice"),
      "new answer is persisted",
    );
  });

  it("excludes a cheater flagged after the original reveal", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.111111", processedAt: 500 });

    // Originally counted as a correct answer.
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId: "U_marc",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 500,
    });

    // After-the-fact flag.
    await flagCheater(data, "U_marc", "q1");

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.111111", [{ emoji: "+1", users: ["U_marc", "U_alice"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: ["q1"] }, SESSION),
    );
    const allUserIds = [...body.reveals[0].voters.correct, ...body.reveals[0].voters.incorrect].map(
      (v: { userId: string }) => v.userId,
    );
    assert.ok(!allUserIds.includes("U_marc"));

    const answers = await getAnswers(data);
    assert.ok(!answers.some((a) => a.userId === "U_marc"));
  });

  it("only processes the listed IDs; unrelated pending questions remain pending", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "q-target",
      isTrue: true,
      ts: "1700000000.111111",
      processedAt: 500,
    });
    await seedQuestion(data, {
      id: "q-pending",
      isTrue: true,
      ts: "1700000000.222222",
      postedAt: 600,
    });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.111111", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000000.222222", [{ emoji: "+1", users: ["U2"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, reprocessQuestionIds: ["q-target"] }, SESSION),
    );
    assert.equal(body.reveals.length, 1);
    assert.equal(body.reveals[0].questionId, "q-target");

    const pending = await getQuestion(data, "q-pending");
    assert.equal(pending?.processedAt, undefined);
  });

  it("emits a per-id error for an unknown questionId without aborting the batch", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, {
      id: "q-real",
      isTrue: true,
      ts: "1700000000.111111",
      processedAt: 500,
    });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000000.111111", [{ emoji: "+1", users: ["U1"] }]],
    ]);
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      makeSlackDeps(reactions),
    );

    const body = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, reprocessQuestionIds: ["q-real", "q-bogus"] },
        SESSION,
      ),
    );
    assert.equal(body.reveals.length, 1);
    assert.equal(body.reveals[0].questionId, "q-real");
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.some((e: { questionId: string }) => e.questionId === "q-bogus"));
  });
});

describe("process_reveal_answers — freeform reveal", () => {
  async function seedFreeformQuestion(
    data: TriviaDataLayer,
    id: string,
    ts: string,
    overrides: Partial<TriviaQuestion> = {},
  ): Promise<void> {
    const q: TriviaQuestion = {
      id,
      category: "Geography",
      statement: "What is the capital of France?",
      answersFormat: "freeform",
      questionType: "fact",
      expectedAnswer: "Paris",
      acceptableAnswers: ["Paris, France"],
      emojis: ["🌍"],
      createdAt: 100,
      postedAt: 200,
      messageLink: permalink(ts),
      ...overrides,
    };
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(q);
  }

  async function seedPendingAnswer(
    data: TriviaDataLayer,
    userId: string,
    questionId: string,
    answerText: string,
  ): Promise<void> {
    await data.forGame(FIXTURE_GAME_NAME).saveAnswer({
      userId,
      questionId,
      answerText,
      timestamp: Date.now(),
    });
    await data.saveUser({ userId, displayName: userId, joinedAt: Date.now() });
  }

  it("invokes the judge once and applies verdicts to every submission", async () => {
    const data = createInMemoryDataLayer();
    await seedFreeformQuestion(data, "qf1", "1700000000.111111");
    await seedPendingAnswer(data, "U_alice", "qf1", "Paris");
    await seedPendingAnswer(data, "U_bob", "qf1", "Paris or London");

    let askCallCount = 0;
    const sdk = makeFakeSdk(async () => {
      askCallCount++;
      return {
        text: JSON.stringify({
          verdicts: [
            { key: "1.1", correct: true },
            { key: "1.2", correct: false, reason: "multiple-guess" },
          ],
        }),
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    });

    const slackDeps: RevealSlackDeps = {
      isAvailable: () => null,
      fetchBotUserId: async () => "",
      fetchMessageReactions: async () => [],
    };
    const tool = createProcessRevealAnswersTool(data, sdk, fixtureGetGames, noJobs, slackDeps);

    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined },
      SESSION,
    );
    const body = parseToolResult(result);

    assert.equal(askCallCount, 1, "exactly one judge call per reveal batch");
    assert.equal(body.reveals.length, 1);
    const reveal = body.reveals[0];
    assert.equal(reveal.answer.type, "freeform");
    assert.equal(reveal.answer.expectedAnswer, "Paris");
    assert.equal(reveal.voters.correct.length, 1);
    assert.equal(reveal.voters.correct[0].userId, "U_alice");
    assert.equal(reveal.voters.correct[0].answerText, "Paris");
    assert.equal(reveal.voters.incorrect.length, 1);
    assert.equal(reveal.voters.incorrect[0].userId, "U_bob");
    assert.equal(reveal.voters.incorrect[0].answerText, "Paris or London");
    assert.deepEqual(reveal.voters.fenceSitters, []);
    assert.deepEqual(reveal.voters.wildcards, []);

    // Verdicts persisted on the rows.
    const rows = await getAnswers(data);
    const alice = rows.find((r) => r.userId === "U_alice");
    const bob = rows.find((r) => r.userId === "U_bob");
    assert.equal(alice?.correct, true);
    assert.equal(bob?.correct, false);

    // processedAt stamped.
    const q = await getQuestion(data, "qf1");
    assert.notEqual(q?.processedAt, undefined);
  });

  it("skips the judge entirely when no submissions exist", async () => {
    const data = createInMemoryDataLayer();
    await seedFreeformQuestion(data, "qf-empty", "1700000000.222222");

    let askCallCount = 0;
    const sdk = makeFakeSdk(async () => {
      askCallCount++;
      throw new Error("should not be called");
    });

    const slackDeps: RevealSlackDeps = {
      isAvailable: () => null,
      fetchBotUserId: async () => "",
      fetchMessageReactions: async () => [],
    };
    const tool = createProcessRevealAnswersTool(data, sdk, fixtureGetGames, noJobs, slackDeps);

    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined },
      SESSION,
    );
    const body = parseToolResult(result);

    assert.equal(askCallCount, 0, "no judge call when there are no submissions");
    assert.equal(body.reveals.length, 1);
    assert.deepEqual(body.reveals[0].voters.correct, []);
    assert.deepEqual(body.reveals[0].voters.incorrect, []);
  });

  it("commits rows as incorrect with reason judge-error when the judge call fails", async () => {
    const data = createInMemoryDataLayer();
    await seedFreeformQuestion(data, "qf-err", "1700000000.333333");
    await seedPendingAnswer(data, "U_alice", "qf-err", "Paris");

    const sdk = makeFakeSdk(async () => {
      throw new Error("network blew up");
    });
    const slackDeps: RevealSlackDeps = {
      isAvailable: () => null,
      fetchBotUserId: async () => "",
      fetchMessageReactions: async () => [],
    };
    const tool = createProcessRevealAnswersTool(data, sdk, fixtureGetGames, noJobs, slackDeps);

    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined },
      SESSION,
    );
    const body = parseToolResult(result);
    const reveal = body.reveals[0];
    assert.equal(reveal.voters.incorrect.length, 1);
    assert.equal(reveal.voters.incorrect[0].userId, "U_alice");

    const rows = await getAnswers(data);
    const alice = rows.find((r) => r.userId === "U_alice");
    assert.equal(alice?.correct, false);

    assert.ok(body.errors !== undefined);
    assert.ok(body.errors.some((e: { error: string }) => /judge-error/.test(e.error)));
  });

  it("rejects reprocess mode for freeform questions", async () => {
    const data = createInMemoryDataLayer();
    await seedFreeformQuestion(data, "qf-repro", "1700000000.444444", { processedAt: 999 });

    const sdk = makeFakeSdk();
    const slackDeps: RevealSlackDeps = {
      isAvailable: () => null,
      fetchBotUserId: async () => "",
      fetchMessageReactions: async () => [],
    };
    const tool = createProcessRevealAnswersTool(data, sdk, fixtureGetGames, noJobs, slackDeps);

    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: ["qf-repro"] },
      SESSION,
    );
    const body = parseToolResult(result);
    assert.ok(body.errors !== undefined);
    assert.ok(
      body.errors.some((e: { error: string }) =>
        /reprocess mode is not supported for freeform/.test(e.error),
      ),
    );
  });

  it("handles multiple freeform questions in one batch with one judge call", async () => {
    const data = createInMemoryDataLayer();
    await seedFreeformQuestion(data, "qfA", "1700000001.000000", {
      statement: "What is the capital of France?",
      expectedAnswer: "Paris",
      postedAt: 100,
      batchId: "batch-multi",
    });
    await seedFreeformQuestion(data, "qfB", "1700000002.000000", {
      statement: "Who wrote Hamlet?",
      expectedAnswer: "Shakespeare",
      postedAt: 200,
      batchId: "batch-multi",
    });
    // qfA: alice correct, bob wrong
    await seedPendingAnswer(data, "U_alice", "qfA", "Paris");
    await seedPendingAnswer(data, "U_bob", "qfA", "London");
    // qfB: alice wrong, bob correct
    await seedPendingAnswer(data, "U_alice", "qfB", "Marlowe");
    await seedPendingAnswer(data, "U_bob", "qfB", "Shakespeare");

    let askCallCount = 0;
    const sdk = makeFakeSdk(async () => {
      askCallCount++;
      return {
        text: JSON.stringify({
          verdicts: [
            { key: "1.1", correct: true },
            { key: "1.2", correct: false },
            { key: "2.1", correct: false },
            { key: "2.2", correct: true },
          ],
        }),
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    });

    const slackDeps: RevealSlackDeps = {
      isAvailable: () => null,
      fetchBotUserId: async () => "",
      fetchMessageReactions: async () => [],
    };
    const tool = createProcessRevealAnswersTool(data, sdk, fixtureGetGames, noJobs, slackDeps);

    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined },
      SESSION,
    );
    const body = parseToolResult(result);

    assert.equal(askCallCount, 1, "single judge call for the whole batch");
    assert.equal(body.reveals.length, 2);

    // Reveals appear in postedAt order (qfA before qfB)
    assert.equal(body.reveals[0].questionId, "qfA");
    assert.equal(body.reveals[1].questionId, "qfB");

    // qfA verdicts
    const a = body.reveals[0];
    assert.equal(a.voters.correct.length, 1);
    assert.equal(a.voters.correct[0].userId, "U_alice");
    assert.equal(a.voters.correct[0].answerText, "Paris");
    assert.equal(a.voters.incorrect.length, 1);
    assert.equal(a.voters.incorrect[0].userId, "U_bob");

    // qfB verdicts (bob is correct here)
    const b = body.reveals[1];
    assert.equal(b.voters.correct.length, 1);
    assert.equal(b.voters.correct[0].userId, "U_bob");
    assert.equal(b.voters.correct[0].answerText, "Shakespeare");
    assert.equal(b.voters.incorrect.length, 1);
    assert.equal(b.voters.incorrect[0].userId, "U_alice");

    // Leaderboard sums across both questions: each user has one correct answer
    assert.equal(body.leaderboard.length, 2);
    const aliceRow = body.leaderboard.find((r: { userId: string }) => r.userId === "U_alice");
    const bobRow = body.leaderboard.find((r: { userId: string }) => r.userId === "U_bob");
    assert.equal(aliceRow?.totalCorrect, 1);
    assert.equal(aliceRow?.totalAnswered, 2);
    assert.equal(bobRow?.totalCorrect, 1);
    assert.equal(bobRow?.totalAnswered, 2);
  });

  it("preserves the original target order in mixed boolean + freeform batches", async () => {
    const data = createInMemoryDataLayer();
    // Posted order: boolean (Q1), freeform (Q2), boolean (Q3) — same batch
    await seedQuestion(data, {
      id: "Q1",
      isTrue: true,
      ts: "1700000001.000000",
      postedAt: 100,
      batchId: "mixed",
    });
    await seedFreeformQuestion(data, "Q2", "1700000002.000000", {
      expectedAnswer: "Paris",
      postedAt: 200,
      batchId: "mixed",
    });
    await seedQuestion(data, {
      id: "Q3",
      isTrue: false,
      ts: "1700000003.000000",
      postedAt: 300,
      batchId: "mixed",
    });
    await seedPendingAnswer(data, "U_alice", "Q2", "Paris");

    const sdk = makeFakeSdk(async () => ({
      text: JSON.stringify({ verdicts: [{ key: "1.1", correct: true }] }),
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const slackDeps: RevealSlackDeps = {
      isAvailable: () => null,
      fetchBotUserId: async () => "",
      fetchMessageReactions: async () => [],
    };
    const tool = createProcessRevealAnswersTool(data, sdk, fixtureGetGames, noJobs, slackDeps);

    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined },
      SESSION,
    );
    const body = parseToolResult(result);

    assert.equal(body.reveals.length, 3);
    // Original posted order is preserved across the mixed-format split.
    assert.deepEqual(
      body.reveals.map((r: { questionId: string }) => r.questionId),
      ["Q1", "Q2", "Q3"],
    );
    // And the middle reveal is correctly typed as freeform.
    assert.equal(body.reveals[1].answer.type, "freeform");
    assert.equal(body.reveals[0].answer.type, "boolean");
    assert.equal(body.reveals[2].answer.type, "boolean");
  });
});

describe("process_reveal_answers — Slack unavailable", () => {
  it("returns an error when slackDeps.isAvailable() reports unavailable", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "q1", isTrue: true, ts: "1700000000.111111" });

    const unavailableDeps: RevealSlackDeps = {
      isAvailable: () => "Slack is down for tests",
      fetchBotUserId: async () => "",
      fetchMessageReactions: async () => [],
    };
    const tool = createProcessRevealAnswersTool(
      data,
      makeFakeSdk(),
      fixtureGetGames,
      noJobs,
      unavailableDeps,
    );

    const result = await tool.handler(
      { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined },
      SESSION,
    );
    const body = parseToolResult(result);
    assert.match(body.error ?? "", /Slack is down for tests/);

    // Did NOT process — processedAt should still be undefined.
    const q = await getQuestion(data, "q1");
    assert.equal(q?.processedAt, undefined);
  });
});
