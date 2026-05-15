import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer } from "./testHelpers.js";
import { createSubmitAnswersTool } from "./submitAnswers.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import type { TriviaDataLayer, TriviaQuestion } from "./types.js";

const SESSION = { sessionId: "test" };

const CHOICE_QUESTION: TriviaQuestion = {
  id: "qchoice",
  type: "choice",
  category: "Geography",
  statement: "Which is the smallest planet?",
  choices: ["Mercury", "Venus", "Earth", "Mars"],
  correctIndex: 0,
  emojis: ["🪐"],
  createdAt: 1_000,
};

const BOOLEAN_QUESTION: TriviaQuestion = {
  id: "qbool",
  type: "boolean",
  category: "Geography",
  statement: "The Earth is round.",
  isTrue: true,
  emojis: ["🌍"],
  createdAt: 1_000,
};

const LEGACY_BOOLEAN_QUESTION: TriviaQuestion = {
  id: "qlegacy",
  // no type field — should read as boolean
  category: "Geography",
  statement: "Pre-change boolean question.",
  isTrue: false,
  emojis: ["🌍"],
  createdAt: 1_000,
};

describe("submit_answers — choice questions", () => {
  let data: TriviaDataLayer;
  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveQuestion(CHOICE_QUESTION);
  });

  it("records correctness via answerIndex === correctIndex", async () => {
    const tool = createSubmitAnswersTool(data);
    const result = await tool.handler(
      {
        questionId: "qchoice",
        messageLink: "https://slack/x",
        postedAt: 2_000,
        answers: [
          { userId: "U1", displayName: "Alice", answer: undefined, answerIndex: 0 },
          { userId: "U2", displayName: "Bob", answer: undefined, answerIndex: 2 },
        ],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.results.length, 2);
    assert.equal(parsed.results[0].correct, true); // index 0 == correctIndex 0
    assert.equal(parsed.results[1].correct, false);

    const stored = await data.loadAnswers();
    assert.equal(stored.length, 2);
    assert.equal(stored[0].answerIndex, 0);
    assert.equal(stored[0].answer, undefined);
    assert.equal(stored[1].answerIndex, 2);
    assert.equal(stored[1].answer, undefined);
  });

  it("rejects boolean entry on choice question", async () => {
    const tool = createSubmitAnswersTool(data);
    const result = await tool.handler(
      {
        questionId: "qchoice",
        messageLink: "https://slack/x",
        postedAt: 2_000,
        answers: [{ userId: "U1", displayName: "Alice", answer: true, answerIndex: undefined }],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /choice questions require "answerIndex"/);
  });

  it("rejects choice entry on boolean question", async () => {
    await data.saveQuestion(BOOLEAN_QUESTION);
    const tool = createSubmitAnswersTool(data);
    const result = await tool.handler(
      {
        questionId: "qbool",
        messageLink: "https://slack/x",
        postedAt: 2_000,
        answers: [{ userId: "U1", displayName: "Alice", answer: undefined, answerIndex: 1 }],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /boolean questions require "answer"/);
  });

  it("rejects answerIndex out of range", async () => {
    const tool = createSubmitAnswersTool(data);
    const result = await tool.handler(
      {
        questionId: "qchoice",
        messageLink: "https://slack/x",
        postedAt: 2_000,
        answers: [{ userId: "U1", displayName: "Alice", answer: undefined, answerIndex: 5 }],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /answerIndex \(5\) must be in \[0, 4\)/);
  });

  it("rejects entries that mix both answer and answerIndex", async () => {
    const tool = createSubmitAnswersTool(data);
    const result = await tool.handler(
      {
        questionId: "qchoice",
        messageLink: "https://slack/x",
        postedAt: 2_000,
        answers: [{ userId: "U1", displayName: "Alice", answer: true, answerIndex: 1 }],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /must not include "answer"/);
  });

  it("dedup skips repeat answers from same user", async () => {
    const tool = createSubmitAnswersTool(data);
    await tool.handler(
      {
        questionId: "qchoice",
        messageLink: "https://slack/x",
        postedAt: 2_000,
        answers: [{ userId: "U1", displayName: "Alice", answer: undefined, answerIndex: 0 }],
      },
      SESSION,
    );
    const result = await tool.handler(
      {
        questionId: "qchoice",
        messageLink: "https://slack/x",
        postedAt: 2_000,
        answers: [{ userId: "U1", displayName: "Alice", answer: undefined, answerIndex: 2 }],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.results[0].skipped, true);

    const stored = await data.loadAnswers();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].answerIndex, 0); // still the first answer
  });

  it("equal credit across types: 1 boolean correct + 1 choice correct → totalCorrect 2", async () => {
    await data.saveQuestion(BOOLEAN_QUESTION);
    const tool = createSubmitAnswersTool(data);
    await tool.handler(
      {
        questionId: "qchoice",
        messageLink: "https://slack/x",
        postedAt: 2_000,
        answers: [{ userId: "U1", displayName: "Alice", answer: undefined, answerIndex: 0 }],
      },
      SESSION,
    );
    const result = await tool.handler(
      {
        questionId: "qbool",
        messageLink: "https://slack/y",
        postedAt: 3_000,
        answers: [{ userId: "U1", displayName: "Alice", answer: true, answerIndex: undefined }],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.results[0].correct, true);
    assert.equal(parsed.results[0].totalCorrect, 2);
    assert.equal(parsed.results[0].totalAnswered, 2);
  });
});

describe("submit_answers — legacy boolean rows (no type field)", () => {
  it("treats type-less question as boolean", async () => {
    const data = createInMemoryDataLayer();
    await data.saveQuestion(LEGACY_BOOLEAN_QUESTION);
    const tool = createSubmitAnswersTool(data);
    const result = await tool.handler(
      {
        questionId: "qlegacy",
        messageLink: "https://slack/x",
        postedAt: 2_000,
        answers: [{ userId: "U1", displayName: "Alice", answer: false, answerIndex: undefined }],
      },
      SESSION,
    );
    const parsed = parseToolResult(result);
    assert.equal(parsed.results[0].correct, true); // answer false == isTrue false
  });
});
