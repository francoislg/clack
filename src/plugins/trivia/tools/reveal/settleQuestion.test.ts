import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createSettleQuestionTool } from "./settleQuestion.js";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";

const SESSION = { sessionId: "test" };

function makePrediction(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "p1",
    category: "Sports",
    statement: "Brazil will win tomorrow",
    answersFormat: "boolean",
    questionType: "prediction",
    resolved: false,
    sourceUrl: "https://fifa.com/match/1",
    emojis: ["⚽"],
    createdAt: 0,
    postedAt: 1000,
    ...overrides,
  };
}

type Args = Parameters<ReturnType<typeof createSettleQuestionTool>["handler"]>[0];
function args(o: Partial<Args> & { questionId: string }): Args {
  return {
    game: FIXTURE_GAME_NAME,
    outcome: undefined,
    override: undefined,
    invalidate: undefined,
    reopen: undefined,
    invalidatedReason: undefined,
    acceptableAnswers: undefined,
    gradingNotes: undefined,
    ...o,
  };
}

describe("settle_question — answer a prediction", () => {
  let data: TriviaDataLayer;
  beforeEach(() => {
    data = createInMemoryDataLayer();
  });

  it("stamps the boolean key + resolved:true and reports the outcome", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makePrediction({}));
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(args({ questionId: "p1", outcome: true }), SESSION),
    );
    assert.equal(res.settled, true);
    // Answering a still-pending (unrevealed) prediction posts no result yet — no card to refresh.
    assert.equal(res.refreshHint, undefined);
    const after = (await scoped.loadQuestions()).find((q) => q.id === "p1");
    assert.equal(after?.isTrue, true);
    assert.equal(after?.resolved, true);
    assert.equal(after?.resolvedOutcome, true);
  });

  it("rejects answering a question that already has a key", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makePrediction({ isTrue: true, resolved: true }));
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(args({ questionId: "p1", outcome: false }), SESSION),
    );
    assert.match(res.error, /already has an answer key/);
  });

  it("re-settles an already-keyed question with override and rescores", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makePrediction({
        isTrue: true,
        resolved: true,
        processedAt: 9_000,
        messageLink: "https://x.slack.com/archives/C1/p1700000000000000",
      }),
    );
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "p1",
      answer: true,
      correct: true,
      timestamp: 1,
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "p1",
      answer: false,
      correct: false,
      timestamp: 2,
    });
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(args({ questionId: "p1", outcome: false, override: true }), SESSION),
    );
    assert.equal(res.settled, true);
    assert.equal(res.reSettled, true);
    assert.equal(res.rescored, 2);
    // Re-settling a revealed question changes scored verdicts → repaint after reprocess.
    assert.match(res.refreshHint, /refresh_question_cards\(game, questionIds: \["p1"\]\)/);
    const after = (await scoped.loadQuestions()).find((q) => q.id === "p1");
    assert.equal(after?.isTrue, false);
    assert.equal(after?.resolvedOutcome, false);
    const answers = await scoped.loadAnswers();
    assert.ok(
      answers.every((a) => a.correct === undefined),
      "verdicts cleared for rescore",
    );
  });

  it("settles a freeform prediction with the full judge spec", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makePrediction({ answersFormat: "freeform", freeformAnswerShape: "name" }),
    );
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(
        args({
          questionId: "p1",
          outcome: "Lionel Messi",
          acceptableAnswers: ["Messi"],
          gradingNotes: "Accept last name only.",
        }),
        SESSION,
      ),
    );
    assert.equal(res.settled, true);
    const after = (await scoped.loadQuestions()).find((q) => q.id === "p1");
    assert.equal(after?.expectedAnswer, "Lionel Messi");
    assert.deepEqual(after?.acceptableAnswers, ["Messi"]);
    assert.equal(after?.gradingNotes, "Accept last name only.");
  });
});

describe("settle_question — invalidate", () => {
  let data: TriviaDataLayer;
  beforeEach(() => {
    data = createInMemoryDataLayer();
  });

  it("marks invalidated + reason and clears existing verdicts", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // A normal answered question with scored answers.
    await scoped.saveQuestion(
      makePrediction({
        questionType: "fact",
        isTrue: true,
        resolved: undefined,
        messageLink: "https://x.slack.com/archives/C1/p1700000000000000",
      }),
    );
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "p1",
      answer: true,
      correct: true,
      timestamp: 1,
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "p1",
      answer: false,
      correct: false,
      timestamp: 2,
    });

    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(
        args({ questionId: "p1", invalidate: true, invalidatedReason: "bad question" }),
        SESSION,
      ),
    );
    assert.equal(res.invalidated, true);
    assert.equal(res.cleared, 2);
    // Standardized repaint call names questionIds with the affected id, never a batchId.
    assert.match(res.refreshHint, /refresh_question_cards\(game, questionIds: \["p1"\]\)/);
    assert.doesNotMatch(res.refreshHint, /batchId/);

    const after = (await scoped.loadQuestions()).find((q) => q.id === "p1");
    assert.equal(after?.invalidated, true);
    assert.equal(after?.invalidatedReason, "bad question");
    const answers = await scoped.loadAnswers();
    assert.ok(
      answers.every((a) => a.correct === undefined),
      "verdicts cleared",
    );
  });

  it("requires a reason", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makePrediction({}));
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(args({ questionId: "p1", invalidate: true }), SESSION),
    );
    assert.match(res.error, /invalidatedReason/);
  });

  it("rejects passing both outcome and invalidate", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makePrediction({}));
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(
        args({ questionId: "p1", outcome: true, invalidate: true, invalidatedReason: "x" }),
        SESSION,
      ),
    );
    assert.match(res.error, /EXACTLY ONE/);
  });

  it("rejects passing neither", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makePrediction({}));
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(await tool.handler(args({ questionId: "p1" }), SESSION));
    assert.match(res.error, /EXACTLY ONE/);
  });

  it("errors on a missing question", async () => {
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(args({ questionId: "nope", outcome: true }), SESSION),
    );
    assert.match(res.error, /not found/);
  });
});

describe("settle_question — reopen", () => {
  let data: TriviaDataLayer;
  beforeEach(() => {
    data = createInMemoryDataLayer();
  });

  it("clears invalidation and returns a keyless prediction to pending", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makePrediction({
        isTrue: undefined,
        resolved: true,
        resolvedAt: 5,
        resolvedOutcome: false,
        invalidated: true,
        invalidatedReason: "result not known yet",
        messageLink: "https://x.slack.com/archives/C1/p1700000000000000",
      }),
    );
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(args({ questionId: "p1", reopen: true }), SESSION),
    );

    assert.equal(res.reopened, true);
    assert.equal(res.returnedToPending, true);
    assert.match(res.refreshHint, /refresh_question_cards\(game, questionIds: \["p1"\]\)/);

    const after = (await scoped.loadQuestions()).find((q) => q.id === "p1");
    assert.equal(after?.invalidated, undefined);
    assert.equal(after?.invalidatedReason, undefined);
    assert.equal(after?.resolved, false);
    assert.equal(after?.resolvedAt, undefined);
    assert.equal(after?.resolvedOutcome, undefined);

    // After reopen it settles like any pending prediction — no override needed.
    const settle = parseToolResult(
      await tool.handler(args({ questionId: "p1", outcome: true }), SESSION),
    );
    assert.equal(settle.settled, true);
  });

  it("keeps the settled key when reopening a keyed question", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makePrediction({
        questionType: "fact",
        isTrue: true,
        resolved: true,
        resolvedAt: 5,
        resolvedOutcome: true,
        invalidated: true,
        invalidatedReason: "voided by mistake",
      }),
    );
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(args({ questionId: "p1", reopen: true }), SESSION),
    );

    assert.equal(res.reopened, true);
    assert.equal(res.returnedToPending, false);

    const after = (await scoped.loadQuestions()).find((q) => q.id === "p1");
    assert.equal(after?.invalidated, undefined);
    assert.equal(after?.isTrue, true);
    assert.equal(after?.resolved, true);
    assert.equal(after?.resolvedAt, 5);
    assert.equal(after?.resolvedOutcome, true);
  });

  it("errors when the question is not invalidated", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makePrediction({}));
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const res = parseToolResult(
      await tool.handler(args({ questionId: "p1", reopen: true }), SESSION),
    );
    assert.match(res.error, /not invalidated/);
  });

  it("leaves processedAt, answerLocked, and answer rows untouched", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makePrediction({
        isTrue: undefined,
        resolved: true,
        invalidated: true,
        invalidatedReason: "was voided",
        processedAt: 999,
        answerLocked: true,
      }),
    );
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "p1",
      answer: true,
      correct: undefined,
      timestamp: 1,
    });
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    await tool.handler(args({ questionId: "p1", reopen: true }), SESSION);

    const after = (await scoped.loadQuestions()).find((q) => q.id === "p1");
    assert.equal(after?.processedAt, 999);
    assert.equal(after?.answerLocked, true);
    const answers = await scoped.loadAnswers();
    assert.equal(answers.length, 1);
    assert.equal(answers[0].userId, "U1");
  });

  it("rejects passing reopen with outcome or invalidate", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makePrediction({ invalidated: true, invalidatedReason: "x" }));
    const tool = createSettleQuestionTool(data, fixtureGetGames);
    const both = parseToolResult(
      await tool.handler(args({ questionId: "p1", reopen: true, outcome: true }), SESSION),
    );
    assert.match(both.error, /EXACTLY ONE/);
    const withInvalidate = parseToolResult(
      await tool.handler(
        args({ questionId: "p1", reopen: true, invalidate: true, invalidatedReason: "y" }),
        SESSION,
      ),
    );
    assert.match(withInvalidate.error, /EXACTLY ONE/);
  });
});
