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
function makeFakeSdk(): Pick<ClackSdk, "getSlackClient"> {
  return { getSlackClient: () => null };
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
  ts: string; // canonical Slack ts string
}

async function seedQuestion(data: TriviaDataLayer, seed: QuestionSeed): Promise<void> {
  const q: TriviaQuestion = {
    id: seed.id,
    category: seed.category ?? "Trivia",
    statement: seed.statement ?? "is true?",
    type: seed.type,
    isTrue: seed.isTrue,
    choices: seed.choices,
    correctIndex: seed.correctIndex,
    emojis: seed.emojis ?? ["⚡"],
    createdAt: seed.createdAt ?? 100,
    postedAt: seed.postedAt ?? 200,
    messageLink: permalink(seed.ts),
    processedAt: seed.processedAt,
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

  it("picks the oldest pending when multiple are pending; leaves the rest unprocessed", async () => {
    const data = createInMemoryDataLayer();
    await seedQuestion(data, { id: "old", isTrue: true, postedAt: 100, ts: "1700000001.000000" });
    await seedQuestion(data, { id: "newer", isTrue: true, postedAt: 200, ts: "1700000002.000000" });

    const reactions = new Map<string, SlackReactionLike[]>([
      ["1700000001.000000", [{ emoji: "+1", users: ["U1"] }]],
      ["1700000002.000000", [{ emoji: "+1", users: ["U1"] }]],
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
    assert.equal(body.reveals[0].questionId, "old");

    const newer = await getQuestion(data, "newer");
    assert.equal(newer?.processedAt, undefined);
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
