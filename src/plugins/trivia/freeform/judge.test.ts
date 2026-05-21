import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildJudgePrompt, parseJudgeResponse, type JudgeQuestionGroup } from "./judge.js";
import type { TriviaQuestion } from "../core/types.js";

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q-1",
    category: "Geography",
    statement: "What is the capital of France?",
    answersFormat: "freeform",
    questionType: "fact",
    expectedAnswer: "Paris",
    emojis: ["🌍"],
    createdAt: 0,
    ...overrides,
  };
}

describe("buildJudgePrompt", () => {
  it("includes statement, expected answer, and each submission with its key", () => {
    const groups: JudgeQuestionGroup[] = [
      {
        question: makeQuestion({}),
        submissions: [
          { key: "1.1", userId: "U1", answerText: "paris" },
          { key: "1.2", userId: "U2", answerText: "Paris or London" },
        ],
      },
    ];
    const prompt = buildJudgePrompt(groups);
    const body = prompt.messages[0].content;
    assert.ok(body.includes("What is the capital of France?"));
    assert.ok(body.includes("Expected answer: Paris"));
    assert.ok(body.includes('[1.1] U1: "paris"'));
    assert.ok(body.includes('[1.2] U2: "Paris or London"'));
  });

  it("includes acceptable variants and grading notes when present", () => {
    const groups: JudgeQuestionGroup[] = [
      {
        question: makeQuestion({
          acceptableAnswers: ["Paris, France"],
          gradingNotes: "Accept any major French city.",
        }),
        submissions: [{ key: "1.1", userId: "U1", answerText: "Paris" }],
      },
    ];
    const body = buildJudgePrompt(groups).messages[0].content;
    assert.ok(body.includes("Acceptable variants: Paris, France"));
    assert.ok(body.includes("Notes: Accept any major French city."));
  });

  it("skips questions with no submissions from the body", () => {
    const groups: JudgeQuestionGroup[] = [
      { question: makeQuestion({ id: "q-with-no-subs" }), submissions: [] },
      {
        question: makeQuestion({ id: "q-with-subs" }),
        submissions: [{ key: "2.1", userId: "U1", answerText: "Paris" }],
      },
    ];
    const body = buildJudgePrompt(groups).messages[0].content;
    assert.ok(body.includes("[2.1]"));
    // The skipped question still has its body absent.
    assert.ok(!body.includes("q-with-no-subs"));
  });

  it("system prompt establishes the multi-guess rule", () => {
    const { system } = buildJudgePrompt([
      {
        question: makeQuestion({}),
        submissions: [{ key: "1.1", userId: "U1", answerText: "ok" }],
      },
    ]);
    assert.ok(/multiple-guess/i.test(system));
    assert.ok(/qualifier/i.test(system));
  });
});

describe("parseJudgeResponse", () => {
  it("parses a well-formed JSON response", () => {
    const text = JSON.stringify({
      verdicts: [
        { key: "1.1", correct: true },
        { key: "1.2", correct: false, reason: "multiple-guess" },
      ],
    });
    const verdicts = parseJudgeResponse(text);
    assert.equal(verdicts.length, 2);
    assert.equal(verdicts[0].key, "1.1");
    assert.equal(verdicts[0].correct, true);
    assert.equal(verdicts[1].correct, false);
    assert.equal(verdicts[1].reason, "multiple-guess");
  });

  it("tolerates a markdown code fence around the JSON", () => {
    const fenced =
      "```json\n" + JSON.stringify({ verdicts: [{ key: "x", correct: true }] }) + "\n```";
    const verdicts = parseJudgeResponse(fenced);
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].correct, true);
  });

  it("throws on malformed JSON", () => {
    assert.throws(() => parseJudgeResponse("not json"));
  });

  it("throws when verdicts is missing", () => {
    assert.throws(() => parseJudgeResponse(JSON.stringify({ other: 1 })), /'verdicts'/);
  });

  it("throws when a verdict entry is missing key or correct", () => {
    assert.throws(() => parseJudgeResponse(JSON.stringify({ verdicts: [{ correct: true }] })));
    assert.throws(() => parseJudgeResponse(JSON.stringify({ verdicts: [{ key: "x" }] })));
  });
});
