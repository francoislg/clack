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
    invalidate: undefined,
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
      makePrediction({ questionType: "fact", isTrue: true, resolved: undefined }),
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
