import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "../../testHelpers.js";
import { createOverrideAnswerTool } from "./overrideAnswer.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { SubmittedAnswer, TriviaQuestion } from "../../core/types.js";

const SESSION = { sessionId: "test" };

function freeformQuestion(overrides: Partial<TriviaQuestion> = {}): TriviaQuestion {
  return {
    id: "q1",
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
    processedAt: 9_000,
    ...overrides,
  };
}

async function seedRevealedAnswer(
  data: ReturnType<typeof createInMemoryDataLayer>,
  row: Partial<SubmittedAnswer> = {},
  question: TriviaQuestion = freeformQuestion(),
): Promise<void> {
  const scoped = data.forGame(FIXTURE_GAME_NAME);
  await scoped.saveQuestion(question);
  await scoped.saveAnswer({
    userId: "U1",
    questionId: question.id,
    answerText: "Lleida",
    correct: false,
    judgeReason: "too-broad",
    timestamp: 500,
    ...row,
  });
}

async function findRow(
  data: ReturnType<typeof createInMemoryDataLayer>,
  userId = "U1",
  questionId = "q1",
) {
  const rows = await data.forGame(FIXTURE_GAME_NAME).loadAnswers();
  return rows.find((a) => a.userId === userId && a.questionId === questionId);
}

describe("override_answer tool", () => {
  it("override mode requires `correct`", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealedAnswer(data);
    const tool = createOverrideAnswerTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          userId: "U1",
          correct: undefined,
          reason: "ok",
          restore: undefined,
        },
        SESSION,
      ),
    );
    assert.match(body.error, /requires `correct`/);
    assert.equal((await findRow(data))?.correct, false, "row unchanged");
  });

  it("override mode requires a non-empty `reason`", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealedAnswer(data);
    const tool = createOverrideAnswerTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          userId: "U1",
          correct: true,
          reason: "  ",
          restore: undefined,
        },
        SESSION,
      ),
    );
    assert.match(body.error, /non-empty `reason`/);
  });

  it("refuses before the question is revealed (post-reveal gate)", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealedAnswer(
      data,
      { correct: undefined },
      freeformQuestion({ processedAt: undefined }),
    );
    const tool = createOverrideAnswerTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          userId: "U1",
          correct: true,
          reason: "ok",
          restore: undefined,
        },
        SESSION,
      ),
    );
    assert.match(body.error, /has not been revealed/);
  });

  it("errors when the question does not exist", async () => {
    const data = createInMemoryDataLayer();
    const tool = createOverrideAnswerTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "ghost",
          userId: "U1",
          correct: true,
          reason: "ok",
          restore: undefined,
        },
        SESSION,
      ),
    );
    assert.match(body.error, /not found/);
  });

  it("errors when the answer row does not exist", async () => {
    const data = createInMemoryDataLayer();
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(freeformQuestion());
    const tool = createOverrideAnswerTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          userId: "Uxxx",
          correct: true,
          reason: "ok",
          restore: undefined,
        },
        SESSION,
      ),
    );
    assert.match(body.error, /No answer/);
  });

  it("captures the original verdict on the first override and sets the new verdict", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealedAnswer(data);
    const tool = createOverrideAnswerTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          userId: "U1",
          correct: true,
          reason: "valid alternate spelling",
          restore: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(body.action, "overridden");
    // Standardized repaint call names questionIds with the affected id, never a batchId.
    assert.match(body.refreshHint, /update_answers_block\(game, questionIds: \["q1"\]\)/);
    assert.doesNotMatch(body.refreshHint, /batchId/);

    const row = await findRow(data);
    assert.equal(row?.correct, true);
    assert.equal(row?.judgeReason, "valid alternate spelling");
    assert.deepEqual(row?.originalVerdict, { correct: false, judgeReason: "too-broad" });
    assert.equal(row?.answerText, "Lleida", "raw submission untouched");
  });

  it("a second override preserves the original machine verdict", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealedAnswer(data, {
      correct: true,
      judgeReason: "manual A",
      originalVerdict: { correct: false, judgeReason: "too-broad" },
    });
    const tool = createOverrideAnswerTool(data, fixtureGetGames);

    await tool.handler(
      {
        game: FIXTURE_GAME_NAME,
        questionId: "q1",
        userId: "U1",
        correct: false,
        reason: "manual B",
        restore: undefined,
      },
      SESSION,
    );

    const row = await findRow(data);
    assert.equal(row?.correct, false);
    assert.equal(row?.judgeReason, "manual B");
    assert.deepEqual(
      row?.originalVerdict,
      { correct: false, judgeReason: "too-broad" },
      "original machine verdict, not the intermediate manual value",
    );
  });

  it("restore puts the machine verdict back and drops the lock", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealedAnswer(data, {
      correct: true,
      judgeReason: "manual",
      originalVerdict: { correct: false, judgeReason: "too-broad" },
    });
    const tool = createOverrideAnswerTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          userId: "U1",
          correct: undefined,
          reason: undefined,
          restore: true,
        },
        SESSION,
      ),
    );
    assert.equal(body.action, "restored");

    const row = await findRow(data);
    assert.equal(row?.correct, false);
    assert.equal(row?.judgeReason, "too-broad");
    assert.equal(row?.originalVerdict, undefined, "lock dropped — row re-enters reprocess");
    assert.equal(row?.answerText, "Lleida", "raw submission untouched");
  });

  it("restore errors when the row was never overridden", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealedAnswer(data);
    const tool = createOverrideAnswerTool(data, fixtureGetGames);

    const body = parseToolResult(
      await tool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q1",
          userId: "U1",
          correct: undefined,
          reason: undefined,
          restore: true,
        },
        SESSION,
      ),
    );
    assert.match(body.error, /nothing to restore/);
    assert.equal((await findRow(data))?.correct, false, "row unchanged");
  });
});
